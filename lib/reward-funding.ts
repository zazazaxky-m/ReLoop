import { randomUUID } from "node:crypto";
import {
  Prisma,
  type FundingEntry,
  type FundingEntryKind,
  type RewardBudgetCommit,
  type RewardBudgetReservation,
  type RewardFundingAccount,
  type RewardReservationSource,
} from "@prisma/client";
import { lockCampaign, lockFundingAccount } from "./db-locks";
import { prisma } from "./prisma";
import { HttpError } from "./rbac";
import { resolveMigrationCutover, type LegacyCutover } from "./reward-legacy-cutover";
import { machineRewardMode, tripRewardMode } from "./reward-policy";
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
 *      session's residue is retained until the RVM close watermark (B01b,
 *      lib/machine-events/watermark.ts: the machine confirmed that every event
 *      of the session is synced; the release is keyed
 *      `session:<id>:close-watermark`) or an explicit, audited SUPERADMIN
 *      release (`releaseResidualReservation`); never a timeout, which would
 *      free money a late event still needs. A lost connection keeps the hold.
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

/**
 * B01a cutover (fix round 1, I2): the instant from which every session/trip
 * is admitted with a reservation. A source created before it that has none
 * is a legacy obligation (B02 backfills it); a later source without one (its
 * program turned to money after admission) gets a zero-ceiling reservation at
 * its first earning and is held uncovered. Resolution is deterministic and
 * fails closed (an unresolvable cutover treats every source as post-cutover,
 * i.e. holds it): the earlier of `REWARD_FUNDING_CUTOVER_AT` (unparsable =
 * none) and the applied time of the funding migration (C3: a setting later
 * than the migration never widens the legacy window).
 */
export const REWARD_FUNDING_MIGRATION = "20261014150000_reward_funding";
export const FUNDING_CUTOVER_ENV = "REWARD_FUNDING_CUTOVER_AT";

export async function resolveFundingCutover(
  db: Pick<Prisma.TransactionClient, "$queryRaw">,
  env: Record<string, string | undefined> = process.env,
): Promise<LegacyCutover> {
  return resolveMigrationCutover(db, {
    migration: REWARD_FUNDING_MIGRATION, envName: FUNDING_CUTOVER_ENV, env, combine: "earliest",
  });
}

// ---------------------------------------------------------------------------
// Messages and keys
// ---------------------------------------------------------------------------

export const FUNDING_INSUFFICIENT = "Program sementara tidak menerima setoran berhadiah";
export const CAMPAIGN_BUDGET_INSUFFICIENT = "Kuota reward program tidak mencukupi";
export const FUNDING_KEY_CONFLICT =
  "Kunci pendanaan ini sudah tercatat dengan nilai berbeda. Hubungi tim keuangan untuk rekonsiliasi.";
export const FUNDING_REFERENCE_CONFLICT =
  "Referensi ini sudah tercatat untuk organisasi lain atau dengan nominal/jenis berbeda. Periksa bukti pendanaan sebelum mencatat ulang.";
export const FUNDING_REFERENCE_REQUIRED = "Referensi bukti pendanaan wajib diisi (minimal 6 karakter)";
export const FUNDING_NOTE_REQUIRED =
  "Catatan bukti pendanaan wajib diisi (minimal 10 karakter: sumber dana, tanggal, dan rekening)";
export const FUNDING_AMOUNT_INVALID = "Nominal harus bilangan bulat rupiah dalam batas yang diizinkan";
export const RESERVATION_NOT_FOUND = "Reservasi dana reward tidak ditemukan";
export const RESERVATION_SOURCE_STILL_OPEN =
  "Sisa dana hanya dapat dilepas setelah sesi atau trip sumbernya berakhir.";
export const RESERVATION_RELEASE_REASON_REQUIRED = "Alasan pelepasan sisa dana wajib diisi";
export const SESSION_CEILING_NOT_CONFIGURED =
  "Batas reward per sesi wajib diisi sebelum program berhadiah diaktifkan";
export const CAMPAIGN_BUDGET_REQUIRED_FOR_ACTIVATION =
  "Kuota reward program wajib diisi sebelum program berhadiah diaktifkan";
export const CAMPAIGN_BUDGET_NOT_CONFIGURED =
  "Kuota reward program belum diatur. Program berhadiah wajib memiliki kuota sebelum menerima setoran.";
export const PROGRAM_HAS_OPEN_SOURCES =
  "Program masih memiliki sesi setoran atau trip yang berjalan. Tunggu sampai berakhir sebelum mengubah mode reward atau multiplier.";
export const ORGANIZATION_HAS_OPEN_SESSIONS =
  "Organisasi masih memiliki sesi setoran berjalan tanpa program. Tunggu sampai berakhir sebelum mengubah mode reward mesin.";

export const sessionAdmissionKey = (sessionId: string) => `session:${sessionId}:admission`;
export const tripIssuanceKey = (tripId: string) => `trip:${tripId}:issuance`;
/** B01b: the keyed release of a session's residue after the RVM close watermark (one per session, ever). */
export const sessionCloseWatermarkKey = (sessionId: string) => `session:${sessionId}:close-watermark`;
export const CLOSE_WATERMARK_RELEASE_REASON = "CLOSE_WATERMARK";
/** Evidence references compare trimmed and case-insensitively (C4). */
export const normalizeFundingReference = (reference: string) => reference.trim().toUpperCase();
/**
 * One key space for every cash-confirming entry (a topup or a positive
 * correction), across organizations: one bank transfer confirms cash once
 * (C4). A negative correction references the transfer it reverses in its
 * own space. Keys of the earlier formats (`topup:<org>:<ref>`,
 * `topup:<ref>`) exist only on this unreleased branch: no backfill.
 */
export const fundingCashKey = (reference: string) => `cash:${normalizeFundingReference(reference)}`;
export const fundingCorrectionKey = (reference: string) => `correction:${normalizeFundingReference(reference)}`;

/** The unique-index race on a cash reference (two organizations, same reference, concurrently): a 409, never a 500. */
export function isFundingReferenceConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const meta = (error.meta ?? {}) as { target?: unknown; modelName?: unknown };
  const target = Array.isArray(meta.target) ? meta.target.join(",") : String(meta.target ?? "");
  return meta.modelName === "FundingEntry" || /FundingEntry|businessKey/.test(target);
}
export const payoutFundingKey = (redemptionId: string, accountId: string) =>
  `redemption:${redemptionId}:payout:${accountId}`;
export const FUNDING_REFERENCE_MIN = 6;
export const FUNDING_NOTE_MIN = 10;

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

/** A configured money cap is a positive integer; null, 0 or less is "not configured". */
export function configuredCap(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Reward ceiling of one deposit session: the campaign's configured value,
 * else the machine's. Null when neither is configured (a zero is not a
 * ceiling: a money program must configure one before enforcement; shadow
 * mode records a zero ceiling and reports it).
 */
export function resolveSessionCeiling(input: {
  campaign: { maxRewardPerSessionRupiah: number | null } | null;
  machine: { maxRewardPerSessionRupiah: number | null };
}): number | null {
  return configuredCap(input.campaign?.maxRewardPerSessionRupiah) ?? configuredCap(input.machine.maxRewardPerSessionRupiah);
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
 * An ACTIVE money program must carry its caps (the brief: caps are
 * configured when a program is activated, never a hard-coded nominal; a
 * null budget is never "unlimited", C1): a budget of at least Rp1 for every
 * money program, and a per-session ceiling of at least Rp1 for one that runs
 * at machines (I3: zero is not configured). Checked by the campaign API under
 * enforcement only; in shadow mode the missing caps are reported instead.
 */
export function assertMoneyProgramConfigured(
  campaign: {
    status: string; rewardMode: string; campaignType: string; supportsMachine: boolean;
    maxRewardPerSessionRupiah: number | null; rewardBudgetRupiah: number | null;
  },
  policy: FundingPolicy = fundingPolicy(),
): void {
  if (!policy.enforced) return;
  if (campaign.status !== "ACTIVE" || campaign.rewardMode !== "MONEY_REWARD") return;
  if (configuredCap(campaign.rewardBudgetRupiah) === null) throw new HttpError(422, CAMPAIGN_BUDGET_REQUIRED_FOR_ACTIVATION);
  const atMachines =
    campaign.campaignType === "MACHINE_DEPOSIT" ||
    ((campaign.campaignType === "EVENT" || campaign.campaignType === "SCHOOL_PROGRAM") && campaign.supportsMachine);
  if (atMachines && configuredCap(campaign.maxRewardPerSessionRupiah) === null) {
    throw new HttpError(422, SESSION_CEILING_NOT_CONFIGURED);
  }
}

/** Effective trip/machine multiplier (lib/trip.ts computeTrashBagRewardAmount: null or <= 0 means 1). */
export function effectiveMultiplier(value: number | null | undefined): number {
  return value != null && value > 0 ? value : 1;
}

const OPEN_SESSION_STATUSES = ["RESERVED", "ACTIVE", "PROCESSING_ITEM", "REVIEW"] as const;
const TERMINAL_SESSION_STATUSES = ["COMPLETED", "CANCELLED", "EXPIRED"] as const;
const UNDECIDED_ITEM_STATUSES = ["PENDING", "REVIEW"] as const;

/**
 * B01b (open until watermarked): a session can still create reward
 * obligations after it ended, until the RVM's close watermark confirmed that
 * every machine event of the session is synced (a lost connection, a late
 * acceptance in the outbox). For the program guards a session is therefore
 * open while its status is open, or while it ended without a watermark and
 * still holds undecided items (a reviewer could approve them) or an ACTIVE
 * reservation (`hasOpenProgramSources` adds that part by SQL). Ended sessions
 * with every item decided and no live reservation are closed even without a
 * watermark (legacy rows, dead machines), and an explicit operator release
 * (`releaseResidualReservation`) closes the reservation part.
 */
export function openSessionWhere(scope: { campaignId?: string | null; organizationId?: string }): Prisma.DepositSessionWhereInput {
  return {
    ...(scope.campaignId !== undefined ? { campaignId: scope.campaignId } : {}),
    ...(scope.organizationId ? { machine: { organizationId: scope.organizationId } } : {}),
    OR: [
      { status: { in: [...OPEN_SESSION_STATUSES] } },
      {
        status: { in: [...TERMINAL_SESSION_STATUSES] },
        closeWatermarkAt: null,
        items: { some: { status: { in: [...UNDECIDED_ITEM_STATUSES] } } },
      },
    ],
  };
}

/** Ended, not watermarked sessions of the scope whose admission reservation is still ACTIVE. */
async function countHeldEndedSessions(
  tx: Prisma.TransactionClient,
  scope: { campaignId: string } | { organizationId: string },
): Promise<number> {
  const rows =
    "campaignId" in scope
      ? await tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "RewardBudgetReservation" r
          JOIN "DepositSession" s ON s.id = r."sourceId"
          WHERE r."sourceType" = 'SESSION' AND r.status = 'ACTIVE'
            AND s."closeWatermarkAt" IS NULL
            AND s.status IN ('COMPLETED', 'CANCELLED', 'EXPIRED')
            AND s."campaignId" = ${scope.campaignId}`
      : await tx.$queryRaw<{ count: bigint }[]>`
          SELECT COUNT(*)::bigint AS count
          FROM "RewardBudgetReservation" r
          JOIN "DepositSession" s ON s.id = r."sourceId"
          JOIN "Machine" m ON m.id = s."machineId"
          WHERE r."sourceType" = 'SESSION' AND r.status = 'ACTIVE'
            AND s."closeWatermarkAt" IS NULL
            AND s.status IN ('COMPLETED', 'CANCELLED', 'EXPIRED')
            AND s."campaignId" IS NULL AND m."organizationId" = ${scope.organizationId}`;
  return Number(rows[0]?.count ?? 0);
}

/**
 * Sources the program admitted that can still earn: open sessions (B01b: open
 * until the close watermark, `openSessionWhere`), and PLANNED/ACTIVE trips
 * with issued bags.
 */
export async function hasOpenProgramSources(tx: Prisma.TransactionClient, campaignId: string): Promise<boolean> {
  const sessions = await tx.depositSession.count({ where: openSessionWhere({ campaignId }) });
  if (sessions > 0) return true;
  if ((await countHeldEndedSessions(tx, { campaignId })) > 0) return true;
  const trips = await tx.trip.count({
    where: { campaignId, status: { in: ["PLANNED", "ACTIVE"] }, bagAssignments: { some: {} } },
  });
  return trips > 0;
}

export interface ProgramRewardShape {
  rewardMode: string;
  rewardMultiplier: number | null;
  campaignType: string;
  supportsMachine: boolean;
}

/**
 * The modes a program EFFECTIVELY pays in (lib/reward-policy.ts): trips
 * follow `tripRewardMode` (only trip program types pay), machines
 * `machineRewardMode` (only machine program types, or EVENT/SCHOOL_PROGRAM
 * with `supportsMachine`). Both depend on `campaignType` and
 * `supportsMachine`, not only on `rewardMode`.
 */
export function effectiveProgramModes(program: ProgramRewardShape): { trips: boolean; machines: boolean } {
  return {
    trips: tripRewardMode(program) === "MONEY_REWARD",
    // The organization mode only applies to sessions without a campaign.
    machines: machineRewardMode({ campaign: program, organizationMode: "COMPLIANCE_ONLY" }) === "MONEY_REWARD",
  };
}

/**
 * I2: under enforcement a program with open sources cannot start paying
 * money or raise its multiplier: its sources were admitted (and reserved)
 * under the old terms, so the change would create obligations nothing
 * reserved for. "Starts paying" is judged on the EFFECTIVE modes (I2-a), so a
 * change of `campaignType` or `supportsMachine` that turns trips or machines
 * to money counts, and a program parked as an EVENT while its bags were
 * issued cannot be turned back into a money trip program. The caller holds
 * the Campaign lock (admission and issuance take it too, so no source can
 * slip in between the count and the update). Shadow mode allows the change;
 * a later earning is then held late and reported.
 */
export async function guardProgramRewardChange(
  tx: Prisma.TransactionClient,
  input: { campaignId: string; current: ProgramRewardShape; next: ProgramRewardShape },
  policy: FundingPolicy = fundingPolicy(),
): Promise<void> {
  if (!policy.enforced) return;
  const current = effectiveProgramModes(input.current);
  const next = effectiveProgramModes(input.next);
  const turnsToMoney = (!current.trips && next.trips) || (!current.machines && next.machines);
  const raisesMultiplier =
    (next.trips || next.machines) &&
    effectiveMultiplier(input.next.rewardMultiplier) > effectiveMultiplier(input.current.rewardMultiplier);
  if (!turnsToMoney && !raisesMultiplier) return;
  if (await hasOpenProgramSources(tx, input.campaignId)) throw new HttpError(409, PROGRAM_HAS_OPEN_SOURCES);
}

/**
 * I2: the same guard for the organization's machine mode (sessions without a
 * campaign). The caller holds the organization's funding account lock, which
 * every admission takes before the Machine row.
 */
export async function guardOrganizationModeChange(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; current: { machineRewardMode: string }; next: { machineRewardMode: string } },
  policy: FundingPolicy = fundingPolicy(),
): Promise<void> {
  if (!policy.enforced) return;
  if (input.current.machineRewardMode === "MONEY_REWARD" || input.next.machineRewardMode !== "MONEY_REWARD") return;
  const open = await tx.depositSession.count({ where: openSessionWhere({ campaignId: null, organizationId: input.organizationId }) });
  if (open > 0) throw new HttpError(409, ORGANIZATION_HAS_OPEN_SESSIONS);
  if ((await countHeldEndedSessions(tx, { organizationId: input.organizationId })) > 0) {
    throw new HttpError(409, ORGANIZATION_HAS_OPEN_SESSIONS);
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
    // Refused before anything is written, so the session/bags of a refused
    // admission never exist. A zero reservation is not an admission (I3), a
    // program without a budget admits nothing (C1), then the brief's two checks.
    if (input.ceilingRupiah <= 0) throw new HttpError(409, FUNDING_INSUFFICIENT);
    if (campaign && configuredCap(campaign.rewardBudgetRupiah) === null) throw new HttpError(409, CAMPAIGN_BUDGET_NOT_CONFIGURED);
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

export type SourceReservation =
  | { kind: "RESERVATION"; reservation: RewardBudgetReservation; late: boolean }
  /** The source predates the funding cutover: a legacy obligation B02 backfills. */
  | { kind: "LEGACY_SOURCE"; cutover: LegacyCutover }
  | { kind: "NO_SOURCE" };

/**
 * I2: the reservation an earning commits against. Admitted sources have one
 * (`session:<id>:admission`, `trip:<id>:issuance`). A source without one is
 * legacy only when it was created before the funding cutover; otherwise (its
 * program turned to money after admission, or the cutover is unresolvable,
 * which fails closed) a zero-ceiling reservation is created here, marked
 * `lateReservation`, so the earning is committed uncovered, held on the
 * account and reported, instead of disappearing from capacity.
 */
export async function resolveSourceReservation(
  tx: Prisma.TransactionClient,
  source: { sourceType: RewardReservationSource; sourceId: string },
  env: Record<string, string | undefined> = process.env,
): Promise<SourceReservation> {
  const businessKey = source.sourceType === "SESSION" ? sessionAdmissionKey(source.sourceId) : tripIssuanceKey(source.sourceId);
  const existing = await findReservationByKey(tx, businessKey);
  if (existing) return { kind: "RESERVATION", reservation: existing, late: existing.lateReservation };

  let admitted: { createdAt: Date; userId: string; campaignId: string | null; organizationId: string } | null = null;
  if (source.sourceType === "SESSION") {
    const session = await tx.depositSession.findUnique({
      where: { id: source.sourceId },
      select: { startedAt: true, userId: true, campaignId: true, machine: { select: { organizationId: true } } },
    });
    if (session) {
      admitted = { createdAt: session.startedAt, userId: session.userId, campaignId: session.campaignId, organizationId: session.machine.organizationId };
    }
  } else {
    const trip = await tx.trip.findUnique({
      where: { id: source.sourceId },
      select: { createdAt: true, userId: true, campaignId: true, campaign: { select: { organizationId: true } } },
    });
    if (trip && trip.userId) {
      admitted = { createdAt: trip.createdAt, userId: trip.userId, campaignId: trip.campaignId, organizationId: trip.campaign.organizationId };
    }
  }
  if (!admitted) return { kind: "NO_SOURCE" };

  const cutover = await resolveFundingCutover(tx, env);
  if (cutover.at !== null && admitted.createdAt.getTime() < cutover.at.getTime()) {
    return { kind: "LEGACY_SOURCE", cutover };
  }
  if (cutover.at === null) console.warn(`[reward-funding] funding cutover unavailable (${cutover.source}); holding the source`);
  await lockFundingAccountForOrganization(tx, admitted.organizationId);
  const account = await tx.rewardFundingAccount.findUniqueOrThrow({ where: { organizationId: admitted.organizationId } });
  if (admitted.campaignId) await lockCampaign(tx, admitted.campaignId);
  const reservation = await tx.rewardBudgetReservation.create({
    data: {
      businessKey,
      accountId: account.id,
      campaignId: admitted.campaignId,
      userId: admitted.userId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      ceilingRupiah: 0,
      remainingRupiah: 0,
      lateReservation: true,
    },
  });
  console.warn("[reward-funding] source admitted without a reservation; holding its earning uncovered", {
    businessKey,
    organizationId: admitted.organizationId,
  });
  return { kind: "RESERVATION", reservation, late: true };
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
 * a reviewer reclassified, or a source admitted without money whose program
 * pays now) commits the target against the source's reservation resolved
 * exactly like an acceptance (`resolveSourceReservation`, I2-b): the
 * admission reservation, or a late zero-ceiling one (held uncovered and
 * reported); nothing for a legacy source. `targetRupiah: null` keeps the
 * held amount and only clears `reviewPending` (the decision was refused into
 * a reconciliation case, so the money is still out there).
 */
export async function settleOrCommitReward(
  tx: Prisma.TransactionClient,
  input: {
    businessKey: string;
    source: { sourceType: RewardReservationSource; sourceId: string };
    targetRupiah: number | null;
    reviewPending: boolean;
  },
): Promise<RewardBudgetCommit | null> {
  const existing = await tx.rewardBudgetCommit.findUnique({ where: { businessKey: input.businessKey } });
  if (existing) {
    return settleCommittedReward(tx, input.businessKey, {
      targetRupiah: input.targetRupiah ?? existing.heldRupiah,
      reviewPending: input.reviewPending,
    });
  }
  if (!input.targetRupiah || input.targetRupiah <= 0) return null;
  const resolved = await resolveSourceReservation(tx, input.source);
  if (resolved.kind !== "RESERVATION") return null;
  const { commitId } = await commitRewardAgainstBudget(tx, resolved.reservation.id, input.businessKey, input.targetRupiah, {
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
 * more than what remains; a released reservation is left as it is. With a
 * `businessKey` (B01b) the release is a keyed financial effect
 * (RewardBudgetRelease): a retry under the same key returns the recorded
 * release and gives nothing back a second time, closed or not.
 */
export async function releaseUnusedRewardBudget(
  tx: Prisma.TransactionClient,
  reservationId: string,
  amount: number,
  options: { close?: boolean; releasedById?: string | null; reason?: string | null; businessKey?: string } = {},
): Promise<{ released: number; existing: boolean }> {
  assertRupiah(amount, "nilai pelepasan");
  if (options.businessKey !== undefined && (!options.businessKey || options.businessKey.length > 191)) {
    throw new RangeError("businessKey is required");
  }
  const ref = await tx.rewardBudgetReservation.findUnique({
    where: { id: reservationId },
    select: { accountId: true, campaignId: true },
  });
  if (!ref) throw new HttpError(404, RESERVATION_NOT_FOUND);
  await lockFundingAccount(tx, ref.accountId);
  if (ref.campaignId) await lockCampaign(tx, ref.campaignId);

  if (options.businessKey) {
    const recorded = await tx.rewardBudgetRelease.findUnique({ where: { businessKey: options.businessKey } });
    if (recorded) {
      if (recorded.reservationId !== reservationId) throw new HttpError(409, FUNDING_KEY_CONFLICT);
      return { released: recorded.amount, existing: true };
    }
  }
  const reservation = await tx.rewardBudgetReservation.findUniqueOrThrow({ where: { id: reservationId } });
  const released = reservation.status === "RELEASED" ? 0 : Math.min(amount, reservation.remainingRupiah);
  if (reservation.status !== "RELEASED") {
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
  }
  if (options.businessKey) {
    await tx.rewardBudgetRelease.create({
      data: {
        reservationId,
        accountId: ref.accountId,
        campaignId: ref.campaignId,
        businessKey: options.businessKey,
        amount: released,
        reason: options.reason ?? null,
        releasedById: options.releasedById ?? null,
      },
    });
  }
  return { released, existing: false };
}

/** Releases everything a reservation still holds and closes it (a trip that closed). */
export async function closeReservation(
  tx: Prisma.TransactionClient,
  reservationId: string,
  options: { releasedById?: string | null; reason?: string | null } = {},
): Promise<{ released: number; existing: boolean }> {
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
  /** Operator evidence reference (bank/transfer reference), at least 6 characters; unique per kind across organizations. */
  reference: string;
  /** Evidence note (source of funds, date, account), at least 10 characters; stored with the entry. */
  note: string;
  verifiedById: string;
}

/**
 * Records confirmed cash with evidence. Never moves real money. Idempotent by
 * reference: the same reference (trimmed, case-insensitive) for the same
 * organization, amount and kind returns the existing entry; the same
 * reference for another organization, amount or kind is 409 (one bank
 * transfer confirms cash once). Two organizations recording the same
 * reference concurrently race on the unique index: the loser's transaction
 * fails with P2002, which callers map to the same 409
 * (`isFundingReferenceConflict`).
 */
export async function recordFundingEntry(
  tx: Prisma.TransactionClient,
  input: RecordFundingEntryInput,
): Promise<{ entry: FundingEntry; account: RewardFundingAccount; idempotent: boolean }> {
  const reference = input.reference?.trim() ?? "";
  if (reference.length < FUNDING_REFERENCE_MIN || reference.length > 120) throw new HttpError(422, FUNDING_REFERENCE_REQUIRED);
  const note = input.note?.trim() ?? "";
  if (note.length < FUNDING_NOTE_MIN || note.length > 500) throw new HttpError(422, FUNDING_NOTE_REQUIRED);
  if (input.kind === "CONFIRMED_TOPUP") assertRupiah(input.amount, "nominal topup", { min: 1 });
  else {
    assertRupiah(Math.abs(input.amount), "nominal koreksi", { min: 1 });
  }
  const account = await lockFundingAccountForOrganization(tx, input.organizationId);
  // C4: a topup and a positive correction both confirm cash and share one
  // reference space; only a negative correction (a reversal) has its own.
  const businessKey = input.amount > 0 ? fundingCashKey(reference) : fundingCorrectionKey(reference);
  const existing = await tx.fundingEntry.findUnique({ where: { businessKey } });
  if (existing) {
    if (existing.accountId !== account.id || existing.amount !== input.amount || existing.kind !== input.kind) {
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
      note,
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
  | "CAPACITY_SHORTFALL"
  | "ADMITTED_WITHOUT_RESERVATION";

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
  /** ACTIVE money programs without a budget (C1): never "unlimited"; refused under enforcement. */
  programsWithoutBudget: { id: string; name: string }[];
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
  ADMITTED_WITHOUT_RESERVATION:
    "Sumber diterima tanpa reservasi (program berubah menjadi berhadiah setelah penerimaan); seluruh reward-nya ditahan di luar reservasi. Tambah dana terkonfirmasi dan jangan mengubah mode/multiplier program saat masih ada sumber berjalan.",
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
  lateReservation: boolean;
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
  if (row.lateReservation) reasons.push("ADMITTED_WITHOUT_RESERVATION");
  else if (row.sourceType === "SESSION" && row.ceilingRupiah === 0) reasons.push("CEILING_NOT_CONFIGURED");
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
           r."ceilingRupiah", r."remainingRupiah", r."shortfallRupiah", r."campaignShortfallRupiah",
           r."lateReservation", r."createdAt"
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
  // C1: an ACTIVE money program without a budget is reported (shadow) and admits nothing (enforced).
  const withoutBudget = await db.campaign.findMany({
    where: {
      status: "ACTIVE",
      rewardMode: "MONEY_REWARD",
      OR: [{ rewardBudgetRupiah: null }, { rewardBudgetRupiah: { lte: 0 } }],
      ...(options.organizationId ? { organizationId: options.organizationId } : {}),
    },
    select: { id: true, name: true, organizationId: true },
    orderBy: { name: "asc" },
  });

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
      programsWithoutBudget: withoutBudget
        .filter((campaign) => campaign.organizationId === org.id)
        .map((campaign) => ({ id: campaign.id, name: campaign.name })),
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
