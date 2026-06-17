import type { LedgerEntryType, LedgerStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";

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

/** Aggregate wallet balance from append-only ledger rows. */
export async function getWalletBalance(userId: string): Promise<WalletBalance> {
  const rows = await prisma.rewardLedger.groupBy({
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

/** Append-only EARN entry. Never updates existing rows. */
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
    },
  });
}

/** Creates the REDEEM/PENDING reserve entry that backs a redemption request. */
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
    },
  });
}

/**
 * Settles the redemption's reserve ledger entry. Idempotent: re-running with the
 * same outcome (or after settlement) is a no-op.
 */
export async function settleRedeemLedger(
  redemptionId: string,
  outcome: "success" | "failed",
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? prisma;
  const entry = await db.rewardLedger.findFirst({
    where: {
      entryType: "REDEEM",
      referenceType: "Redemption",
      referenceId: redemptionId,
      status: "PENDING",
    },
  });
  if (!entry) return null; // already settled or never reserved
  return db.rewardLedger.update({
    where: { id: entry.id },
    data: { status: outcome === "success" ? "REDEEMED" : "REVERSED" },
  });
}

export async function getLedgerHistory(
  userId: string,
  limit = 50,
) {
  return prisma.rewardLedger.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      depositItem: {
        select: {
          wasteType: { select: { name: true } },
          status: true,
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
