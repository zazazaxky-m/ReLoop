import { randomUUID } from "node:crypto";
import type {
  FundingEntry,
  FundingEntryKind,
  Prisma,
  RewardBudgetCommit,
  RewardBudgetReservation,
  RewardFundingAccount,
  RewardReservationSource,
} from "@prisma/client";
import { lockCampaign, lockFundingAccount } from "./db-locks";
import { prisma } from "./prisma";
import { HttpError } from "./rbac";
import { TRASH_BAG_REWARD_PER_BAG } from "./trip";

/**
 * Reward funding and budget reservations (task B01a, finding BIZ-02).
 *
 * Money a program promises must be covered by cash an operator confirmed
 * (RewardFundingAccount.confirmedRupiah) before material is admitted:
 *
 *   1. Admission reserves the maximum obligation a source can create
 *      (`reserveRewardBudget`): a deposit session's configured ceiling
 *      (`session:<id>:admission`) or a trip's issued bags x rate x multiplier
 *      (`trip:<id>:issuance`). `heldRupiah` of the account (and `heldRupiah`
 *      of the campaign) grows by the ceiling; the capacity an admission may
 *      take is `confirmedRupiah - heldRupiah` (and `rewardBudgetRupiah -
 *      heldRupiah - spentRupiah` for a capped campaign).
 *   2. An accepted earning commits against its reservation
 *      (`commitRewardAgainstBudget`, keyed by the earning's business key so a
 *      retried event never consumes budget twice): the admission hold turns
 *      into an obligation hold without touching cash. A review hold commits
 *      the approvable ceiling; the review decision settles it to the target
 *      (`settleCommittedReward`) and releases the difference. Material that
 *      was already accepted never loses its reward: a commit beyond the
 *      reservation is recorded as `uncoveredRupiah` and reported, never
 *      refused.
 *   3. A successful payout attributes its gross to the owner's funded
 *      obligations oldest first (`settlePayoutFunding`): one immutable
 *      FundingEntry PAYOUT per source account, reducing `confirmedRupiah` and
 *      `heldRupiah` by the same amount. A cancelled or failed payout returns
 *      the user's spendable balance and changes nothing here: the obligation
 *      still exists.
 *   4. Residue: a trip's reservation is closed when the trip closes. A
 *      session's residue is retained until the RVM close watermark (B01b) or
 *      an explicit, audited SUPERADMIN release (`releaseResidualReservation`);
 *      never a timeout, which would free money a late event still needs.
 *
 * Enforcement is behind REWARD_FUNDING_ENFORCED (server env only; anything but
 * `true` is not enforced). Shadow mode records every reservation, commit,
 * release and payout entry exactly as enforced mode does and evaluates the
 * capacity checks, but never refuses: a shortfall is stored on the
 * reservation (`shortfallRupiah`, `campaignShortfallRupiah`) and visible in
 * the reconciliation report, so operators see the capacity the program would
 * need and B02 can backfill opening obligations. Enabling enforcement needs
 * B02's backfill and real confirmed funding first (docs/database-ledger-guide.md).
 *
 * Locks (lib/db-locks.ts): every function here takes the account (created on
 * first use) and the campaign row itself, re-entrantly; callers take them in
 * the global order right after the User lock(s) and before any Machine, Trip,
 * DepositSession, DepositItem or Redemption lock, then call in. All counters
 * change only under those locks, through the caller's TransactionClient.
 */

// ---------------------------------------------------------------------------
// Flag
// ---------------------------------------------------------------------------

export const REWARD_FUNDING_ENFORCED_ENV = "REWARD_FUNDING_ENFORCED";

export interface FundingPolicy {
  /** Capacity shortfalls refuse admission (true) or are only recorded (false). */
  enforced: boolean;
}

let warnedMalformedFlag = false;

/**
 * Server-side flag. Only the exact value `true` (trimmed, case-insensitive)
 * enforces; unset, empty and `false` do not. Any other value is malformed and
 * fails closed to "not enforced" with one warning, so a typo never refuses
 * every deposit.
 */
export function isRewardFundingEnforced(env: Record<string, string | undefined> = process.env): boolean {
  const raw = env[REWARD_FUNDING_ENFORCED_ENV];
  if (raw === undefined) return false;
  const value = raw.trim().toLowerCase();
  if (value === "true") return true;
  if (value === "" || value === "false") return false;
  if (!warnedMalformedFlag) {
    warnedMalformedFlag = true;
    console.warn(`[reward-funding] ${REWARD_FUNDING_ENFORCED_ENV}=${JSON.stringify(raw)} is not true/false; funding is NOT enforced`);
  }
  return false;
}

export function fundingPolicy(env: Record<string, string | undefined> = process.env): FundingPolicy {
  return { enforced: isRewardFundingEnforced(env) };
}

// ---------------------------------------------------------------------------
// Messages and keys
// ---------------------------------------------------------------------------

export const FUNDING_INSUFFICIENT = "Program sementara tidak menerima setoran berhadiah";
export const CAMPAIGN_BUDGET_INSUFFICIENT = "Kuota reward program tidak mencukupi";
export const FUNDING_KEY_CONFLICT =
  "Kunci pendanaan ini sudah tercatat dengan nilai berbeda. Hubungi tim keuangan untuk rekonsiliasi.";
export const FUNDING_REFERENCE_CONFLICT =
  "Referensi ini sudah tercatat dengan nominal atau jenis berbeda. Periksa bukti pendanaan sebelum mencatat ulang.";
export const FUNDING_REFERENCE_REQUIRED = "Referensi bukti pendanaan wajib diisi";
export const FUNDING_AMOUNT_INVALID = "Nominal harus bilangan bulat rupiah dalam batas yang diizinkan";
export const RESERVATION_NOT_FOUND = "Reservasi dana reward tidak ditemukan";
export const RESERVATION_SOURCE_STILL_OPEN =
  "Sisa dana hanya dapat dilepas setelah sesi atau trip sumbernya berakhir.";
export const RESERVATION_RELEASE_REASON_REQUIRED = "Alasan pelepasan sisa dana wajib diisi";
export const SESSION_CEILING_NOT_CONFIGURED =
  "Batas reward per sesi wajib diisi sebelum program berhadiah diaktifkan";

export const sessionAdmissionKey = (sessionId: string) => `session:${sessionId}:admission`;
export const tripIssuanceKey = (tripId: string) => `trip:${tripId}:issuance`;
export const fundingTopupKey = (organizationId: string, reference: string) => `topup:${organizationId}:${reference}`;
export const fundingCorrectionKey = (organizationId: string, reference: string) =>
  `correction:${organizationId}:${reference}`;
export const payoutFundingKey = (redemptionId: string, accountId: string) =>
  `redemption:${redemptionId}:payout:${accountId}`;

/** Largest rupiah value a counter can hold (PostgreSQL `integer`). */
export const MAX_FUNDING_RUPIAH = 2_147_483_647;

function assertRupiah(value: number, what: string, options: { min?: number; max?: number } = {}) {
  const min = options.min ?? 0;
  const max = options.max ?? MAX_FUNDING_RUPIAH;
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new HttpError(422, `${FUNDING_AMOUNT_INVALID} (${what})`);
  }
}

// ---------------------------------------------------------------------------
// Ceilings
// ---------------------------------------------------------------------------

/**
 * Reward ceiling of one deposit session: the campaign's configured value,
 * else the machine's. Null when neither is configured (a money program must
 * configure it before enforcement; shadow mode records a zero ceiling).
 */
export function resolveSessionCeiling(input: {
  campaign: { maxRewardPerSessionRupiah: number | null } | null;
  machine: { maxRewardPerSessionRupiah: number | null };
}): number | null {
  return input.campaign?.maxRewardPerSessionRupiah ?? input.machine.maxRewardPerSessionRupiah ?? null;
}

/**
 * Maximum a trip can pay for `bagRows` issued bags: every bag returned in a
 * rewardable condition at full compliance, times the campaign multiplier
 * (lib/trip.ts computeTrashBagRewardAmount with score 100).
 */
export function tripIssuanceCeiling(bagRows: number, rewardMultiplier: number | null | undefined): number {
  if (!Number.isSafeInteger(bagRows) || bagRows <= 0) return 0;
  const multiplier = rewardMultiplier != null && rewardMultiplier > 0 ? rewardMultiplier : 1;
  const ceiling = Math.ceil(bagRows * TRASH_BAG_REWARD_PER_BAG * multiplier);
  if (!Number.isSafeInteger(ceiling) || ceiling > MAX_FUNDING_RUPIAH) {
    throw new HttpError(422, "Nilai reward trip melebihi batas yang diizinkan");
  }
  return ceiling;
}

/**
 * A money program that runs at machines must carry its per-session ceiling
 * before it is ACTIVE (the brief: caps are configured when a program is
 * activated, never a hard-coded nominal). Checked by the campaign API under
 * enforcement only; in shadow mode the missing ceiling is reported instead.
 */
export function assertMoneyProgramConfigured(
  campaign: { status: string; rewardMode: string; campaignType: string; supportsMachine: boolean; maxRewardPerSessionRupiah: number | null },
  policy: FundingPolicy = fundingPolicy(),
): void {
  if (!policy.enforced) return;
  if (campaign.status !== "ACTIVE" || campaign.rewardMode !== "MONEY_REWARD") return;
  const atMachines =
    campaign.campaignType === "MACHINE_DEPOSIT" ||
    ((campaign.campaignType === "EVENT" || campaign.campaignType === "SCHOOL_PROGRAM") && campaign.supportsMachine);
  if (atMachines && campaign.maxRewardPerSessionRupiah === null) {
    throw new HttpError(422, SESSION_CEILING_NOT_CONFIGURED);
  }
}

// ---------------------------------------------------------------------------
// Account
// ---------------------------------------------------------------------------

type CampaignBudgetRow = Pick<
  Prisma.CampaignGetPayload<Record<string, never>>,
  "id" | "organizationId" | "rewardBudgetRupiah" | "heldRupiah" | "spentRupiah"
>;

/**
 * Locks the organization's funding account in the global order, creating it
 * on first use (confirmed 0, held 0). The insert is conflict-free, so two
 * concurrent first users never fail; both then wait on the same row lock.
 * Returns the row as read under the lock.
 */
export async function lockFundingAccountForOrganization(
  tx: Prisma.TransactionClient,
  organizationId: string,
): Promise<RewardFundingAccount> {
  await tx.$executeRaw`
    INSERT INTO "RewardFundingAccount" ("id", "organizationId", "confirmedRupiah", "heldRupiah", "version", "createdAt", "updatedAt")
    VALUES (${randomUUID()}, ${organizationId}, 0, 0, 0, now(), now())
    ON CONFLICT ("organizationId") DO NOTHING`;
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "RewardFundingAccount" WHERE "organizationId" = ${organizationId} FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new HttpError(404, "Organisasi tidak ditemukan");
  return tx.rewardFundingAccount.findUniqueOrThrow({ where: { id: rows[0].id } });
}

async function lockAndReadCampaign(tx: Prisma.TransactionClient, campaignId: string): Promise<CampaignBudgetRow> {
  await lockCampaign(tx, campaignId);
  return tx.campaign.findUniqueOrThrow({
    where: { id: campaignId },
    select: { id: true, organizationId: true, rewardBudgetRupiah: true, heldRupiah: true, spentRupiah: true },
  });
}

async function bumpAccount(
  tx: Prisma.TransactionClient,
  accountId: string,
  delta: { confirmed?: number; held?: number },
): Promise<RewardFundingAccount> {
  const current = await tx.rewardFundingAccount.findUniqueOrThrow({ where: { id: accountId } });
  const confirmed = current.confirmedRupiah + (delta.confirmed ?? 0);
  const held = current.heldRupiah + (delta.held ?? 0);
  if (!Number.isSafeInteger(confirmed) || Math.abs(confirmed) > MAX_FUNDING_RUPIAH) {
    throw new HttpError(422, `${FUNDING_AMOUNT_INVALID} (dana terkonfirmasi)`);
  }
  if (!Number.isSafeInteger(held) || Math.abs(held) > MAX_FUNDING_RUPIAH) {
    throw new HttpError(422, `${FUNDING_AMOUNT_INVALID} (dana tertahan)`);
  }
  return tx.rewardFundingAccount.update({
    where: { id: accountId },
    data: { confirmedRupiah: confirmed, heldRupiah: held, version: { increment: 1 } },
  });
}

async function bumpCampaign(
  tx: Prisma.TransactionClient,
  campaignId: string | null,
  delta: { held?: number; spent?: number },
) {
  if (!campaignId) return;
  if (!delta.held && !delta.spent) return;
  await tx.campaign.update({
    where: { id: campaignId },
    data: {
      ...(delta.held ? { heldRupiah: { increment: delta.held } } : {}),
      ...(delta.spent ? { spentRupiah: { increment: delta.spent } } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

export interface CapacityCheck {
  /** Capacity the account lacks for the requested amount (0 when covered). */
  accountShortfall: number;
  /** Budget the campaign lacks (0 when covered or when the campaign has no cap). */
  campaignShortfall: number;
}

/** The brief's two checks (pure): capacity = confirmed - held; campaign budget = budget - held - spent. */
export function checkCapacity(
  account: Pick<RewardFundingAccount, "confirmedRupiah" | "heldRupiah">,
  campaign: Pick<CampaignBudgetRow, "rewardBudgetRupiah" | "heldRupiah" | "spentRupiah"> | null,
  ceilingRupiah: number,
): CapacityCheck {
  const accountCapacity = account.confirmedRupiah - account.heldRupiah;
  const accountShortfall = accountCapacity < ceilingRupiah ? ceilingRupiah - accountCapacity : 0;
  let campaignShortfall = 0;
  if (campaign && campaign.rewardBudgetRupiah !== null) {
    const budgetCapacity = campaign.rewardBudgetRupiah - campaign.heldRupiah - campaign.spentRupiah;
    if (budgetCapacity < ceilingRupiah) campaignShortfall = ceilingRupiah - budgetCapacity;
  }
  return { accountShortfall, campaignShortfall };
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export interface ReserveRewardBudgetInput {
  businessKey: string;
  organizationId: string;
  campaignId: string | null;
  userId: string;
  ceilingRupiah: number;
  sourceType: RewardReservationSource;
  sourceId: string;
}

/**
 * Reserves `ceilingRupiah` of the organization's capacity (and the campaign's
 * budget) before material is admitted. Idempotent by `businessKey`: the same
 * key with the same or a smaller ceiling returns the existing reservation; a
 * larger ceiling extends it by the difference (a trip issuing more bags).
 * Under enforcement a shortfall is a 409 and nothing is written; in shadow
 * mode the shortfall is recorded on the reservation instead.
 */
export async function reserveRewardBudget(
  tx: Prisma.TransactionClient,
  input: ReserveRewardBudgetInput,
  policy: FundingPolicy = fundingPolicy(),
): Promise<string> {
  assertRupiah(input.ceilingRupiah, "batas reward");
  if (!input.businessKey || input.businessKey.length > 191) throw new RangeError("businessKey is required");

  const account = await lockFundingAccountForOrganization(tx, input.organizationId);
  const campaign = input.campaignId ? await lockAndReadCampaign(tx, input.campaignId) : null;
  if (campaign && campaign.organizationId !== input.organizationId) {
    throw new HttpError(422, "Campaign tidak valid untuk organisasi ini");
  }

  const existing = await tx.rewardBudgetReservation.findUnique({ where: { businessKey: input.businessKey } });
  if (existing && (existing.accountId !== account.id || existing.userId !== input.userId)) {
    throw new HttpError(409, FUNDING_KEY_CONFLICT);
  }
  if (existing && existing.status === "ACTIVE" && existing.ceilingRupiah >= input.ceilingRupiah) {
    return existing.id;
  }
  // A released reservation (a cancelled trip reopened) is re-activated: its
  // residue was given back, so everything above what is still committed must
  // be reserved again.
  let delta: number;
  if (existing?.status === "RELEASED") {
    const committed = await tx.rewardBudgetCommit.aggregate({
      where: { reservationId: existing.id },
      _sum: { heldRupiah: true },
    });
    delta = Math.max(0, input.ceilingRupiah - (committed._sum.heldRupiah ?? 0));
  } else {
    delta = input.ceilingRupiah - (existing?.ceilingRupiah ?? 0);
  }
  const shortfall = checkCapacity(account, campaign, delta);
  if (policy.enforced) {
    // The brief's two checks: refused before anything is written, so the
    // session/bags of a refused admission never exist.
    if (shortfall.accountShortfall > 0) throw new HttpError(409, FUNDING_INSUFFICIENT);
    if (shortfall.campaignShortfall > 0) throw new HttpError(409, CAMPAIGN_BUDGET_INSUFFICIENT);
  } else if (shortfall.accountShortfall > 0 || shortfall.campaignShortfall > 0) {
    console.warn("[reward-funding] shadow mode: reservation beyond capacity", {
      businessKey: input.businessKey,
      organizationId: input.organizationId,
      ...shortfall,
    });
  }

  if (delta > 0) {
    await bumpAccount(tx, account.id, { held: delta });
    await bumpCampaign(tx, campaign?.id ?? null, { held: delta });
  }
  if (existing) {
    const updated = await tx.rewardBudgetReservation.update({
      where: { id: existing.id },
      data: {
        ceilingRupiah: input.ceilingRupiah,
        remainingRupiah: existing.status === "RELEASED" ? delta : { increment: delta },
        shortfallRupiah: { increment: shortfall.accountShortfall },
        campaignShortfallRupiah: { increment: shortfall.campaignShortfall },
        ...(existing.status === "RELEASED"
          ? { status: "ACTIVE", releasedAt: null, releasedById: null, releaseReason: null }
          : {}),
      },
    });
    return updated.id;
  }
  const created = await tx.rewardBudgetReservation.create({
    data: {
      businessKey: input.businessKey,
      accountId: account.id,
      campaignId: campaign?.id ?? null,
      userId: input.userId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      ceilingRupiah: input.ceilingRupiah,
      remainingRupiah: input.ceilingRupiah,
      shortfallRupiah: shortfall.accountShortfall,
      campaignShortfallRupiah: shortfall.campaignShortfall,
    },
  });
  return created.id;
}

/** The reservation a source was admitted under, if the source dates from B01a (null for legacy sources). */
export async function findReservationByKey(
  tx: Prisma.TransactionClient,
  businessKey: string,
): Promise<RewardBudgetReservation | null> {
  return tx.rewardBudgetReservation.findUnique({ where: { businessKey } });
}

export interface CommitResult {
  commitId: string;
  /** Part of the amount drawn from the reservation's remaining ceiling. */
  covered: number;
  /** Part beyond the reservation: held on the account anyway and reported. */
  uncovered: number;
  /** The key was already committed (a retried event); nothing was consumed again. */
  existing: boolean;
}

/**
 * Turns `amount` of the admission hold into an obligation hold for the
 * earning `businessKey` (no cash moves). Keyed: a retry returns the existing
 * commit. An amount beyond the reservation's remaining ceiling (or after its
 * release) is never refused: the material was already accepted, so the excess
 * is held on the account as `uncoveredRupiah` and surfaces in monitoring.
 * `reviewPending` marks a review hold (the approvable ceiling), which a payout
 * never draws from until the review settles it.
 */
export async function commitRewardAgainstBudget(
  tx: Prisma.TransactionClient,
  reservationId: string,
  businessKey: string,
  amount: number,
  options: { reviewPending?: boolean } = {},
): Promise<CommitResult> {
  assertRupiah(amount, "nilai reward");
  const ref = await tx.rewardBudgetReservation.findUnique({
    where: { id: reservationId },
    select: { accountId: true, campaignId: true, userId: true },
  });
  if (!ref) throw new HttpError(404, RESERVATION_NOT_FOUND);
  await lockFundingAccount(tx, ref.accountId);
  if (ref.campaignId) await lockCampaign(tx, ref.campaignId);

  const existing = await tx.rewardBudgetCommit.findUnique({ where: { businessKey } });
  if (existing) {
    if (existing.reservationId !== reservationId) throw new HttpError(409, FUNDING_KEY_CONFLICT);
    return {
      commitId: existing.id,
      covered: existing.heldRupiah - existing.uncoveredRupiah,
      uncovered: existing.uncoveredRupiah,
      existing: true,
    };
  }
  const reservation = await tx.rewardBudgetReservation.findUniqueOrThrow({ where: { id: reservationId } });
  const covered = reservation.status === "ACTIVE" ? Math.min(amount, reservation.remainingRupiah) : 0;
  const uncovered = amount - covered;
  if (covered > 0) {
    await tx.rewardBudgetReservation.update({
      where: { id: reservationId },
      data: { remainingRupiah: { decrement: covered } },
    });
  }
  if (uncovered > 0) {
    await bumpAccount(tx, ref.accountId, { held: uncovered });
    console.warn("[reward-funding] commit beyond its reservation", { businessKey, reservationId, uncovered });
  }
  await bumpCampaign(tx, ref.campaignId, { held: -covered, spent: amount });
  const commit = await tx.rewardBudgetCommit.create({
    data: {
      reservationId,
      accountId: ref.accountId,
      campaignId: ref.campaignId,
      userId: ref.userId,
      businessKey,
      heldRupiah: amount,
      uncoveredRupiah: uncovered,
      reviewPending: options.reviewPending ?? false,
    },
  });
  return { commitId: commit.id, covered, uncovered, existing: false };
}

/**
 * Settles the obligation of an earning after a review decision: the held
 * amount becomes `targetRupiah` (never below what was already paid out). A
 * larger target draws from the reservation (or is uncovered); a smaller one
 * releases the difference back to the organization's capacity and the
 * campaign's budget. Returns null when the earning has no funding commit (a
 * legacy source or a COMPLIANCE_ONLY program).
 */
export async function settleCommittedReward(
  tx: Prisma.TransactionClient,
  businessKey: string,
  input: { targetRupiah: number; reviewPending: boolean },
): Promise<RewardBudgetCommit | null> {
  assertRupiah(input.targetRupiah, "nilai reward");
  const ref = await tx.rewardBudgetCommit.findUnique({
    where: { businessKey },
    select: { id: true, accountId: true, campaignId: true, reservationId: true },
  });
  if (!ref) return null;
  await lockFundingAccount(tx, ref.accountId);
  if (ref.campaignId) await lockCampaign(tx, ref.campaignId);

  const commit = await tx.rewardBudgetCommit.findUniqueOrThrow({ where: { id: ref.id } });
  const newHeld = Math.max(input.targetRupiah, commit.paidRupiah);
  const delta = newHeld - commit.heldRupiah;
  let uncovered = 0;
  if (delta > 0) {
    const reservation = await tx.rewardBudgetReservation.findUniqueOrThrow({ where: { id: ref.reservationId } });
    const covered = reservation.status === "ACTIVE" ? Math.min(delta, reservation.remainingRupiah) : 0;
    uncovered = delta - covered;
    if (covered > 0) {
      await tx.rewardBudgetReservation.update({
        where: { id: reservation.id },
        data: { remainingRupiah: { decrement: covered } },
      });
    }
    if (uncovered > 0) await bumpAccount(tx, ref.accountId, { held: uncovered });
    await bumpCampaign(tx, ref.campaignId, { held: -covered, spent: delta });
  } else if (delta < 0) {
    await bumpAccount(tx, ref.accountId, { held: delta });
    await bumpCampaign(tx, ref.campaignId, { spent: delta });
  }
  return tx.rewardBudgetCommit.update({
    where: { id: ref.id },
    data: {
      heldRupiah: newHeld,
      reviewPending: input.reviewPending,
      ...(uncovered > 0 ? { uncoveredRupiah: { increment: uncovered } } : {}),
    },
  });
}

/**
 * Review settlement entry point: settles the earning's commit when it has
 * one; otherwise (an item held with ceiling 0, e.g. the unknown-type fallback
 * a reviewer reclassified) commits the target against the source reservation
 * when that exists. `targetRupiah: null` keeps the held amount and only
 * clears `reviewPending` (the decision was refused into a reconciliation
 * case, so the money is still out there). Null when the source is legacy.
 */
export async function settleOrCommitReward(
  tx: Prisma.TransactionClient,
  input: { businessKey: string; reservationKey: string; targetRupiah: number | null; reviewPending: boolean },
): Promise<RewardBudgetCommit | null> {
  const existing = await tx.rewardBudgetCommit.findUnique({ where: { businessKey: input.businessKey } });
  if (existing) {
    return settleCommittedReward(tx, input.businessKey, {
      targetRupiah: input.targetRupiah ?? existing.heldRupiah,
      reviewPending: input.reviewPending,
    });
  }
  if (!input.targetRupiah || input.targetRupiah <= 0) return null;
  const reservation = await findReservationByKey(tx, input.reservationKey);
  if (!reservation) return null;
  const { commitId } = await commitRewardAgainstBudget(tx, reservation.id, input.businessKey, input.targetRupiah, {
    reviewPending: input.reviewPending,
  });
  return tx.rewardBudgetCommit.findUniqueOrThrow({ where: { id: commitId } });
}

/**
 * Marks an earning's commit as pending review again (a fraud hold moved its
 * EARN back to PENDING): the obligation is unchanged, but a payout no longer
 * draws from it until a reviewer settles it. Runs under the owner's User lock
 * only; touches no counter.
 */
export async function markCommitReviewPending(tx: Prisma.TransactionClient, businessKey: string): Promise<void> {
  await tx.rewardBudgetCommit.updateMany({ where: { businessKey }, data: { reviewPending: true } });
}

/**
 * Releases up to `amount` of a reservation's remaining ceiling back to the
 * organization's capacity and the campaign's budget. Never negative, never
 * more than what remains; a released reservation is left as it is.
 */
export async function releaseUnusedRewardBudget(
  tx: Prisma.TransactionClient,
  reservationId: string,
  amount: number,
  options: { close?: boolean; releasedById?: string | null; reason?: string | null } = {},
): Promise<{ released: number }> {
  assertRupiah(amount, "nilai pelepasan");
  const ref = await tx.rewardBudgetReservation.findUnique({
    where: { id: reservationId },
    select: { accountId: true, campaignId: true },
  });
  if (!ref) throw new HttpError(404, RESERVATION_NOT_FOUND);
  await lockFundingAccount(tx, ref.accountId);
  if (ref.campaignId) await lockCampaign(tx, ref.campaignId);

  const reservation = await tx.rewardBudgetReservation.findUniqueOrThrow({ where: { id: reservationId } });
  if (reservation.status === "RELEASED") return { released: 0 };
  const released = Math.min(amount, reservation.remainingRupiah);
  if (released > 0) {
    await bumpAccount(tx, ref.accountId, { held: -released });
    await bumpCampaign(tx, ref.campaignId, { held: -released });
  }
  await tx.rewardBudgetReservation.update({
    where: { id: reservationId },
    data: {
      remainingRupiah: { decrement: released },
      ...(options.close
        ? {
            status: "RELEASED",
            releasedAt: new Date(),
            releasedById: options.releasedById ?? null,
            releaseReason: options.reason ?? null,
          }
        : {}),
    },
  });
  return { released };
}

/** Releases everything a reservation still holds and closes it (a trip that closed). */
export async function closeReservation(
  tx: Prisma.TransactionClient,
  reservationId: string,
  options: { releasedById?: string | null; reason?: string | null } = {},
): Promise<{ released: number }> {
  const ref = await tx.rewardBudgetReservation.findUnique({
    where: { id: reservationId },
    select: { accountId: true, campaignId: true },
  });
  if (!ref) throw new HttpError(404, RESERVATION_NOT_FOUND);
  await lockFundingAccount(tx, ref.accountId);
  if (ref.campaignId) await lockCampaign(tx, ref.campaignId);
  const reservation = await tx.rewardBudgetReservation.findUniqueOrThrow({ where: { id: reservationId } });
  return releaseUnusedRewardBudget(tx, reservationId, reservation.remainingRupiah, { ...options, close: true });
}

const TERMINAL_SESSION = new Set(["COMPLETED", "CANCELLED", "EXPIRED"]);
const TERMINAL_TRIP = new Set(["COMPLETED", "CANCELLED"]);

/**
 * Explicit, audited operator release of a session's (or trip's) residual hold
 * (controller ruling: until B01b's close watermark, residue is retained or
 * released only this way). Allowed only once the source ended; idempotent.
 * A later acceptance of that session still pays and is recorded uncovered.
 */
export async function releaseResidualReservation(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; reservationId: string; releasedById: string; reason: string },
): Promise<{ reservation: RewardBudgetReservation; released: number; idempotent: boolean }> {
  const reason = input.reason.trim();
  if (!reason) throw new HttpError(422, RESERVATION_RELEASE_REASON_REQUIRED);
  const ref = await tx.rewardBudgetReservation.findUnique({
    where: { id: input.reservationId },
    select: { accountId: true, campaignId: true, sourceType: true, sourceId: true, account: { select: { organizationId: true } } },
  });
  if (!ref || ref.account.organizationId !== input.organizationId) throw new HttpError(404, RESERVATION_NOT_FOUND);
  await lockFundingAccount(tx, ref.accountId);
  if (ref.campaignId) await lockCampaign(tx, ref.campaignId);

  const current = await tx.rewardBudgetReservation.findUniqueOrThrow({ where: { id: input.reservationId } });
  if (current.status === "RELEASED") return { reservation: current, released: 0, idempotent: true };
  const sourceStatus =
    ref.sourceType === "SESSION"
      ? (await tx.depositSession.findUnique({ where: { id: ref.sourceId }, select: { status: true } }))?.status
      : (await tx.trip.findUnique({ where: { id: ref.sourceId }, select: { status: true } }))?.status;
  const ended = ref.sourceType === "SESSION" ? TERMINAL_SESSION.has(sourceStatus ?? "") : TERMINAL_TRIP.has(sourceStatus ?? "");
  if (!ended) throw new HttpError(409, RESERVATION_SOURCE_STILL_OPEN);

  const { released } = await releaseUnusedRewardBudget(tx, input.reservationId, current.remainingRupiah, {
    close: true,
    releasedById: input.releasedById,
    reason,
  });
  const reservation = await tx.rewardBudgetReservation.findUniqueOrThrow({ where: { id: input.reservationId } });
  return { reservation, released, idempotent: false };
}

// ---------------------------------------------------------------------------
// Cash entries (operator)
// ---------------------------------------------------------------------------

export interface RecordFundingEntryInput {
  organizationId: string;
  kind: Extract<FundingEntryKind, "CONFIRMED_TOPUP" | "CORRECTION">;
  /** Topup: positive. Correction: either sign, never 0. */
  amount: number;
  /** Operator evidence reference (bank/transfer reference); unique per organization and kind. */
  reference: string;
  note?: string | null;
  verifiedById: string;
}

/**
 * Records confirmed cash with evidence. Never moves real money. Idempotent by
 * reference: the same reference with the same amount returns the existing
 * entry; a different amount under the same reference is 409.
 */
export async function recordFundingEntry(
  tx: Prisma.TransactionClient,
  input: RecordFundingEntryInput,
): Promise<{ entry: FundingEntry; account: RewardFundingAccount; idempotent: boolean }> {
  const reference = input.reference?.trim() ?? "";
  if (!reference || reference.length > 120) throw new HttpError(422, FUNDING_REFERENCE_REQUIRED);
  if (input.kind === "CONFIRMED_TOPUP") assertRupiah(input.amount, "nominal topup", { min: 1 });
  else {
    assertRupiah(Math.abs(input.amount), "nominal koreksi", { min: 1 });
  }
  const account = await lockFundingAccountForOrganization(tx, input.organizationId);
  const businessKey =
    input.kind === "CONFIRMED_TOPUP"
      ? fundingTopupKey(input.organizationId, reference)
      : fundingCorrectionKey(input.organizationId, reference);
  const existing = await tx.fundingEntry.findUnique({ where: { businessKey } });
  if (existing) {
    if (existing.amount !== input.amount || existing.kind !== input.kind) {
      throw new HttpError(409, FUNDING_REFERENCE_CONFLICT);
    }
    return { entry: existing, account, idempotent: true };
  }
  const entry = await tx.fundingEntry.create({
    data: {
      accountId: account.id,
      businessKey,
      kind: input.kind,
      amount: input.amount,
      reference,
      note: input.note?.trim() || null,
      verifiedById: input.verifiedById,
    },
  });
  const updated = await bumpAccount(tx, account.id, { confirmed: input.amount });
  return { entry, account: updated, idempotent: false };
}

// ---------------------------------------------------------------------------
// Payout attribution
// ---------------------------------------------------------------------------

/**
 * Funding accounts a payout for `userId` would draw from, in id order, so the
 * transition can lock them after the User and before the Redemption. The set
 * cannot change while the owner's User lock is held (every commit writer
 * holds it).
 */
export async function fundingAccountsForPayout(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ accountId: string }[]>`
    SELECT DISTINCT "accountId" FROM "RewardBudgetCommit"
    WHERE "userId" = ${userId} AND "reviewPending" = false AND "heldRupiah" > "paidRupiah"
    ORDER BY "accountId"`;
  return rows.map((row) => row.accountId);
}

/**
 * Attributes a successful payout's gross to the owner's funded obligations,
 * oldest commit first (B01a interim rule; B02's per-lot allocation replaces
 * the attribution in this one place): one FundingEntry PAYOUT per source
 * account, `confirmedRupiah` and `heldRupiah` both reduced by the attributed
 * amount, `paidRupiah` advanced on each commit. Gross beyond the funded
 * obligations is the owner's legacy (pre-B01a) balance: no source can be
 * named for it without inventing one, so it stays in the reconciliation
 * report's unallocated legacy bucket until B02 backfills opening
 * obligations. The attribution order never changes capacity
 * (`confirmed - held` is reduced by zero either way). Idempotent per
 * redemption. The caller holds User -> every account of
 * `fundingAccountsForPayout` -> Redemption.
 */
export async function settlePayoutFunding(
  tx: Prisma.TransactionClient,
  input: { redemptionId: string; userId: string; grossRupiah: number; actorId: string | null },
): Promise<{ entries: FundingEntry[]; attributedRupiah: number; legacyRupiah: number }> {
  assertRupiah(input.grossRupiah, "nominal pencairan", { min: 1 });
  const recorded = await tx.fundingEntry.findMany({
    where: { kind: "PAYOUT", reference: input.redemptionId },
    orderBy: { businessKey: "asc" },
  });
  if (recorded.length > 0) {
    const attributedRupiah = recorded.reduce((sum, entry) => sum - entry.amount, 0);
    return { entries: recorded, attributedRupiah, legacyRupiah: input.grossRupiah - attributedRupiah };
  }
  const commits = await tx.rewardBudgetCommit.findMany({
    where: { userId: input.userId, reviewPending: false },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  let remaining = input.grossRupiah;
  const perAccount = new Map<string, number>();
  for (const commit of commits) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, commit.heldRupiah - commit.paidRupiah);
    if (take <= 0) continue;
    await tx.rewardBudgetCommit.update({ where: { id: commit.id }, data: { paidRupiah: { increment: take } } });
    perAccount.set(commit.accountId, (perAccount.get(commit.accountId) ?? 0) + take);
    remaining -= take;
  }
  const entries: FundingEntry[] = [];
  for (const [accountId, amount] of [...perAccount.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    // Re-entrant: the transition locked these accounts before the Redemption row.
    await lockFundingAccount(tx, accountId);
    await bumpAccount(tx, accountId, { confirmed: -amount, held: -amount });
    entries.push(
      await tx.fundingEntry.create({
        data: {
          accountId,
          businessKey: payoutFundingKey(input.redemptionId, accountId),
          kind: "PAYOUT",
          amount: -amount,
          reference: input.redemptionId,
          verifiedById: input.actorId,
        },
      }),
    );
  }
  const attributedRupiah = input.grossRupiah - remaining;
  return { entries, attributedRupiah, legacyRupiah: remaining };
}

// ---------------------------------------------------------------------------
// Visibility (reconciliation report, admin route)
// ---------------------------------------------------------------------------

export type StaleHoldReason =
  | "SOURCE_CLOSED_AWAITING_WATERMARK"
  | "SOURCE_OPEN_TOO_LONG"
  | "CEILING_NOT_CONFIGURED"
  | "CAPACITY_SHORTFALL";

/** A session hold older than this while its source is still open is reported (lazy sessions, dead machines). */
export const STALE_HOLD_AFTER_MS = 24 * 60 * 60 * 1000;

export interface StaleHold {
  reservationId: string;
  businessKey: string;
  organizationId: string;
  /** Owner of the obligation (the session's or trip's user). */
  userId: string;
  campaignId: string | null;
  sourceType: RewardReservationSource;
  sourceId: string;
  sourceStatus: string | null;
  ceilingRupiah: number;
  remainingRupiah: number;
  shortfallRupiah: number;
  campaignShortfallRupiah: number;
  ageMinutes: number;
  reasons: StaleHoldReason[];
  /** Operator procedure for this reason (Indonesian, shown as is). */
  reconciliation: string;
}

export interface FundingOrganizationView {
  organizationId: string;
  organizationName: string;
  accountId: string | null;
  confirmedRupiah: number;
  heldRupiah: number;
  /** confirmedRupiah - heldRupiah (negative = obligations exceed confirmed cash). */
  capacityRupiah: number;
  activeReservations: number;
  reservedRemainingRupiah: number;
  /** Obligations committed beyond their reservation (never refused; to reconcile). */
  uncoveredRupiah: number;
  staleHolds: StaleHold[];
}

export interface FundingVisibility {
  enforced: boolean;
  totalConfirmedRupiah: number;
  totalHeldRupiah: number;
  staleHoldCount: number;
  organizations: FundingOrganizationView[];
}

const RECONCILIATION_TEXT: Record<StaleHoldReason, string> = {
  SOURCE_CLOSED_AWAITING_WATERMARK:
    "Sumber sudah berakhir tetapi sisa dana masih ditahan. Pastikan seluruh event mesin sudah tersinkron, lalu superadmin melepas sisa dana secara eksplisit (alasan wajib) atau tunggu konfirmasi penutupan dari mesin.",
  SOURCE_OPEN_TOO_LONG:
    "Sumber masih terbuka lebih dari 24 jam. Periksa status mesin/trip; sisa dana tidak pernah dilepas otomatis.",
  CEILING_NOT_CONFIGURED:
    "Sesi diterima tanpa batas reward per sesi yang dikonfigurasi (mode bayangan). Isi batas pada program atau mesin sebelum penegakan dana diaktifkan.",
  CAPACITY_SHORTFALL:
    "Reservasi dicatat melebihi dana terkonfirmasi (mode bayangan). Tambah dana terkonfirmasi dengan bukti, atau turunkan batas program.",
};

interface ReservationRow {
  id: string;
  businessKey: string;
  organizationId: string;
  userId: string;
  campaignId: string | null;
  sourceType: RewardReservationSource;
  sourceId: string;
  sourceStatus: string | null;
  ceilingRupiah: number;
  remainingRupiah: number;
  shortfallRupiah: number;
  campaignShortfallRupiah: number;
  createdAt: Date;
}

/** Pure classification of one active reservation. */
export function classifyHold(row: ReservationRow, now: Date): StaleHold | null {
  const reasons: StaleHoldReason[] = [];
  const ended =
    row.sourceType === "SESSION" ? TERMINAL_SESSION.has(row.sourceStatus ?? "") : TERMINAL_TRIP.has(row.sourceStatus ?? "");
  const ageMs = now.getTime() - row.createdAt.getTime();
  if (row.remainingRupiah > 0 && ended) reasons.push("SOURCE_CLOSED_AWAITING_WATERMARK");
  if (row.remainingRupiah > 0 && !ended && ageMs > STALE_HOLD_AFTER_MS) reasons.push("SOURCE_OPEN_TOO_LONG");
  if (row.sourceType === "SESSION" && row.ceilingRupiah === 0) reasons.push("CEILING_NOT_CONFIGURED");
  if (row.shortfallRupiah > 0 || row.campaignShortfallRupiah > 0) reasons.push("CAPACITY_SHORTFALL");
  if (reasons.length === 0) return null;
  return {
    reservationId: row.id,
    businessKey: row.businessKey,
    organizationId: row.organizationId,
    userId: row.userId,
    campaignId: row.campaignId,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    sourceStatus: row.sourceStatus,
    ceilingRupiah: row.ceilingRupiah,
    remainingRupiah: row.remainingRupiah,
    shortfallRupiah: row.shortfallRupiah,
    campaignShortfallRupiah: row.campaignShortfallRupiah,
    ageMinutes: Math.max(0, Math.floor(ageMs / 60_000)),
    reasons,
    reconciliation: reasons.map((reason) => RECONCILIATION_TEXT[reason]).join(" "),
  };
}

const toNumber = (value: bigint | number | null | undefined) => Number(value ?? 0);

/**
 * Read model for the reconciliation report (through its snapshot `tx`) and
 * the admin route: confirmed/held per organization, capacity, open
 * reservations and the holds that need an operator (owner and reason).
 */
export async function readFundingVisibility(
  db: Prisma.TransactionClient,
  options: { organizationId?: string; now?: Date } = {},
): Promise<FundingVisibility> {
  const now = options.now ?? new Date();
  const organizations = await db.organization.findMany({
    where: options.organizationId ? { id: options.organizationId } : undefined,
    select: { id: true, name: true, rewardFunding: true },
    orderBy: { name: "asc" },
  });
  const reservations = await db.$queryRaw<
    (Omit<ReservationRow, "sourceType"> & { sourceType: string; shortfallRupiah: number; campaignShortfallRupiah: number })[]
  >`
    SELECT r.id, r."businessKey", a."organizationId", r."userId", r."campaignId",
           r."sourceType"::text AS "sourceType", r."sourceId",
           COALESCE(s.status::text, t.status::text) AS "sourceStatus",
           r."ceilingRupiah", r."remainingRupiah", r."shortfallRupiah", r."campaignShortfallRupiah", r."createdAt"
    FROM "RewardBudgetReservation" r
    JOIN "RewardFundingAccount" a ON a.id = r."accountId"
    LEFT JOIN "DepositSession" s ON r."sourceType" = 'SESSION' AND s.id = r."sourceId"
    LEFT JOIN "Trip" t ON r."sourceType" = 'TRIP' AND t.id = r."sourceId"
    WHERE r.status = 'ACTIVE'
      AND (${options.organizationId ?? null}::text IS NULL OR a."organizationId" = ${options.organizationId ?? null})
    ORDER BY r."createdAt", r.id`;
  const uncovered = await db.$queryRaw<{ organizationId: string; uncovered: bigint }[]>`
    SELECT a."organizationId", SUM(c."uncoveredRupiah")::bigint AS uncovered
    FROM "RewardBudgetCommit" c JOIN "RewardFundingAccount" a ON a.id = c."accountId"
    WHERE c."uncoveredRupiah" > 0
    GROUP BY a."organizationId"`;
  const uncoveredByOrg = new Map(uncovered.map((row) => [row.organizationId, toNumber(row.uncovered)]));

  const views: FundingOrganizationView[] = organizations.map((org) => {
    const rows = reservations.filter((row) => row.organizationId === org.id);
    const account = org.rewardFunding;
    const confirmed = account?.confirmedRupiah ?? 0;
    const held = account?.heldRupiah ?? 0;
    return {
      organizationId: org.id,
      organizationName: org.name,
      accountId: account?.id ?? null,
      confirmedRupiah: confirmed,
      heldRupiah: held,
      capacityRupiah: confirmed - held,
      activeReservations: rows.length,
      reservedRemainingRupiah: rows.reduce((sum, row) => sum + row.remainingRupiah, 0),
      uncoveredRupiah: uncoveredByOrg.get(org.id) ?? 0,
      staleHolds: rows
        .map((row) => classifyHold({ ...row, sourceType: row.sourceType as RewardReservationSource }, now))
        .filter((hold): hold is StaleHold => hold !== null),
    };
  });
  return {
    enforced: isRewardFundingEnforced(),
    totalConfirmedRupiah: views.reduce((sum, view) => sum + view.confirmedRupiah, 0),
    totalHeldRupiah: views.reduce((sum, view) => sum + view.heldRupiah, 0),
    staleHoldCount: views.reduce((sum, view) => sum + view.staleHolds.length, 0),
    organizations: views,
  };
}

export interface OrganizationFundingDetail extends FundingOrganizationView {
  enforced: boolean;
  entries: FundingEntry[];
  campaigns: {
    id: string;
    name: string;
    status: string;
    rewardMode: string;
    rewardBudgetRupiah: number | null;
    heldRupiah: number;
    spentRupiah: number;
    maxRewardPerSessionRupiah: number | null;
  }[];
  commits: { active: number; heldRupiah: number; paidRupiah: number; uncoveredRupiah: number; reviewPending: number };
}

/** One organization's funding view for GET /api/organizations/[id]/funding (plain reads, no locks). */
export async function getOrganizationFunding(organizationId: string): Promise<OrganizationFundingDetail | null> {
  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
  if (!organization) return null;
  const [visibility, campaigns, entries, commitTotals, pendingCount] = await Promise.all([
    readFundingVisibility(prisma, { organizationId }),
    prisma.campaign.findMany({
      where: { organizationId },
      orderBy: [{ status: "asc" }, { name: "asc" }],
      select: {
        id: true, name: true, status: true, rewardMode: true, rewardBudgetRupiah: true,
        heldRupiah: true, spentRupiah: true, maxRewardPerSessionRupiah: true,
      },
    }),
    prisma.fundingEntry.findMany({
      where: { account: { organizationId } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
    prisma.rewardBudgetCommit.aggregate({
      where: { account: { organizationId } },
      _count: { _all: true },
      _sum: { heldRupiah: true, paidRupiah: true, uncoveredRupiah: true },
    }),
    prisma.rewardBudgetCommit.count({ where: { account: { organizationId }, reviewPending: true } }),
  ]);
  const view = visibility.organizations[0];
  if (!view) return null;
  return {
    ...view,
    enforced: visibility.enforced,
    entries,
    campaigns,
    commits: {
      active: commitTotals._count._all,
      heldRupiah: commitTotals._sum.heldRupiah ?? 0,
      paidRupiah: commitTotals._sum.paidRupiah ?? 0,
      uncoveredRupiah: commitTotals._sum.uncoveredRupiah ?? 0,
      reviewPending: pendingCount,
    },
  };
}
