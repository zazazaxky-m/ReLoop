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

// ---------- Financial reconciliation ----------

export interface OrgLiability {
  organizationId: string | null;
  organizationName: string;
  /** EARN entries spendable now (status AVAILABLE). */
  earnAvailable: number;
  /** EARN entries still under review (status PENDING). */
  earnPending: number;
  /** Signed ADJUST/REVERSE/PENALTY entries (AVAILABLE + PENDING). */
  adjustments: number;
  /** What the platform currently owes users tied to this org (spendable). */
  outstanding: number;
}

export interface ReconciliationReport {
  organizations: OrgLiability[];
  totalEarnAvailable: number;
  totalEarnPending: number;
  totalOutstanding: number;
  /** Ledger REDEEM entries actually paid out (status REDEEMED), positive rupiah. */
  ledgerRedeemed: number;
  /** Ledger REDEEM entries reserved but not yet paid (status PENDING), positive rupiah. */
  ledgerReserved: number;
  /** Sum of Redemption rows with status SUCCESS. */
  redemptionSuccessTotal: number;
  /** Sum of Redemption rows still in flight (REQUESTED/APPROVED/PROCESSING). */
  redemptionInFlightTotal: number;
  /** ledgerRedeemed − redemptionSuccessTotal; must be 0 in a healthy system. */
  redeemedDiscrepancy: number;
  /** ledgerReserved − redemptionInFlightTotal; must be 0 in a healthy system. */
  reservedDiscrepancy: number;
  /** True when either discrepancy is non-zero (needs manual investigation). */
  hasDiscrepancy: boolean;
  generatedAt: string;
}

/**
 * Builds a platform-wide financial reconciliation:
 *  - Per-organization outstanding liability from EARN ledger entries.
 *  - Global payout reconciliation comparing the append-only REDEEM ledger
 *    against the Redemption request records. REDEEM ledger rows carry no
 *    organizationId (they are user-level debits), so payout figures are
 *    reconciled globally rather than per-org.
 */
export async function getReconciliationReport(): Promise<ReconciliationReport> {
  const [earnGroups, adjustGroups, redeemGroups, redemptionGroups, orgs] =
    await Promise.all([
      prisma.rewardLedger.groupBy({
        by: ["organizationId", "status"],
        where: { entryType: "EARN" },
        _sum: { amount: true },
      }),
      prisma.rewardLedger.groupBy({
        by: ["organizationId", "status"],
        where: { entryType: { in: ["ADJUST", "REVERSE", "PENALTY"] } },
        _sum: { amount: true },
      }),
      prisma.rewardLedger.groupBy({
        by: ["status"],
        where: { entryType: "REDEEM" },
        _sum: { amount: true },
      }),
      prisma.redemption.groupBy({
        by: ["status"],
        _sum: { amount: true },
      }),
      prisma.organization.findMany({ select: { id: true, name: true } }),
    ]);

  const orgNames = new Map(orgs.map((o) => [o.id, o.name]));
  const liabilityByOrg = new Map<string | null, OrgLiability>();

  const ensureOrg = (organizationId: string | null): OrgLiability => {
    let row = liabilityByOrg.get(organizationId);
    if (!row) {
      row = {
        organizationId,
        organizationName:
          organizationId === null
            ? "Tanpa organisasi"
            : orgNames.get(organizationId) ?? "(organisasi dihapus)",
        earnAvailable: 0,
        earnPending: 0,
        adjustments: 0,
        outstanding: 0,
      };
      liabilityByOrg.set(organizationId, row);
    }
    return row;
  };

  for (const g of earnGroups) {
    const row = ensureOrg(g.organizationId);
    const sum = g._sum.amount ?? 0;
    if (g.status === "AVAILABLE") row.earnAvailable += sum;
    else if (g.status === "PENDING") row.earnPending += sum;
  }

  for (const g of adjustGroups) {
    if (g.status !== "AVAILABLE" && g.status !== "PENDING") continue;
    const row = ensureOrg(g.organizationId);
    row.adjustments += g._sum.amount ?? 0;
  }

  const organizations = [...liabilityByOrg.values()].map((row) => ({
    ...row,
    // Spendable liability = available earn + available-side adjustments.
    outstanding: row.earnAvailable + row.adjustments,
  }));
  organizations.sort((a, b) => b.outstanding - a.outstanding);

  const totalEarnAvailable = organizations.reduce((s, o) => s + o.earnAvailable, 0);
  const totalEarnPending = organizations.reduce((s, o) => s + o.earnPending, 0);
  const totalOutstanding = organizations.reduce((s, o) => s + o.outstanding, 0);

  let ledgerRedeemed = 0;
  let ledgerReserved = 0;
  for (const g of redeemGroups) {
    const sum = g._sum.amount ?? 0; // negative
    if (g.status === "REDEEMED") ledgerRedeemed += -sum;
    else if (g.status === "PENDING") ledgerReserved += -sum;
  }

  let redemptionSuccessTotal = 0;
  let redemptionInFlightTotal = 0;
  for (const g of redemptionGroups) {
    const sum = g._sum.amount ?? 0;
    if (g.status === "SUCCESS") redemptionSuccessTotal += sum;
    else if (["REQUESTED", "APPROVED", "PROCESSING"].includes(g.status)) {
      redemptionInFlightTotal += sum;
    }
  }

  const redeemedDiscrepancy = ledgerRedeemed - redemptionSuccessTotal;
  const reservedDiscrepancy = ledgerReserved - redemptionInFlightTotal;

  return {
    organizations,
    totalEarnAvailable,
    totalEarnPending,
    totalOutstanding,
    ledgerRedeemed,
    ledgerReserved,
    redemptionSuccessTotal,
    redemptionInFlightTotal,
    redeemedDiscrepancy,
    reservedDiscrepancy,
    hasDiscrepancy: redeemedDiscrepancy !== 0 || reservedDiscrepancy !== 0,
    generatedAt: new Date().toISOString(),
  };
}
