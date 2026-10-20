import type { Prisma } from "@prisma/client";
import { logAudit } from "./audit";
import { lockUser } from "./db-locks";
import { enqueueEmailVerification, enqueueInviteEmail } from "./email-outbox";
import { hashEmailVerificationToken, hashInviteToken } from "./email-tokens";
import { emailLookupHash } from "./encryption";
import { prisma } from "./prisma";
import { VERIFIED_MEMBERSHIP } from "./travel-agent-access";
import { HttpError } from "./rbac";
import { afterCommitSafely, runWalletTransaction } from "./wallet-service";

/**
 * Travel-agent invitations and account email verification (A03, SEC-03).
 *
 * Access to a travel agent's trips is granted only to an account that proved
 * it reads the invited mailbox: it must be signed in with that address and use
 * the single-use token emailed to it. Registering with (or changing to) an
 * address proves nothing and never creates a membership.
 *
 * Lock order: User -> TravelAgentOrganization link (see lib/db-locks.ts).
 */

export const INVITE_INVALID = "Tautan undangan tidak valid. Buka tautan terbaru dari email undangan.";
export const INVITE_USED = "Undangan sudah digunakan";
export const INVITE_EXPIRED = "Tautan undangan sudah kedaluwarsa. Minta admin organisasi mengirim ulang undangan.";
export const INVITE_EMAIL_MISMATCH =
  "Undangan ini dikirim ke alamat email lain. Masuk dengan akun yang memakai alamat email undangan.";
export const INVITE_INACTIVE = "Travel agent atau organisasi ini sedang tidak aktif. Hubungi admin organisasi.";
const ACCOUNT_INACTIVE = "Akun tidak aktif";

export const VERIFY_INVALID = "Tautan verifikasi tidak valid. Buka tautan terbaru dari email Anda.";
export const VERIFY_USED = "Tautan verifikasi sudah digunakan";
export const VERIFY_EXPIRED = "Tautan verifikasi sudah kedaluwarsa. Kirim ulang tautan verifikasi dari halaman profil.";
export const VERIFY_EMAIL_CHANGED =
  "Email akun sudah berubah sejak tautan ini dikirim. Kirim ulang tautan verifikasi.";

export { VERIFIED_MEMBERSHIP };

/** Invite fields an API may return: never tokenHash. */
export const INVITE_PUBLIC_SELECT = {
  id: true, travelAgentId: true, organizationId: true, email: true, status: true,
  createdAt: true, expiresAt: true, acceptedAt: true,
} satisfies Prisma.TravelAgentInviteSelect;

export type InviteState = "NOT_SENT" | "SENT" | "EXPIRED" | "ACCEPTED";

/** Admin-facing state of the latest invitation (null: none issued yet). */
export function inviteSummary(
  invite: { createdAt: Date; expiresAt: Date | null; acceptedAt: Date | null } | undefined,
  now = Date.now(),
): { state: InviteState; createdAt: string; expiresAt: string | null; acceptedAt: string | null } | null {
  if (!invite) return null;
  const state: InviteState = invite.acceptedAt
    ? "ACCEPTED"
    : !invite.expiresAt
      ? "NOT_SENT"
      : invite.expiresAt.getTime() <= now
        ? "EXPIRED"
        : "SENT";
  return {
    state,
    createdAt: invite.createdAt.toISOString(),
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
  };
}

/** Test-only hooks (dependency injection, tests/support/race-probe.ts). */
export interface InvitationHooks {
  /** Runs inside the transaction right after the locks are held. */
  afterLock?: (tx: Prisma.TransactionClient) => Promise<void>;
}

type Tx = Prisma.TransactionClient;

/**
 * Accepts the invitation whose emailed token is `token` for the signed-in
 * `userId`. Checks, under the User lock and the agent-organization link lock:
 * the token is current, unused and unexpired, the account's current email is
 * the invited address, and the agent, the organization and the link are
 * active. Then, atomically: consumes the invitation (compare-and-set), creates
 * or verifies the membership, activates a PENDING link, and marks the
 * account's email verified (the token proved that mailbox).
 */
export async function acceptTravelAgentInvite(
  userId: string,
  token: string,
  hooks: InvitationHooks = {},
): Promise<{ travelAgentId: string; organizationId: string }> {
  const tokenHash = hashInviteToken(token);
  // Immutable relations first: the invite id, its agent and its organization.
  const found = await prisma.travelAgentInvite.findUnique({
    where: { tokenHash },
    select: { id: true, travelAgentId: true, organizationId: true },
  });
  if (!found || !found.travelAgentId) throw new HttpError(400, INVITE_INVALID);
  const travelAgentId = found.travelAgentId;
  const organizationId = found.organizationId;

  const outcome = await runWalletTransaction(async (tx) => {
    await lockUser(tx, userId);
    const links = await tx.$queryRaw<{ id: string; status: string }[]>`
      SELECT id, status::text AS status FROM "TravelAgentOrganization"
      WHERE "travelAgentId" = ${travelAgentId} AND "organizationId" = ${organizationId}
      FOR NO KEY UPDATE`;
    await hooks.afterLock?.(tx);

    // Re-read everything the decision depends on under the locks.
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { emailLookup: true, status: true } });
    const invite = await tx.travelAgentInvite.findUnique({
      where: { id: found.id },
      select: {
        id: true, tokenHash: true, email: true, expiresAt: true, acceptedAt: true,
        travelAgent: { select: { status: true } },
        organization: { select: { status: true } },
      },
    });
    if (!invite || invite.tokenHash !== tokenHash) throw new HttpError(400, INVITE_INVALID);
    if (invite.acceptedAt) throw new HttpError(409, INVITE_USED);
    if (!invite.expiresAt || invite.expiresAt.getTime() <= Date.now()) throw new HttpError(410, INVITE_EXPIRED);
    // The invited address must be this account's current address (normalized
    // blind index; an email change after the invite was sent fails here).
    if (user.status !== "ACTIVE") throw new HttpError(403, ACCOUNT_INACTIVE);
    if (emailLookupHash(invite.email) !== user.emailLookup) throw new HttpError(403, INVITE_EMAIL_MISMATCH);
    const link = links[0];
    if (
      !link || (link.status !== "PENDING" && link.status !== "INVITED") ||
      invite.travelAgent?.status !== "ACTIVE" || invite.organization.status !== "ACTIVE"
    ) {
      throw new HttpError(403, INVITE_INACTIVE);
    }

    const consumed = await tx.travelAgentInvite.updateMany({
      where:{id:invite.id,acceptedAt:null,expiresAt:{gt:new Date()}},
      data:{acceptedAt:new Date(),acceptedById:userId},
    });
    if (consumed.count !== 1) throw new HttpError(409,"Undangan sudah digunakan");

    const now = new Date();
    await tx.travelAgentInvite.update({ where: { id: invite.id }, data: { status: "INVITED" } });
    await tx.travelAgentUser.upsert({
      where: { travelAgentId_userId: { travelAgentId, userId } },
      create: { travelAgentId, userId, roleInAgent: "OWNER", verifiedAt: now },
      update: { verifiedAt: now },
    });
    if (link.status === "PENDING") {
      await tx.travelAgentOrganization.update({ where: { id: link.id }, data: { status: "INVITED", approvedAt: now } });
    }
    // The token reached this account's current address: the mailbox is proven.
    await tx.user.updateMany({ where: { id: userId, emailVerifiedAt: null }, data: { emailVerifiedAt: now } });
    return { inviteId: invite.id, linkActivated: link.status === "PENDING" };
  });

  await afterCommitSafely("audit TRAVEL_AGENT_INVITE_ACCEPTED", () =>
    logAudit({
      actorId: userId,
      action: "TRAVEL_AGENT_INVITE_ACCEPTED",
      entityType: "TravelAgentInvite",
      entityId: outcome.inviteId,
      metadata: { travelAgentId, organizationId, linkActivated: outcome.linkActivated },
    }),
  );
  return { travelAgentId, organizationId };
}

/**
 * Marks the signed-in account's email verified with the token emailed to it.
 * The token must belong to this account, be unused and unexpired, and have
 * been sent to the account's current address (emailLookup snapshot).
 */
export async function verifyEmailToken(userId: string, token: string, hooks: InvitationHooks = {}): Promise<void> {
  const tokenHash = hashEmailVerificationToken(token);
  const found = await prisma.emailVerificationToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true },
  });
  // Another account's token is answered like an unknown one.
  if (!found || found.userId !== userId) throw new HttpError(400, VERIFY_INVALID);

  await runWalletTransaction(async (tx) => {
    await lockUser(tx, userId);
    await hooks.afterLock?.(tx);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { emailLookup: true } });
    const row = await tx.emailVerificationToken.findUnique({ where: { id: found.id } });
    if (!row || row.tokenHash !== tokenHash || row.purpose !== "VERIFY_EMAIL") throw new HttpError(400, VERIFY_INVALID);
    if (row.consumedAt) throw new HttpError(409, VERIFY_USED);
    if (row.expiresAt.getTime() <= Date.now()) throw new HttpError(410, VERIFY_EXPIRED);
    if (row.emailLookup !== user.emailLookup) throw new HttpError(409, VERIFY_EMAIL_CHANGED);

    const consumed = await tx.emailVerificationToken.updateMany({
      where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new HttpError(409, VERIFY_USED);
    await tx.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() }, select: { id: true } });
  });

  await afterCommitSafely("audit EMAIL_VERIFIED", () =>
    logAudit({ actorId: userId, action: "EMAIL_VERIFIED", entityType: "User", entityId: userId }),
  );
}

/**
 * What an email change must undo, in the caller's transaction under the User
 * lock (PATCH /api/auth/me): memberships are no longer verified and
 * outstanding verification links for the old address stop working. The caller
 * also sets User.emailVerifiedAt to null in the same update as the address.
 */
export async function clearMailboxProof(tx: Tx, userId: string): Promise<{ membershipsUnverified: number }> {
  const memberships = await tx.travelAgentUser.updateMany({
    where: { userId, verifiedAt: { not: null } },
    data: { verifiedAt: null },
  });
  await tx.emailVerificationToken.deleteMany({ where: { userId, consumedAt: null } });
  return { membershipsUnverified: memberships.count };
}

/** Queues a verification mail for the user's current address (caller holds the User lock). */
export async function queueEmailVerification(tx: Tx, userId: string): Promise<string | null> {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: userId },
    select: { emailLookup: true, emailVerifiedAt: true },
  });
  if (user.emailVerifiedAt) return null;
  return enqueueEmailVerification(tx, userId, user.emailLookup);
}

/**
 * Creates (or re-sends) the invitation of `email` to manage the agent for the
 * organization and queues its mail. An open invitation (not yet accepted) for
 * the same agent, organization and address is reused: its next delivery mints
 * a new token, so only the latest link works. No membership is created here.
 */
export async function issueTravelAgentInvite(
  tx: Tx,
  input: { travelAgentId: string; organizationId: string; email: string; invitedById: string },
): Promise<{ inviteId: string; outboxId: string; reused: boolean }> {
  const open = await tx.travelAgentInvite.findFirst({
    where: {
      travelAgentId: input.travelAgentId,
      organizationId: input.organizationId,
      email: input.email,
      acceptedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  const invite = open
    ? await tx.travelAgentInvite.update({
        where: { id: open.id },
        data: { invitedById: input.invitedById, status: "PENDING" },
        select: { id: true },
      })
    : await tx.travelAgentInvite.create({
        data: {
          travelAgentId: input.travelAgentId,
          organizationId: input.organizationId,
          email: input.email,
          status: "PENDING",
          invitedById: input.invitedById,
        },
        select: { id: true },
      });
  const outboxId = await enqueueInviteEmail(tx, invite.id);
  return { inviteId: invite.id, outboxId, reused: Boolean(open) };
}

export interface AccessImpactRow {
  membershipId: string;
  userId: string;
  travelAgentId: string;
  travelAgentName: string;
  roleInAgent: string;
  /** Why the membership grants no trip access from A03 on. */
  reason: "MEMBERSHIP_UNVERIFIED" | "EMAIL_UNVERIFIED";
  /** Organizations where the agent is INVITED (trips there were visible before A03). */
  invitedOrganizations: { organizationId: string; organizationName: string }[];
  /** Trips visible through this membership only (not as reward recipient). */
  tripsLosingAccess: number;
  membershipCreatedAt: string;
}

export interface AccessImpactReport {
  generatedAt: string;
  affectedMemberships: number;
  affectedUsers: number;
  /** Memberships that currently see at least one trip and lose that access. */
  membershipsLosingTrips: number;
  rows: AccessImpactRow[];
}

/**
 * Read-only rollout report (scripts/report-travel-agent-access.ts): every
 * membership that does not pass VERIFIED_MEMBERSHIP, i.e. who loses travel
 * agent trip access when A03 is enforced, and how many trips each one sees
 * today. Ids and agent/organization names only; no personal data.
 */
export async function travelAgentAccessImpact(db: Pick<typeof prisma, "travelAgentUser" | "travelAgentOrganization" | "trip"> = prisma): Promise<AccessImpactReport> {
  const memberships = await db.travelAgentUser.findMany({
    where: { NOT: VERIFIED_MEMBERSHIP },
    orderBy: [{ travelAgentId: "asc" }, { userId: "asc" }],
    select: {
      id: true, userId: true, travelAgentId: true, roleInAgent: true, verifiedAt: true, createdAt: true,
      travelAgent: { select: { name: true } },
    },
  });
  const rows: AccessImpactRow[] = [];
  for (const membership of memberships) {
    const invited = await db.travelAgentOrganization.findMany({
      where: { travelAgentId: membership.travelAgentId, status: "INVITED" },
      orderBy: { organizationId: "asc" },
      select: { organizationId: true, organization: { select: { name: true } } },
    });
    const tripsLosingAccess = invited.length
      ? await db.trip.count({
          where: {
            travelAgentId: membership.travelAgentId,
            campaign: { organizationId: { in: invited.map((link) => link.organizationId) } },
            OR: [{ userId: null }, { userId: { not: membership.userId } }],
          },
        })
      : 0;
    rows.push({
      membershipId: membership.id,
      userId: membership.userId,
      travelAgentId: membership.travelAgentId,
      travelAgentName: membership.travelAgent.name,
      roleInAgent: membership.roleInAgent,
      reason: membership.verifiedAt ? "EMAIL_UNVERIFIED" : "MEMBERSHIP_UNVERIFIED",
      invitedOrganizations: invited.map((link) => ({
        organizationId: link.organizationId,
        organizationName: link.organization.name,
      })),
      tripsLosingAccess,
      membershipCreatedAt: membership.createdAt.toISOString(),
    });
  }
  return {
    generatedAt: new Date().toISOString(),
    affectedMemberships: rows.length,
    affectedUsers: new Set(rows.map((row) => row.userId)).size,
    membershipsLosingTrips: rows.filter((row) => row.tripsLosingAccess > 0).length,
    rows,
  };
}
