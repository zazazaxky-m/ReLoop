import type { EmailOutbox, EmailOutboxKind, Prisma } from "@prisma/client";
import { lockUser } from "./db-locks";
import {
  ACCEPT_INVITATION_PATH,
  EMAIL_VERIFICATION_TTL_MS,
  INVITE_TOKEN_TTL_MS,
  VERIFY_EMAIL_PATH,
  emailTokenLink,
  generateEmailToken,
  hashEmailVerificationToken,
  hashInviteToken,
} from "./email-tokens";
import { sendEmailVerificationEmail, sendTravelAgentInviteEmail, type SendEmailResult } from "./mailer";
import { prisma } from "./prisma";
import { HttpError } from "./rbac";
import { emailLinkBase } from "./site";

/**
 * Durable delivery of invitation and email-verification mail (A03).
 *
 * A request enqueues an EmailOutbox row in the same transaction as the change
 * that needs the mail, then tries to deliver it after COMMIT (`after()` in the
 * route); scripts/process-email-outbox.ts retries what is still due.
 *
 * Nothing secret is persisted for delivery: a row holds only what to send (the
 * invite or the user, plus the user's emailLookup snapshot). The token is
 * minted at delivery: a short transaction writes its SHA-256 (replacing the
 * previous one), the raw value stays in memory for the mail and is then
 * dropped. A retry therefore mints a new token; only the latest delivered link
 * works. Errors are recorded as a class or code, never as a message, address
 * or link.
 */

/** A claimed row whose sender died is retried after this lease. */
export const OUTBOX_LEASE_MS = 2 * 60_000;
/** After this many failed attempts a row stays FAILED (the runner reports it). */
export const OUTBOX_MAX_ATTEMPTS = 8;

/** 1, 2, 4 ... minutes, at most 6 hours, after the n-th failed attempt. */
export function outboxBackoffMs(attempts: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempts - 1), 6 * 60 * 60_000);
}

type Tx = Prisma.TransactionClient;

export async function enqueueInviteEmail(tx: Tx, inviteId: string): Promise<string> {
  const row = await tx.emailOutbox.create({
    data: { kind: "TRAVEL_AGENT_INVITE", inviteId },
    select: { id: true },
  });
  return row.id;
}

/**
 * Queues a verification mail for the user's current address. `emailLookup` is
 * the address the caller just read under the User lock; if the address changes
 * before delivery, the row is cancelled instead of sending to either address.
 */
export async function enqueueEmailVerification(tx: Tx, userId: string, emailLookup: string): Promise<string> {
  const row = await tx.emailOutbox.create({
    data: { kind: "EMAIL_VERIFICATION", userId, emailLookup },
    select: { id: true },
  });
  return row.id;
}

export type OutboxOutcome = "SENT" | "CANCELLED" | "RETRY" | "FAILED" | "NOT_DUE";

export interface OutboxResult {
  id: string;
  kind: EmailOutboxKind | null;
  outcome: OutboxOutcome;
  /** Class or code of the failure or cancellation reason (no personal data). */
  code?: string;
}

/** Test-only fault injection (dependency injection; no production surface). */
export interface OutboxHooks {
  /** Runs after the token was minted and before the mail is handed to the transport. */
  beforeSend?: () => Promise<void>;
}

class OutboxError extends Error {
  constructor(public code: string) {
    super(code);
    this.name = "OutboxError";
  }
}

function errorCode(error: unknown): string {
  if (error instanceof OutboxError) return error.code;
  if (error instanceof HttpError) return `HTTP_${error.status}`;
  if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string") {
    return String((error as { code: string }).code).slice(0, 40);
  }
  return error instanceof Error ? error.name.slice(0, 40) : "UNKNOWN";
}

type Prepared =
  | { cancel: string }
  | { cancel?: undefined; send: (linkBase: string) => Promise<SendEmailResult> };

/** Mints the invitation token (hash only) if the invite can still be accepted. */
async function prepareInvite(row: EmailOutbox): Promise<Prepared> {
  if (!row.inviteId) return { cancel: "NO_INVITE" };
  const inviteId = row.inviteId;
  return prisma.$transaction(async (tx) => {
    const invite = await tx.travelAgentInvite.findUnique({
      where: { id: inviteId },
      select: {
        id: true, email: true, acceptedAt: true, travelAgentId: true, organizationId: true,
        travelAgent: { select: { name: true, status: true } },
        organization: { select: { name: true, status: true } },
      },
    });
    if (!invite || invite.acceptedAt || !invite.travelAgentId || !invite.travelAgent) return { cancel: "INVITE_CLOSED" };
    const link = await tx.travelAgentOrganization.findUnique({
      where: { travelAgentId_organizationId: { travelAgentId: invite.travelAgentId, organizationId: invite.organizationId } },
      select: { status: true },
    });
    if (
      !link || (link.status !== "PENDING" && link.status !== "INVITED") ||
      invite.travelAgent.status !== "ACTIVE" || invite.organization.status !== "ACTIVE"
    ) {
      return { cancel: "AGENT_INACTIVE" };
    }
    const rawToken = generateEmailToken();
    const minted = await tx.travelAgentInvite.updateMany({
      where: { id: invite.id, acceptedAt: null },
      data: { tokenHash: hashInviteToken(rawToken), expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS) },
    });
    if (minted.count !== 1) return { cancel: "INVITE_CLOSED" };
    const to = invite.email;
    const agentName = invite.travelAgent.name;
    const organizationName = invite.organization.name;
    return {
      send: (linkBase: string) =>
        sendTravelAgentInviteEmail({
          to, agentName, organizationName,
          acceptUrl: emailTokenLink(linkBase, ACCEPT_INVITATION_PATH, rawToken),
        }),
    };
  });
}

/**
 * Mints a verification token for the user's current address, under the User
 * lock so an email change (PATCH /api/auth/me takes the same lock) cannot
 * interleave: the snapshot must still match, otherwise the row is cancelled.
 */
async function prepareVerification(row: EmailOutbox): Promise<Prepared> {
  if (!row.userId || !row.emailLookup) return { cancel: "NO_USER" };
  const userId = row.userId;
  const snapshot = row.emailLookup;
  return prisma.$transaction(async (tx) => {
    await lockUser(tx, userId);
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, emailLookup: true, emailVerifiedAt: true, status: true },
    });
    if (user.status !== "ACTIVE" || user.emailLookup !== snapshot) return { cancel: "EMAIL_CHANGED" };
    if (user.emailVerifiedAt) return { cancel: "ALREADY_VERIFIED" };
    const rawToken = generateEmailToken();
    // Only the newest link works.
    await tx.emailVerificationToken.deleteMany({ where: { userId, consumedAt: null } });
    await tx.emailVerificationToken.create({
      data: {
        userId, purpose: "VERIFY_EMAIL", emailLookup: snapshot,
        tokenHash: hashEmailVerificationToken(rawToken),
        expiresAt: new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS),
      },
    });
    const to = user.email;
    return {
      send: (linkBase: string) =>
        sendEmailVerificationEmail({ to, verifyUrl: emailTokenLink(linkBase, VERIFY_EMAIL_PATH, rawToken) }),
    };
  });
}

/**
 * Delivers one queued mail if it is due (or its sender's lease ran out).
 * Safe to call concurrently: the claim is a compare-and-set. No network call
 * runs inside a database transaction.
 */
export async function deliverEmailOutbox(
  id: string,
  options: { now?: Date; hooks?: OutboxHooks } = {},
): Promise<OutboxResult> {
  const now = options.now ?? new Date();
  const claimed = await prisma.emailOutbox.updateMany({
    where: {
      id,
      OR: [
        { status: "PENDING", nextAttemptAt: { lte: now } },
        { status: "SENDING", leaseUntil: { lt: now } },
      ],
    },
    data: { status: "SENDING", leaseUntil: new Date(now.getTime() + OUTBOX_LEASE_MS), attempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return { id, kind: null, outcome: "NOT_DUE" };
  const row = await prisma.emailOutbox.findUniqueOrThrow({ where: { id } });

  try {
    const linkBase = emailLinkBase();
    if (!linkBase) throw new OutboxError("LINK_BASE_UNAVAILABLE");
    const prepared = row.kind === "TRAVEL_AGENT_INVITE" ? await prepareInvite(row) : await prepareVerification(row);
    if (prepared.cancel !== undefined) {
      await prisma.emailOutbox.updateMany({
        where: { id, status: "SENDING" },
        data: { status: "CANCELLED", leaseUntil: null, lastError: prepared.cancel },
      });
      return { id, kind: row.kind, outcome: "CANCELLED", code: prepared.cancel };
    }
    await options.hooks?.beforeSend?.();
    const result = await prepared.send(linkBase);
    if (!result.sent) throw new OutboxError("MAIL_NOT_CONFIGURED");
    await prisma.emailOutbox.updateMany({
      where: { id, status: "SENDING" },
      data: { status: "SENT", sentAt: new Date(), leaseUntil: null, lastError: null },
    });
    return { id, kind: row.kind, outcome: "SENT" };
  } catch (error) {
    const code = errorCode(error);
    const failed = row.attempts >= OUTBOX_MAX_ATTEMPTS;
    await prisma.emailOutbox.updateMany({
      where: { id, status: "SENDING" },
      data: {
        status: failed ? "FAILED" : "PENDING",
        nextAttemptAt: new Date(now.getTime() + outboxBackoffMs(row.attempts)),
        leaseUntil: null,
        lastError: code,
      },
    });
    console.error(`[email-outbox] ${row.kind} ${id} attempt ${row.attempts} failed: ${code}`);
    return { id, kind: row.kind, outcome: failed ? "FAILED" : "RETRY", code };
  }
}

/** For `after()` in a route: never throws, logs only the outbox id and a code. */
export async function deliverEmailOutboxSafely(id: string): Promise<void> {
  try {
    await deliverEmailOutbox(id);
  } catch (error) {
    console.error(`[email-outbox] ${id} delivery attempt crashed: ${errorCode(error)}`);
  }
}

/** One runner pass: every row that is due now, oldest first. */
export async function processDueEmailOutbox(
  options: { limit?: number; now?: Date; hooks?: OutboxHooks } = {},
): Promise<OutboxResult[]> {
  const now = options.now ?? new Date();
  const due = await prisma.emailOutbox.findMany({
    where: {
      OR: [
        { status: "PENDING", nextAttemptAt: { lte: now } },
        { status: "SENDING", leaseUntil: { lt: now } },
      ],
    },
    orderBy: { nextAttemptAt: "asc" },
    take: options.limit ?? 50,
    select: { id: true },
  });
  const results: OutboxResult[] = [];
  for (const { id } of due) {
    try {
      results.push(await deliverEmailOutbox(id, { now, hooks: options.hooks }));
    } catch (error) {
      results.push({ id, kind: null, outcome: "RETRY", code: errorCode(error) });
    }
  }
  return results;
}
