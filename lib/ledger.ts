import type { LedgerEntryType, LedgerStatus, Prisma, RedemptionStatus, RewardLedger } from "@prisma/client";
import { prisma } from "./prisma";
import { HttpError } from "./rbac";

/** Human-readable label for RewardLedger.reasonCode (wallet / reports UI). */
export function ledgerReasonLabel(
  reasonCode: string | null | undefined,
  fallback = "Transaksi",
): string {
  switch (reasonCode) {
    case "TRASH_BAG_RETURN":
      return "Reward trash bag";
    case "DEPOSIT_ACCEPTED":
    case "ITEM_ACCEPTED":
      return "Setoran mesin";
    case "ANOMALY_REVIEW":
    case "TYPE_MISMATCH":
    case "AI_TYPE_MISMATCH":
    case "AI_LOW_CONFIDENCE":
    case "AI_UNAVAILABLE":
    case "AI_TAXONOMY_MISSING":
    case "BARCODE_MISSING":
    case "REWARD_OUT_OF_RANGE":
      return "Setoran ditinjau";
    case "ACCEPTED":
      return "Setoran mesin";
    case "REVIEW_APPROVED":
      return "Setoran disetujui";
    case "REVIEW_ADJUSTMENT":
      return "Penyesuaian setoran";
    case "REVIEW_REJECTED":
      return "Setoran ditolak";
    case "TOURISM_COMPLIANCE_BONUS":
      return "Bonus kepatuhan wisata";
    case "REDEMPTION_SUCCESS":
    case "REDEMPTION_PROCESSING":
    case "REDEMPTION_RESERVE":
      return "Pencairan";
    case "REDEMPTION_REVERSED":
      return "Pencairan dibatalkan";
    default:
      return reasonCode?.replaceAll("_", " ") || fallback;
  }
}

export interface WalletBalance {
  /** Spendable now = earned available − reserved − settled redemptions (signed sum). */
  available: number;
  /** Earn entries still under review. */
  pending: number;
  /** Lifetime successfully paid out. */
  redeemed: number;
  /** Held by in-flight redemption requests (not yet paid). */
  reserved: number;
  totalEarned: number;
}

export interface LedgerGroup {
  entryType: LedgerEntryType;
  status: LedgerStatus;
  amount: number; // summed signed amount for the group
}

/**
 * Pure balance reducer over grouped ledger rows. Exported for unit testing.
 *
 * REDEEM entries are stored as negative amounts. A redemption request first
 * creates a REDEEM/PENDING reserve (reduces `available`), which becomes
 * REDEEM/REDEEMED on payout or REDEEM/REVERSED if released — keeping the ledger
 * append-only (only `status` changes).
 */
export function computeBalance(groups: LedgerGroup[]): WalletBalance {
  let available = 0;
  let pending = 0;
  let redeemed = 0;
  let reserved = 0;
  let totalEarned = 0;

  for (const row of groups) {
    const sum = row.amount ?? 0;
    if (row.entryType === "EARN") {
      if (row.status === "AVAILABLE") {
        available += sum;
        totalEarned += sum;
      } else if (row.status === "PENDING") {
        pending += sum;
        totalEarned += sum;
      }
    } else if (row.entryType === "REDEEM") {
      // amounts are negative (debits)
      if (row.status === "PENDING") {
        available += sum;
        reserved += -sum;
      } else if (row.status === "REDEEMED") {
        available += sum;
        redeemed += -sum;
      }
      // REVERSED / REJECTED => released, no effect on available
    } else if (
      row.entryType === "ADJUST" ||
      row.entryType === "REVERSE" ||
      row.entryType === "PENALTY"
    ) {
      if (row.status === "AVAILABLE") available += sum;
      else if (row.status === "PENDING") pending += sum;
    }
  }

  return { available, pending, redeemed, reserved, totalEarned };
}

/**
 * Aggregate wallet balance from append-only ledger rows. Pass the transaction
 * that holds `lockUser(tx, userId)` when the result decides a balance mutation.
 */
export async function getWalletBalance(
  userId: string,
  tx?: Prisma.TransactionClient,
): Promise<WalletBalance> {
  const db = tx ?? prisma;
  const rows = await db.rewardLedger.groupBy({
    by: ["status", "entryType"],
    where: { userId },
    _sum: { amount: true },
  });
  return computeBalance(
    rows.map((r) => ({
      entryType: r.entryType,
      status: r.status,
      amount: r._sum.amount ?? 0,
    })),
  );
}

/** Business key of the single EARN row a deposit item may produce. */
export function depositItemEarnKey(depositItemId: string): string {
  return `deposit-item:${depositItemId}:earn`;
}

/** Business key of the reserve (REDEEM) row backing one redemption request. */
export function redemptionReserveKey(redemptionId: string): string {
  return `redemption:${redemptionId}:reserve`;
}

export interface CreateEarnParams {
  userId: string;
  organizationId?: string | null;
  sessionId?: string | null;
  depositItemId: string;
  campaignId?: string | null;
  amount: number;
  status: "PENDING" | "AVAILABLE";
  reasonCode?: string;
}

/**
 * Append-only EARN entry, at most one per deposit item (business key
 * `deposit-item:<id>:earn`; a partial unique index is the database backstop).
 * Never updates existing rows.
 *
 * @deprecated M04: no production caller. Every money path writes through
 * `creditReward` (lib/reward-credit.ts), which takes the User lock, applies the
 * erased-account refusal and never forces a debit. Kept for the wallet
 * inventory tests.
 */
export async function createEarnEntry(
  params: CreateEarnParams,
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? prisma;
  const existing = await db.rewardLedger.findFirst({
    where: {
      depositItemId: params.depositItemId,
      entryType: "EARN",
    },
  });
  if (existing) return existing;

  return db.rewardLedger.create({
    data: {
      userId: params.userId,
      organizationId: params.organizationId ?? null,
      sessionId: params.sessionId ?? null,
      depositItemId: params.depositItemId,
      campaignId: params.campaignId ?? null,
      entryType: "EARN",
      amount: params.amount,
      status: params.status,
      reasonCode: params.reasonCode ?? "ITEM_ACCEPTED",
      referenceType: "DepositItem",
      referenceId: params.depositItemId,
      businessKey: depositItemEarnKey(params.depositItemId),
    },
  });
}

/**
 * Creates the REDEEM/PENDING reserve entry that backs a redemption request,
 * keyed `redemption:<id>:reserve`. Callers must hold `lockUser` on the same
 * `tx` and have checked the balance through it (see lib/wallet-service.ts).
 */
export async function createRedeemReserve(
  params: {
    userId: string;
    amount: number; // positive rupiah; stored as negative
    redemptionId: string;
    provider?: string | null;
  },
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? prisma;
  const existing = await db.rewardLedger.findFirst({
    where: { entryType: "REDEEM", referenceType: "Redemption", referenceId: params.redemptionId },
  });
  if (existing) return existing;

  return db.rewardLedger.create({
    data: {
      userId: params.userId,
      entryType: "REDEEM",
      amount: -Math.abs(params.amount),
      status: "PENDING",
      reasonCode: "REDEMPTION_RESERVE",
      referenceType: "Redemption",
      referenceId: params.redemptionId,
      businessKey: redemptionReserveKey(params.redemptionId),
    },
  });
}

export type RedeemOutcome = "success" | "failed";

export const RESERVE_MISSING =
  "Saldo yang ditahan untuk pencairan ini tidak ditemukan. Hubungi tim keuangan untuk rekonsiliasi.";
export const RESERVE_MISMATCH =
  "Saldo yang ditahan tidak sesuai dengan pengajuan pencairan. Hubungi tim keuangan untuk rekonsiliasi.";

/** Reserve status that agrees with a payout request in `status`. */
export function expectedReserveStatus(status: RedemptionStatus): LedgerStatus {
  if (status === "SUCCESS") return "REDEEMED";
  if (status === "FAILED" || status === "REVERSED") return "REVERSED";
  return "PENDING"; // REQUESTED / APPROVED / PROCESSING still hold the money
}

/**
 * Reads, through the caller's `tx`, the single live reserve backing a payout
 * request and proves it belongs to the same user for the same amount.
 * REDEEM/REJECTED rows are neutralized legacy duplicates (M01) and never count.
 * Missing or mismatching reserves are 409: a transition must not guess.
 */
export async function loadRedeemReserve(
  tx: Prisma.TransactionClient,
  redemption: { id: string; userId: string; amount: number },
): Promise<RewardLedger> {
  const rows = await tx.rewardLedger.findMany({
    where: {
      entryType: "REDEEM",
      referenceType: "Redemption",
      referenceId: redemption.id,
      status: { not: "REJECTED" },
    },
    orderBy: { id: "asc" },
    take: 2,
  });
  if (rows.length === 0) throw new HttpError(409, RESERVE_MISSING);
  const [reserve] = rows;
  if (rows.length > 1 || reserve.userId !== redemption.userId || reserve.amount !== -redemption.amount) {
    throw new HttpError(409, RESERVE_MISMATCH);
  }
  return reserve;
}

/**
 * Settles a payout request's reserve inside the caller's transaction, which
 * must hold `lockUser` and `lockRedemption` for it (lib/wallet-service.ts).
 *
 * Either proves an existing settlement that already matches `outcome`
 * (`changed: false`) or performs exactly one conditional PENDING -> outcome
 * mutation (`changed: true`). A missing or mismatching reserve, or one settled
 * the opposite way, throws 409 so the caller's transaction rolls back: there is
 * no successful no-op for the opposite outcome.
 */
export async function settleRedeemLedger(
  redemptionId: string,
  outcome: RedeemOutcome,
  tx: Prisma.TransactionClient,
): Promise<{ entry: RewardLedger; changed: boolean }> {
  const redemption = await tx.redemption.findUnique({
    where: { id: redemptionId },
    select: { id: true, userId: true, amount: true },
  });
  if (!redemption) throw new HttpError(404, "Pengajuan pencairan tidak ditemukan");
  const reserve = await loadRedeemReserve(tx, redemption);
  const target: LedgerStatus = outcome === "success" ? "REDEEMED" : "REVERSED";

  if (reserve.status === target) return { entry: reserve, changed: false };
  if (reserve.status !== "PENDING") throw new HttpError(409, RESERVE_MISMATCH);

  const changed = await tx.rewardLedger.updateMany({
    where: { id: reserve.id, status: "PENDING" },
    data: { status: target },
  });
  if (changed.count !== 1) {
    const current = await tx.rewardLedger.findUnique({ where: { id: reserve.id } });
    if (current?.status === target) return { entry: current, changed: false };
    throw new HttpError(409, RESERVE_MISMATCH);
  }
  return { entry: { ...reserve, status: target }, changed: true };
}

export async function getLedgerHistory(
  userId: string,
  options?: { skip?: number; take?: number },
) {
  return prisma.rewardLedger.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    skip: options?.skip,
    take: options?.take ?? 50,
    include: {
      depositItem: {
        select: {
          wasteType: { select: { name: true } },
          status: true,
          baseRewardAmount: true,
          complianceMultiplier: true,
        },
      },
      session: {
        select: {
          machine: { select: { name: true, machineCode: true } },
        },
      },
    },
  });
}

export async function countLedgerHistory(userId: string): Promise<number> {
  return prisma.rewardLedger.count({ where: { userId } });
}

/** Ledger rows must never be deleted or have amounts edited. */
export function assertAppendOnlyPolicy(
  action: "update" | "delete",
): never {
  throw new Error(
    `RewardLedger is append-only; ${action} is not allowed. Use REVERSE/ADJUST entries.`,
  );
}

export type LedgerFilter = {
  userId?: string;
  status?: LedgerStatus;
  entryType?: LedgerEntryType;
};
