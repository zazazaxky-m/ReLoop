import { Prisma, type Campaign, type DepositSession, type SessionStatus } from "@prisma/client";
import { logAudit } from "./audit";
import { isCampaignEligible } from "./campaign";
import { lockCampaign, lockDepositItem, lockDepositSession, lockMachine, lockUser } from "./db-locks";
import { InvalidSessionTransitionError, machineAcceptsSessions, transitionSession } from "./machine-state";
import { prisma } from "./prisma";
import { isTokenValid } from "./qr";
import { SESSION_CLOSED_REASON, SESSION_TIMEOUT_REASON } from "./machine-events/shared";
import { HttpError, type CurrentUser } from "./rbac";
import {
  FUNDING_INSUFFICIENT,
  fundingPolicy,
  lockFundingAccountForOrganization,
  reserveRewardBudget,
  resolveSessionCeiling,
  sessionAdmissionKey,
} from "./reward-funding";
import { campaignSupportsMachine, machineRewardMode } from "./reward-policy";
import {
  buildSessionPolicy,
  parseSessionPolicy,
  sessionLimits,
  sessionPolicyColumns,
  type SessionLimits,
  type SessionPolicySnapshot,
} from "./session-policy";
import { runWalletTransaction } from "./wallet-service";
import { MACHINE_LEASE_MAX_SECONDS, machineLeaseExpiry, sessionDeadline, sessionEnd } from "./deposit-session-deadline";

export { MACHINE_LEASE_MAX_SECONDS, machineLeaseExpiry, sessionDeadline, sessionEnd };

/**
 * Deposit sessions on a machine (task R03, finding EX-04).
 *
 * Exclusivity. A machine has at most one active session (RESERVED, ACTIVE,
 * PROCESSING_ITEM or REVIEW). Every writer that starts or ends one runs in a
 * ReadCommitted transaction that locks the User, then the Machine row
 * (lib/db-locks.ts order: User -> RewardFundingAccount -> Campaign -> Machine ->
 * DepositSession -> DepositItem), and only then re-reads the machine, its
 * sessions and the campaign. The lock alone keeps exclusivity in the expand
 * release. The partial unique index "DepositSession_one_active_per_machine"
 * is the database backstop of the later enforce release (staged in
 * prisma/migrations-enforce/one_active_machine_session_enforce, deployed only
 * after `npm run reconcile:sessions` exits 0); its unique violation is
 * answered as a resume (same owner) or 409 (anyone else), never as a 500.
 *
 * Release. A session leaves its machine only by
 *  - finish/cancel by its owner, refused while the machine still decides an
 *    item (`undecided`: PENDING, no acceptance point), or
 *  - the timeout policy (`expireTimedOutSessions`): only after the session's
 *    deadline, when every lease the server issued for it has expired (see the
 *    clock assumption in lib/deposit-session-deadline.ts). Undecided items go
 *    to REVIEW (reason SESSION_TIMEOUT); nothing is deleted and no money moves.
 * A newer scan never overwrites or replaces a live session, and the machine
 * lease never chooses between several live sessions.
 */

export const ACTIVE_SESSION_STATUSES = [
  "RESERVED",
  "ACTIVE",
  "PROCESSING_ITEM",
  "REVIEW",
] as const satisfies readonly SessionStatus[];

export function isActiveSession(status: SessionStatus | string): boolean {
  return (ACTIVE_SESSION_STATUSES as readonly string[]).includes(status);
}

// User-facing messages: neutral, Indonesian, never naming the other user or a
// protocol detail.
export const MACHINE_IN_USE = "Mesin sedang digunakan. Silakan coba lagi nanti atau gunakan mesin lain.";
export const MACHINE_UNAVAILABLE = "Mesin sedang tidak dapat digunakan. Silakan gunakan mesin lain.";
export const ITEM_STILL_PROCESSING = "Mesin masih memproses item terakhir Anda. Tunggu sebentar, lalu coba lagi.";
export const SESSION_CANNOT_END = "Sesi tidak dapat diselesaikan saat ini.";
export const CAMPAIGN_NOT_FOR_MACHINE = "Campaign ini tidak berlaku untuk setoran mesin";
export const MACHINE_CHANGED = "Konfigurasi mesin berubah. Silakan scan ulang QR mesin.";

export { SESSION_CLOSED_REASON, SESSION_TIMEOUT_REASON };

/** Items the machine has not decided yet: physically still in the machine. */
export function undecidedItemsWhere(sessionId: string): Prisma.DepositItemWhereInput {
  return { sessionId, status: "PENDING", acceptanceEventId: null };
}

export interface ExpiredSession {
  sessionId: string;
  userId: string;
  heldItemIds: string[];
}

/**
 * The timeout policy, inside the caller's transaction. The caller already
 * holds the Machine lock (after a User lock). Locks every given session, then
 * every undecided item of those still to close, each class in id order (the
 * global lock order: all DepositSession rows before any DepositItem row),
 * re-reading each row after its lock. A session closes only when it is still
 * active and its deadline has passed: every lease issued for it expired then
 * (`machineLeaseExpiry`), so the machine is no longer running it. Each
 * undecided item moves to REVIEW with reason SESSION_TIMEOUT (an existing
 * reason is kept): a later acceptance/rejection event of this same session
 * still decides it (an acceptance made after the deadline is held for review,
 * lib/machine-events/acceptance.ts), or the review queue does. Returns the
 * sessions it closed.
 */
export async function expireTimedOutSessions(
  tx: Prisma.TransactionClient,
  sessionIds: string[],
  idleTimeoutMinutes: number,
  now: Date,
): Promise<ExpiredSession[]> {
  const ids = [...new Set(sessionIds)].sort();
  for (const id of ids) await lockDepositSession(tx, id);
  const closing: { id: string; userId: string }[] = [];
  for (const id of ids) {
    const session = await tx.depositSession.findUnique({ where: { id } });
    if (!session || !isActiveSession(session.status)) continue;
    if (sessionDeadline(session, idleTimeoutMinutes).getTime() > now.getTime()) continue;
    closing.push({ id, userId: session.userId });
  }
  if (closing.length === 0) return [];

  const undecided = await tx.depositItem.findMany({
    where: { sessionId: { in: closing.map((s) => s.id) }, status: "PENDING", acceptanceEventId: null },
    select: { id: true, sessionId: true },
    orderBy: { id: "asc" },
  });
  const held = new Map<string, string[]>(closing.map((s) => [s.id, []]));
  for (const { id } of undecided) await lockDepositItem(tx, id);
  for (const { id, sessionId } of undecided) {
    const item = await tx.depositItem.findUnique({
      where: { id },
      select: { status: true, acceptanceEventId: true, validationReasonCode: true },
    });
    if (!item || item.status !== "PENDING" || item.acceptanceEventId !== null) continue;
    const { count } = await tx.depositItem.updateMany({
      where: { id, status: "PENDING", acceptanceEventId: null },
      data: { status: "REVIEW", validationReasonCode: item.validationReasonCode ?? SESSION_TIMEOUT_REASON },
    });
    if (count === 1) held.get(sessionId)?.push(id);
  }
  for (const { id } of closing) {
    await tx.depositSession.update({
      where: { id },
      data: { status: "EXPIRED", completedAt: now },
    });
  }
  return closing.map((s) => ({ sessionId: s.id, userId: s.userId, heldItemIds: held.get(s.id) ?? [] }));
}

/** The timeout policy for one session (`expireTimedOutSessions`); null when it stays. */
export async function expireIfTimedOut(
  tx: Prisma.TransactionClient,
  sessionId: string,
  idleTimeoutMinutes: number,
  now: Date,
): Promise<ExpiredSession | null> {
  return (await expireTimedOutSessions(tx, [sessionId], idleTimeoutMinutes, now))[0] ?? null;
}

async function auditExpired(expired: ExpiredSession[], closedBy: "scan" | "machine-poll" | "owner") {
  for (const entry of expired) {
    await logAudit({
      actorId: null,
      action: "DEPOSIT_SESSION_EXPIRE",
      entityType: "DepositSession",
      entityId: entry.sessionId,
      metadata: { reason: "TIMEOUT", closedBy, heldItemIds: entry.heldItemIds },
    });
  }
}

/** P2002 from the active-session index: another writer holds the machine. */
function isActiveSessionConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const meta = (error.meta ?? {}) as { target?: unknown; modelName?: unknown };
  const target = Array.isArray(meta.target) ? meta.target.join(",") : String(meta.target ?? "");
  return /machineId|one_active_per_machine/.test(target) || meta.modelName === "DepositSession";
}

export interface DepositSessionHooks {
  /** Test seam (tests/integration): runs inside the transaction right before the insert. */
  beforeCreate?: (tx: Prisma.TransactionClient) => Promise<void>;
}

type StartDecision =
  | { kind: "created"; session: DepositSession; expired: ExpiredSession[]; campaignId: string | null }
  | { kind: "resumed"; session: DepositSession; expired: ExpiredSession[] }
  | { kind: "busy"; expired: ExpiredSession[] }
  | { kind: "conflict"; sessionIds: string[]; expired: ExpiredSession[] };

async function assertCampaignForMachine(
  tx: Prisma.TransactionClient,
  actorId: string,
  organizationId: string,
  campaignId: string,
): Promise<Campaign> {
  const campaign = await tx.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.organizationId !== organizationId) {
    throw new HttpError(422, "Campaign tidak valid untuk mesin ini");
  }
  // M04: only machine programs (MACHINE_DEPOSIT, or EVENT/SCHOOL_PROGRAM with
  // supportsMachine) can bind a deposit session; trip programs never.
  if (!campaignSupportsMachine(campaign)) throw new HttpError(422, CAMPAIGN_NOT_FOR_MACHINE);
  const user = await tx.user.findUnique({ where: { id: actorId }, select: { email: true } });
  if (!isCampaignEligible(campaign, user?.email ?? "").eligible) {
    throw new HttpError(403, "Anda tidak memenuhi syarat campaign ini");
  }
  return campaign;
}

/**
 * B01: reserves the session's reward ceiling before it is admitted (the
 * session row is inserted in the same transaction, so a refused reservation
 * rolls it back). COMPLIANCE_ONLY admits nothing with money and reserves
 * nothing. A money program without a configured ceiling is refused under
 * enforcement; in shadow mode it is admitted with a zero ceiling, which the
 * reconciliation report lists so the operator configures it before enforcing.
 */
async function reserveSessionCeiling(
  tx: Prisma.TransactionClient,
  session: Pick<DepositSession, "id" | "userId">,
  machine: { id: string; organizationId: string; maxRewardPerSessionRupiah: number | null; organization: { machineRewardMode: string } },
  campaign: Campaign | null,
): Promise<{ ceilingRupiah: number; reservationId: string } | null> {
  const mode = machineRewardMode({ campaign, organizationMode: machine.organization.machineRewardMode });
  if (mode !== "MONEY_REWARD") return null;
  const policy = fundingPolicy();
  const configured = resolveSessionCeiling({ campaign, machine });
  if (configured === null) {
    console.warn("[deposit-session] money session without a configured reward ceiling", {
      machineId: machine.id,
      campaignId: campaign?.id ?? null,
      enforced: policy.enforced,
    });
    if (policy.enforced) throw new HttpError(409, FUNDING_INSUFFICIENT);
  }
  const ceilingRupiah = configured ?? 0;
  const reservationId = await reserveRewardBudget(
    tx,
    {
      businessKey: sessionAdmissionKey(session.id),
      organizationId: machine.organizationId,
      campaignId: campaign?.id ?? null,
      userId: session.userId,
      ceilingRupiah,
      sourceType: "SESSION",
      sourceId: session.id,
    },
    policy,
  );
  return { ceilingRupiah, reservationId };
}

async function decideStart(
  tx: Prisma.TransactionClient,
  actor: CurrentUser,
  input: { machineCode: string; token: string; campaignId?: string },
  ref: { id: string; organizationId: string },
  hooks: DepositSessionHooks | undefined,
): Promise<StartDecision> {
  const machineId = ref.id;
  await lockUser(tx, actor.id);
  // B01 (global lock order): the organization's funding account and the
  // requested campaign come before the Machine row. The campaign's existence
  // is immutable; its content is re-read under the locks (assertCampaignForMachine).
  await lockFundingAccountForOrganization(tx, ref.organizationId);
  if (input.campaignId) {
    const known = await tx.campaign.findUnique({ where: { id: input.campaignId }, select: { id: true } });
    if (!known) throw new HttpError(422, "Campaign tidak valid untuk mesin ini");
    await lockCampaign(tx, input.campaignId);
  }
  await lockMachine(tx, machineId);

  const machine = await tx.machine.findUnique({
    where: { id: machineId },
    include: {
      organization: { select: { status: true, machineRewardMode: true } },
      // B01b: the admission snapshot prices every active type of the machine.
      wasteTypes: { where: { active: true }, include: { wasteType: true } },
    },
  });
  if (!machine) throw new HttpError(404, "Mesin tidak ditemukan");
  // The account locked above belongs to the organization read before the lock.
  if (machine.organizationId !== ref.organizationId) throw new HttpError(409, MACHINE_CHANGED);
  if (!isTokenValid(machine, input.token)) {
    console.warn("[scan] invalid QR token", { machineCode: input.machineCode, userId: actor.id });
    throw new HttpError(
      401,
      "QR token tidak valid atau sudah kedaluwarsa. Silakan scan QR terbaru dari layar mesin.",
    );
  }
  if (!machineAcceptsSessions(machine.status)) throw new HttpError(409, "Mesin tidak menerima setoran saat ini");
  if (machine.organization.status !== "ACTIVE") throw new HttpError(409, "Organisasi mesin tidak aktif");
  if (machine.wasteTypes.length === 0) throw new HttpError(409, "Mesin belum dikonfigurasi jenis sampah");

  const now = new Date();
  const idle = machine.sessionIdleTimeoutMinutes;
  // Under the Machine lock no session of this machine starts or ends (every
  // such writer takes it); machine events only move a session between active
  // states or extend its deadline, which expireIfTimedOut re-reads.
  const active = await tx.depositSession.findMany({
    where: { machineId, status: { in: [...ACTIVE_SESSION_STATUSES] } },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });
  const timedOut = active.filter((s) => sessionDeadline(s, idle).getTime() <= now.getTime());
  const live = active.filter((s) => !timedOut.includes(s));

  // Validate the campaign before any write, so a refused request changes nothing.
  const campaignId = input.campaignId ?? null;
  const campaign =
    live.length === 0 && campaignId ? await assertCampaignForMachine(tx, actor.id, machine.organizationId, campaignId) : null;

  // All timed-out sessions together: sessions, then items, each in id order (M1).
  const expired = await expireTimedOutSessions(tx, timedOut.map((s) => s.id), idle, now);
  const closedIds = new Set(expired.map((e) => e.sessionId));
  for (const session of timedOut) if (!closedIds.has(session.id)) live.push(session);

  if (live.length > 1) return { kind: "conflict", sessionIds: live.map((s) => s.id), expired };
  if (live.length === 1) {
    return live[0].userId === actor.id
      ? { kind: "resumed", session: live[0], expired }
      : { kind: "busy", expired };
  }

  await hooks?.beforeCreate?.(tx);
  // B01b: the admission snapshot (rates, multiplier, mode, bounds) is fixed
  // under the locks before the session exists; the lease signs its version.
  const policy = await buildSessionPolicy(tx, {
    machine, campaign, ceilingRupiah: resolveSessionCeiling({ campaign, machine }), now,
  });
  const session = await tx.depositSession.create({
    data: {
      userId: actor.id,
      machineId,
      campaignId,
      status: "ACTIVE",
      startedAt: now,
      timeoutAt: new Date(now.getTime() + idle * 60_000),
      ...sessionPolicyColumns(policy),
    },
  });
  // B01: reserve the reward ceiling before the admission is committed.
  await reserveSessionCeiling(tx, session, machine, campaign);
  return { kind: "created", session, expired, campaignId };
}

/** The limit the user sees (scan/session responses) from the session's admission snapshot. */
export function sessionLimitsOf(session: { policySnapshotJson: unknown }): SessionLimits {
  return sessionLimits(parseSessionPolicy(session.policySnapshotJson));
}

/**
 * B01b: the admission snapshot of a session, created now for a session
 * admitted before the snapshot existed (its first lease v2 poll), under the
 * admission locks (User -> account -> Campaign -> Machine -> DepositSession)
 * with the row re-read so two polls never write two snapshots. Returns null
 * when the session is gone.
 */
export async function ensureSessionPolicy(sessionId: string): Promise<SessionPolicySnapshot | null> {
  const current = await prisma.depositSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, campaignId: true, policySnapshotJson: true, machine: { select: { id: true, organizationId: true } } },
  });
  if (!current) return null;
  const parsed = parseSessionPolicy(current.policySnapshotJson);
  if (parsed) return parsed;
  return runWalletTransaction(async (tx) => {
    await lockUser(tx, current.userId);
    await lockFundingAccountForOrganization(tx, current.machine.organizationId);
    if (current.campaignId) await lockCampaign(tx, current.campaignId);
    await lockMachine(tx, current.machine.id);
    await lockDepositSession(tx, sessionId);
    const session = await tx.depositSession.findUnique({ where: { id: sessionId }, include: { campaign: true } });
    if (!session) return null;
    const existing = parseSessionPolicy(session.policySnapshotJson);
    if (existing) return existing;
    const machine = await tx.machine.findUnique({
      where: { id: session.machineId },
      include: {
        organization: { select: { machineRewardMode: true } },
        wasteTypes: { where: { active: true }, include: { wasteType: true } },
      },
    });
    if (!machine) return null;
    // C1: the account locked above belongs to the organization read before the
    // locks; a machine moved in between is refused, exactly as the admission does.
    if (machine.organizationId !== current.machine.organizationId || session.machineId !== current.machine.id) {
      throw new HttpError(409, MACHINE_CHANGED);
    }
    const campaign = session.campaign;
    const policy = await buildSessionPolicy(tx, {
      machine, campaign, ceilingRupiah: resolveSessionCeiling({ campaign, machine }), now: new Date(),
    });
    await tx.depositSession.update({ where: { id: sessionId }, data: sessionPolicyColumns(policy) });
    return policy;
  });
}

/**
 * Starts a deposit session for `actor` on the machine, or resumes the one the
 * actor already has there. Another user's live session -> 409 (neutral, no
 * owner details). A timed-out session is closed by the timeout policy first.
 * Several live sessions (legacy data from before the enforce migration) ->
 * 409; the newest is never picked.
 */
export async function startOrResumeDeposit(
  actor: CurrentUser,
  input: { machineCode: string; token: string; campaignId?: string },
  hooks?: DepositSessionHooks,
): Promise<{ session: DepositSession; resumed: boolean }> {
  // Immutable: the id behind the code only tells which Machine row to lock,
  // and its organization which funding account (re-checked under the locks).
  const ref = await prisma.machine.findUnique({
    where: { machineCode: input.machineCode },
    select: { id: true, organizationId: true },
  });
  if (!ref) throw new HttpError(404, "Mesin tidak ditemukan");

  let decision: StartDecision | undefined;
  for (let attempt = 0; !decision; attempt += 1) {
    try {
      decision = await runWalletTransaction((tx) => decideStart(tx, actor, input, ref, attempt === 0 ? hooks : undefined));
    } catch (error) {
      if (!isActiveSessionConflict(error)) throw error;
      // A writer that skipped the machine lock created an active session
      // first; the transaction rolled back. Answer from the committed state.
      const winners = await prisma.depositSession.findMany({
        where: { machineId: ref.id, status: { in: [...ACTIVE_SESSION_STATUSES] } },
        take: 2,
      });
      if (winners.length === 1 && winners[0].userId === actor.id) return { session: winners[0], resumed: true };
      if (winners.length > 0 || attempt >= 1) throw new HttpError(409, MACHINE_IN_USE);
      // The winner already ended: decide again once.
    }
  }

  await auditExpired(decision.expired, "scan");
  switch (decision.kind) {
    case "created":
      await logAudit({
        actorId: actor.id,
        action: "DEPOSIT_SESSION_START",
        entityType: "DepositSession",
        entityId: decision.session.id,
        metadata: { machineCode: input.machineCode, campaignId: decision.campaignId },
      });
      return { session: decision.session, resumed: false };
    case "resumed":
      return { session: decision.session, resumed: true };
    case "busy":
      throw new HttpError(409, MACHINE_IN_USE);
    case "conflict":
      console.error("[deposit-session] machine has several active sessions; run scripts/reconcile-active-sessions.ts", {
        machineId: ref.id,
        sessionIds: decision.sessionIds,
      });
      throw new HttpError(409, MACHINE_UNAVAILABLE);
  }
}

export interface ActiveDepositSummary {
  id: string;
  status: SessionStatus;
  startedAt: Date;
  timeoutAt: Date | null;
  updatedAt: Date;
  /** Past its deadline: the next machine poll or scan closes it through the timeout policy. */
  timedOut: boolean;
  machine: { id: string; machineCode: string; name: string };
  items: { id: string; wasteTypeName: string; quantity: number; status: string; rewardAmount: number }[];
}

/**
 * The caller's own active sessions (optionally on one machine), read-only: no
 * lease, no deadline extension, no write. `session` is the single active
 * session, or null when there is none or several (the client must let the
 * user choose; the latest is never picked silently). Another user's session is
 * never visible here.
 */
export async function getActiveDepositForUser(
  userId: string,
  machineCode?: string,
): Promise<{ session: ActiveDepositSummary | null; sessions: ActiveDepositSummary[] }> {
  const rows = await prisma.depositSession.findMany({
    where: {
      userId,
      status: { in: [...ACTIVE_SESSION_STATUSES] },
      ...(machineCode ? { machine: { machineCode } } : {}),
    },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
    include: {
      machine: { select: { id: true, machineCode: true, name: true, sessionIdleTimeoutMinutes: true } },
      items: {
        orderBy: { createdAt: "asc" },
        select: { id: true, quantity: true, status: true, rewardAmount: true, wasteType: { select: { name: true } } },
      },
    },
  });
  const now = Date.now();
  const sessions = rows.map((row) => ({
    id: row.id,
    status: row.status,
    startedAt: row.startedAt,
    timeoutAt: row.timeoutAt,
    updatedAt: row.updatedAt,
    timedOut: sessionDeadline(row, row.machine.sessionIdleTimeoutMinutes).getTime() <= now,
    machine: { id: row.machine.id, machineCode: row.machine.machineCode, name: row.machine.name },
    items: row.items.map((item) => ({
      id: item.id,
      wasteTypeName: item.wasteType.name,
      quantity: item.quantity,
      status: item.status,
      rewardAmount: item.rewardAmount,
    })),
  }));
  return { session: sessions.length === 1 ? sessions[0] : null, sessions };
}

/**
 * Finish or cancel by the session's owner, under User -> Machine ->
 * DepositSession locks. Refused (409) while the machine still decides an item:
 * releasing the machine then would let the next session start with an item of
 * this one in transit. Once the session's deadline has passed (every lease
 * expired: the machine stopped), the request closes it through the timeout
 * policy instead (EXPIRED, undecided items to REVIEW), so a dead machine never
 * holds the session forever. An ended session is returned unchanged.
 */
export async function endDepositByOwner(
  actor: CurrentUser,
  sessionId: string,
  action: "finish" | "cancel",
): Promise<{ session: DepositSession; changed: boolean }> {
  const ref = await prisma.depositSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, machineId: true },
  });
  if (!ref) throw new HttpError(404, "Sesi tidak ditemukan");
  if (ref.userId !== actor.id) throw new HttpError(403, "Bukan sesi Anda");

  const outcome = await runWalletTransaction(async (tx) => {
    await lockUser(tx, ref.userId);
    await lockMachine(tx, ref.machineId);
    await lockDepositSession(tx, sessionId);
    const session = await tx.depositSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new HttpError(404, "Sesi tidak ditemukan");
    if (!isActiveSession(session.status)) return { kind: "unchanged" as const, session };
    if ((await tx.depositItem.count({ where: undecidedItemsWhere(sessionId) })) > 0) {
      const machine = await tx.machine.findUnique({
        where: { id: ref.machineId },
        select: { sessionIdleTimeoutMinutes: true },
      });
      const now = new Date();
      const expired = machine ? await expireIfTimedOut(tx, sessionId, machine.sessionIdleTimeoutMinutes, now) : null;
      if (!expired) return { kind: "item-in-progress" as const };
      const closed = await tx.depositSession.findUnique({ where: { id: sessionId } });
      return { kind: "expired" as const, session: closed ?? session, expired };
    }
    let next: SessionStatus;
    try {
      next = action === "cancel" ? "CANCELLED" : transitionSession(session.status, "FINISH");
    } catch (error) {
      if (error instanceof InvalidSessionTransitionError) return { kind: "invalid" as const };
      throw error;
    }
    const updated = await tx.depositSession.update({
      where: { id: sessionId },
      data: { status: next, completedAt: new Date() },
    });
    return { kind: "ended" as const, session: updated };
  });

  if (outcome.kind === "item-in-progress") throw new HttpError(409, ITEM_STILL_PROCESSING);
  if (outcome.kind === "invalid") throw new HttpError(409, SESSION_CANNOT_END);
  if (outcome.kind === "unchanged") return { session: outcome.session, changed: false };
  if (outcome.kind === "expired") {
    await auditExpired([outcome.expired], "owner");
    return { session: outcome.session, changed: true };
  }
  await logAudit({
    actorId: actor.id,
    action: action === "cancel" ? "DEPOSIT_SESSION_CANCEL" : "DEPOSIT_SESSION_FINISH",
    entityType: "DepositSession",
    entityId: sessionId,
  });
  return { session: outcome.session, changed: true };
}

/**
 * The machine's current session for its lease poll. Applies the timeout
 * policy to every active session past its deadline (each in its own
 * transaction: owner User -> Machine -> DepositSession -> DepositItem), then
 * returns the one live session, or `conflict` when several are live (legacy
 * duplicates): the machine then gets no lease at all and stops, instead of the
 * server guessing which one is "the" session.
 */
export async function currentMachineSession(machine: {
  id: string;
  sessionIdleTimeoutMinutes: number;
}): Promise<{ sessionId: string | null; conflict: boolean; liveSessionIds: string[] }> {
  const idle = machine.sessionIdleTimeoutMinutes;
  const candidates = await prisma.depositSession.findMany({
    where: { machineId: machine.id, status: { in: [...ACTIVE_SESSION_STATUSES] } },
    select: { id: true, userId: true, timeoutAt: true, startedAt: true },
    orderBy: [{ startedAt: "asc" }, { id: "asc" }],
  });
  const live: string[] = [];
  const expired: ExpiredSession[] = [];
  for (const candidate of candidates) {
    const now = new Date();
    if (sessionDeadline(candidate, idle).getTime() > now.getTime()) {
      live.push(candidate.id);
      continue;
    }
    const closed = await runWalletTransaction(async (tx) => {
      await lockUser(tx, candidate.userId);
      await lockMachine(tx, machine.id);
      return expireIfTimedOut(tx, candidate.id, idle, now);
    });
    if (closed) expired.push(closed);
    else live.push(candidate.id);
  }
  await auditExpired(expired, "machine-poll");
  if (live.length > 1) {
    console.error("[machine-session] several active sessions on one machine; no lease issued. Run scripts/reconcile-active-sessions.ts", {
      machineId: machine.id,
      sessionIds: live,
    });
    return { sessionId: null, conflict: true, liveSessionIds: live };
  }
  return { sessionId: live[0] ?? null, conflict: false, liveSessionIds: live };
}
