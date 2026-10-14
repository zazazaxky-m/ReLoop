import {
  Prisma,
  RedemptionStatus as RedemptionStatuses,
  type LedgerEntryType,
  type LedgerStatus,
  type RedemptionStatus,
} from "@prisma/client";
import { computeBalance, expectedReserveStatus, type LedgerGroup, type WalletBalance } from "./ledger";
import { prisma } from "./prisma";
import { readFundingVisibility, type FundingVisibility } from "./reward-funding";

/**
 * Platform-wide financial reconciliation (M05, finding LOG-07).
 *
 * Kept apart from lib/ledger.ts, which owns the per-user balance semantics
 * (`computeBalance`) and the ledger writers: this module is a read model over
 * the whole ledger. It reuses `computeBalance` per user and
 * `expectedReserveStatus` per payout request instead of restating them, and
 * shares its ledger predicates with scripts/reconcile-wallet-history.ts.
 *
 * Every aggregate is read in ONE read-only REPEATABLE READ transaction, so a
 * settlement that commits while the report runs cannot pair a ledger figure
 * from before it with a payout figure from after it (a false discrepancy).
 */

/** Anything that can run raw SQL: the prisma client or a TransactionClient. */
export type RawReader = Pick<Prisma.TransactionClient, "$queryRaw">;

const toNumber = (value: bigint | number | null | undefined) => Number(value ?? 0);

/** Request statuses whose reserve must be REDEEMED (paid) / PENDING (held), per `expectedReserveStatus`. */
const PAID_STATUSES = Object.values(RedemptionStatuses).filter((status) => expectedReserveStatus(status) === "REDEEMED");
const IN_FLIGHT_STATUSES = Object.values(RedemptionStatuses).filter((status) => expectedReserveStatus(status) === "PENDING");

// ---------------------------------------------------------------------------
// Ledger predicates shared with scripts/reconcile-wallet-history.ts
// ---------------------------------------------------------------------------

/**
 * Every user's balance: `computeBalance` over that user's own ledger rows.
 * One SQL statement, so it is a consistent read even outside a transaction.
 */
export async function readUserBalances(db: RawReader): Promise<Map<string, WalletBalance>> {
  const groups = await db.$queryRaw<{
    userId: string; entryType: LedgerGroup["entryType"]; status: LedgerGroup["status"]; amount: bigint | null;
  }[]>`
    SELECT "userId", "entryType"::text AS "entryType", status::text AS status, SUM(amount)::bigint AS amount
    FROM "RewardLedger" GROUP BY "userId", "entryType", status`;
  const byUser = new Map<string, LedgerGroup[]>();
  for (const group of groups) {
    const list = byUser.get(group.userId) ?? [];
    list.push({ entryType: group.entryType, status: group.status, amount: toNumber(group.amount) });
    byUser.set(group.userId, list);
  }
  return new Map([...byUser.entries()].map(([userId, rows]) => [userId, computeBalance(rows)]));
}

export type ReserveWithoutRequestProblem =
  | "NOT_LINKED_TO_REDEMPTION" | "MISSING_REFERENCE" | "REQUEST_NOT_FOUND" | "OWNER_MISMATCH" | "AMOUNT_MISMATCH";

export interface ReserveWithoutRequest {
  ledgerId: string; userId: string; amount: number; status: string;
  referenceType: string | null; referenceId: string | null; problem: ReserveWithoutRequestProblem;
}

/** REDEEM rows not backed by a matching request (no/unknown reference, other owner, other amount). */
export async function findReservesWithoutRequest(db: RawReader): Promise<ReserveWithoutRequest[]> {
  return db.$queryRaw<ReserveWithoutRequest[]>`
    SELECT l.id AS "ledgerId", l."userId", l.amount, l.status::text AS status,
           l."referenceType", l."referenceId",
           CASE
             WHEN l."referenceType" IS DISTINCT FROM 'Redemption' THEN 'NOT_LINKED_TO_REDEMPTION'
             WHEN l."referenceId" IS NULL THEN 'MISSING_REFERENCE'
             WHEN r.id IS NULL THEN 'REQUEST_NOT_FOUND'
             WHEN r."userId" <> l."userId" THEN 'OWNER_MISMATCH'
             ELSE 'AMOUNT_MISMATCH'
           END AS problem
    FROM "RewardLedger" l
    LEFT JOIN "Redemption" r ON l."referenceType" = 'Redemption' AND r.id = l."referenceId"
    WHERE l."entryType" = 'REDEEM'
      AND (l."referenceType" IS DISTINCT FROM 'Redemption' OR l."referenceId" IS NULL OR r.id IS NULL
           OR r."userId" <> l."userId" OR -l.amount <> r.amount)
    ORDER BY l."createdAt", l.id`;
}

// ---------------------------------------------------------------------------
// Net liabilities
// ---------------------------------------------------------------------------

export interface LiabilitySummary {
  /** Saldo tersedia: what users can spend now (AVAILABLE EARN/ADJUST/... minus reserves and payouts). */
  availableLiability: number;
  /** Menunggu pemeriksaan: PENDING EARN/ADJUST/... not yet spendable. */
  pendingLiability: number;
  /** Sedang dicairkan: held by payout requests in flight (REDEEM PENDING). */
  reservedLiability: number;
  /** Sudah dibayar: paid out (REDEEM REDEEMED); reported apart, never part of the obligation. */
  paidTotal: number;
  /** availableLiability + reservedLiability + pendingLiability. */
  totalObligation: number;
}

/** Users whose own ledger is below zero (e.g. a legacy duplicate payout): money to recover, not to owe. */
export interface OverdrawnBalances {
  users: number;
  availableShortfall: number;
  pendingShortfall: number;
}

/**
 * Sums per-user balances (each from `computeBalance`). A user's negative
 * balance is reported as a shortfall and never offsets what other users are
 * owed: the liability counts only positive balances.
 */
export function summarizeLiabilities(balances: Iterable<WalletBalance>): LiabilitySummary & { overdrawn: OverdrawnBalances } {
  let availableLiability = 0;
  let pendingLiability = 0;
  let reservedLiability = 0;
  let paidTotal = 0;
  const overdrawn: OverdrawnBalances = { users: 0, availableShortfall: 0, pendingShortfall: 0 };
  for (const balance of balances) {
    if (balance.available >= 0) availableLiability += balance.available;
    else overdrawn.availableShortfall -= balance.available;
    if (balance.pending >= 0) pendingLiability += balance.pending;
    else overdrawn.pendingShortfall -= balance.pending;
    if (balance.available < 0 || balance.pending < 0) overdrawn.users += 1;
    reservedLiability += balance.reserved;
    paidTotal += balance.redeemed;
  }
  const totalObligation = availableLiability + reservedLiability + pendingLiability;
  return { availableLiability, pendingLiability, reservedLiability, paidTotal, totalObligation, overdrawn };
}

/** Net liability only (mobile overview): one statement, no per-request work. */
export async function getLiabilitySummary(db: RawReader = prisma): Promise<LiabilitySummary> {
  const { availableLiability, pendingLiability, reservedLiability, paidTotal, totalObligation } =
    summarizeLiabilities((await readUserBalances(db)).values());
  return { availableLiability, pendingLiability, reservedLiability, paidTotal, totalObligation };
}

// ---------------------------------------------------------------------------
// Organization allocation (B02 extension point) and reward funding (B01a)
// ---------------------------------------------------------------------------

/**
 * B01a fills the funding side of this section: `report.funding`
 * (lib/reward-funding.ts readFundingVisibility, read in the same snapshot)
 * shows confirmed cash, held obligations and capacity per organization plus
 * the holds that need an operator. The allocation of the user liability per
 * organization (`readOrganizationAllocations`) stays B02's: funding
 * obligations are the program side of the money, the ledger liability the
 * user side, and only B02's per-lot allocation ties the two together.
 */

/** Report-level allocation state. B02 adds the allocated state once allocations are backfilled. */
export const ALLOCATION_NOT_AVAILABLE = "NOT_ALLOCATED_UNTIL_B01" as const;
export type ReportAllocationStatus = typeof ALLOCATION_NOT_AVAILABLE;
/** Per-organization allocation state. */
export type OrganizationAllocationStatus = "UNALLOCATED_LEGACY";

export interface OrganizationAllocations {
  status: ReportAllocationStatus;
  /** Net available liability attributed to each organization id. Empty until B01. */
  availableByOrganization: ReadonlyMap<string, number>;
}

/**
 * B01 extension point (finding LOG-07 stays open until it lands): the share of
 * the net available liability that belongs to each organization.
 *
 * TODO(B01/B02): read the per-organization allocations (B02 plans
 * `RewardAllocation` / credit lots that attribute every reserve and payout to
 * the earning it spends, plus a backfill of history) through the report's
 * snapshot `tx`, and report the allocated state.
 *
 * Until then NOTHING is allocated: REDEEM rows carry no organization, so gross
 * EARN per organization minus anything would invent an attribution. The whole
 * available liability is the explicit UNALLOCATED_LEGACY bucket.
 */
export async function readOrganizationAllocations(_tx: RawReader): Promise<OrganizationAllocations> {
  return { status: ALLOCATION_NOT_AVAILABLE, availableByOrganization: new Map() };
}

export interface OrgLiability {
  organizationId: string | null;
  organizationName: string;
  /** Gross EARN issued for this organization with status AVAILABLE. Payouts are NOT subtracted (information only). */
  earnAvailable: number;
  /** Gross EARN for this organization still under review (status PENDING). */
  earnPending: number;
  /** Signed ADJUST/REVERSE/PENALTY entries (AVAILABLE + PENDING), gross. */
  adjustments: number;
  /** Net spendable liability allocated to this organization: 0 until B01 (see unallocatedLegacyAmount). */
  outstanding: number;
  allocationStatus: OrganizationAllocationStatus;
}

// ---------------------------------------------------------------------------
// Payout requests vs ledger, per request
// ---------------------------------------------------------------------------

export type PayoutMismatchProblem =
  | "RESERVE_MISSING" | "DUPLICATE_RESERVE" | "RESERVE_STATE_MISMATCH" | "AMOUNT_MISMATCH"
  | Exclude<ReserveWithoutRequestProblem, "AMOUNT_MISMATCH">;

/** One request (or one ledger row backing no request) whose ledger disagrees with its status. */
export interface PayoutMismatch {
  /** The payout request; for a ledger row backing no request, the id it references (or null). */
  redemptionId: string | null;
  userId: string;
  /** null when no request of this owner exists for the ledger row. */
  requestStatus: RedemptionStatus | null;
  requestAmount: number | null;
  /** Live reserve rows of this owner for the request (REJECTED duplicates are neutralized and excluded). */
  reserveStatuses: LedgerStatus[];
  ledgerIds: string[];
  /** Ledger paid (REDEEMED) minus what the request says was paid, for this request only. */
  paidDifference: number;
  /** Ledger held (PENDING) minus what the request says is in flight, for this request only. */
  reservedDifference: number;
  problem: PayoutMismatchProblem;
}

export interface PayoutRequestRow {
  redemptionId: string; userId: string; requestStatus: RedemptionStatus; requestAmount: number;
  reserveStatuses: LedgerStatus[]; ledgerIds: string[]; ledgerPaid: number; ledgerReserved: number;
}

/**
 * Requests whose own live reserve rows (same owner, not REJECTED) disagree with
 * the request status in the paid or the held amount. Compared per request, so
 * a +100 on one request can never hide a -100 on another.
 */
export async function findMismatchedRequests(db: RawReader): Promise<PayoutRequestRow[]> {
  const rows = await db.$queryRaw<(Omit<PayoutRequestRow, "ledgerPaid" | "ledgerReserved"> & {
    ledgerPaid: bigint; ledgerReserved: bigint;
  })[]>`
    SELECT r.id AS "redemptionId", r."userId", r.status::text AS "requestStatus", r.amount AS "requestAmount",
           COALESCE(array_agg(l.status::text ORDER BY l."createdAt", l.id) FILTER (WHERE l.id IS NOT NULL), '{}') AS "reserveStatuses",
           COALESCE(array_agg(l.id ORDER BY l."createdAt", l.id) FILTER (WHERE l.id IS NOT NULL), '{}') AS "ledgerIds",
           COALESCE(SUM(-l.amount) FILTER (WHERE l.status = 'REDEEMED'), 0)::bigint AS "ledgerPaid",
           COALESCE(SUM(-l.amount) FILTER (WHERE l.status = 'PENDING'), 0)::bigint AS "ledgerReserved"
    FROM "Redemption" r
    LEFT JOIN "RewardLedger" l
      ON l."entryType" = 'REDEEM' AND l."referenceType" = 'Redemption' AND l."referenceId" = r.id
     AND l."userId" = r."userId" AND l.status <> 'REJECTED'
    GROUP BY r.id
    HAVING COALESCE(SUM(-l.amount) FILTER (WHERE l.status = 'REDEEMED'), 0)
             <> CASE WHEN r.status::text IN (${Prisma.join(PAID_STATUSES)}) THEN r.amount ELSE 0 END
        OR COALESCE(SUM(-l.amount) FILTER (WHERE l.status = 'PENDING'), 0)
             <> CASE WHEN r.status::text IN (${Prisma.join(IN_FLIGHT_STATUSES)}) THEN r.amount ELSE 0 END
    ORDER BY r."createdAt", r.id`;
  return rows.map((row) => ({ ...row, ledgerPaid: toNumber(row.ledgerPaid), ledgerReserved: toNumber(row.ledgerReserved) }));
}

function requestMismatch(row: PayoutRequestRow): PayoutMismatch {
  const paid = PAID_STATUSES.includes(row.requestStatus) ? row.requestAmount : 0;
  const held = IN_FLIGHT_STATUSES.includes(row.requestStatus) ? row.requestAmount : 0;
  // Classify with the rows that still hold or paid money. A released (REVERSED)
  // legacy row stays listed in reserveStatuses but is never a "duplicate".
  const moneyRows = row.reserveStatuses.filter((status) => status === "PENDING" || status === "REDEEMED");
  const problem: PayoutMismatchProblem =
    row.ledgerIds.length === 0 ? "RESERVE_MISSING"
      : moneyRows.length > 1 ? "DUPLICATE_RESERVE"
        : moneyRows.length === 0 || moneyRows[0] !== expectedReserveStatus(row.requestStatus) ? "RESERVE_STATE_MISMATCH"
          : "AMOUNT_MISMATCH";
  return {
    redemptionId: row.redemptionId, userId: row.userId, requestStatus: row.requestStatus, requestAmount: row.requestAmount,
    reserveStatuses: row.reserveStatuses, ledgerIds: row.ledgerIds,
    paidDifference: row.ledgerPaid - paid, reservedDifference: row.ledgerReserved - held, problem,
  };
}

/** A paid or held REDEEM row that backs no request of its owner (amount mismatches are per request). */
function orphanMismatch(row: ReserveWithoutRequest): PayoutMismatch | null {
  if (row.problem === "AMOUNT_MISMATCH" || (row.status !== "PENDING" && row.status !== "REDEEMED")) return null;
  return {
    redemptionId: row.referenceType === "Redemption" ? row.referenceId : null, userId: row.userId,
    requestStatus: null, requestAmount: null, reserveStatuses: [row.status as LedgerStatus], ledgerIds: [row.ledgerId],
    paidDifference: row.status === "REDEEMED" ? -row.amount : 0,
    reservedDifference: row.status === "PENDING" ? -row.amount : 0,
    problem: row.problem,
  };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

/** At most this many mismatches are listed; the discrepancy totals always cover all of them. */
export const MAX_LISTED_MISMATCHES = 200;

export interface ReconciliationReport extends LiabilitySummary {
  /** Users below zero, reported apart from (never netted into) the liability. */
  overdrawn: OverdrawnBalances;
  allocationStatus: ReportAllocationStatus;
  /** Part of availableLiability not allocated to any organization (all of it until B01). */
  unallocatedLegacyAmount: number;
  organizations: OrgLiability[];
  /**
   * @deprecated Compatibility alias of `availableLiability` (net spendable).
   * Before M05 it was the gross AVAILABLE earning, payouts not subtracted.
   */
  totalOutstanding: number;
  /** Gross EARN with status AVAILABLE across all organizations (information, not liability). */
  totalEarnAvailable: number;
  /** Gross EARN with status PENDING (information; see pendingLiability). */
  totalEarnPending: number;
  /** Ledger REDEEM entries paid out (status REDEEMED), positive rupiah. */
  ledgerRedeemed: number;
  /** Ledger REDEEM entries held (status PENDING), positive rupiah. */
  ledgerReserved: number;
  /** Sum of Redemption rows with status SUCCESS. */
  redemptionSuccessTotal: number;
  /** Sum of Redemption rows still in flight (REQUESTED/APPROVED/PROCESSING). */
  redemptionInFlightTotal: number;
  /** Sum of |paidDifference| over every mismatch: 0 only when every request agrees with its ledger. */
  redeemedDiscrepancy: number;
  /** Sum of |reservedDifference| over every mismatch: 0 only when every request agrees with its ledger. */
  reservedDiscrepancy: number;
  /** redeemedDiscrepancy !== 0 || reservedDiscrepancy !== 0. */
  hasDiscrepancy: boolean;
  /** Mismatches per request and status (first MAX_LISTED_MISMATCHES). */
  payoutMismatches: PayoutMismatch[];
  payoutMismatchCount: number;
  /** Payout requests flagged by an operator because the transfer outcome is uncertain (M02); still held. */
  flaggedTransfers: { count: number; amount: number };
  /**
   * Reward effects the system refused to force into the ledger (M04,
   * lib/reward-credit.ts): corrections of balances already paid out and
   * credits to erased accounts. Outside the obligation figures until an
   * operator settles each OPEN case.
   */
  rewardCases: {
    open: number;
    /** Positive rupiah at stake across OPEN cases. */
    openAmount: number;
    /** Newest OPEN cases (at most 50). */
    recent: Array<{
      id: string;
      businessKey: string;
      userId: string;
      depositItemId: string | null;
      amount: number;
      entryType: LedgerEntryType;
      reasonCode: string;
      createdAt: Date;
    }>;
  };
  /**
   * B01a: reward funding per organization (confirmed cash, held obligations,
   * capacity) and the reservations that need an operator (owner and reason).
   * Program-side money, read in the same snapshot; kept apart from the user
   * liability figures above.
   */
  funding: FundingVisibility;
  /** The transaction every figure was read in. */
  snapshot: { readOnly: boolean; isolation: string };
  generatedAt: string;
}

/** Everything the report is computed from, read in one snapshot. */
export interface ReconciliationSnapshot {
  snapshot: { readOnly: boolean; isolation: string };
  userBalances: Iterable<WalletBalance>;
  organizationGroups: { organizationId: string | null; entryType: LedgerEntryType; status: LedgerStatus; amount: number }[];
  organizationNames: ReadonlyMap<string, string>;
  allocations: OrganizationAllocations;
  mismatchedRequests: PayoutRequestRow[];
  reservesWithoutRequest: ReserveWithoutRequest[];
  redemptionTotals: { status: RedemptionStatus; amount: number; flaggedCount: number; flaggedAmount: number }[];
  rewardCases: ReconciliationReport["rewardCases"];
  /** Omitted only by unit snapshots that test the ledger figures alone. */
  funding?: FundingVisibility;
  generatedAt: string;
}

const EMPTY_FUNDING: FundingVisibility = {
  enforced: false,
  totalConfirmedRupiah: 0,
  totalHeldRupiah: 0,
  staleHoldCount: 0,
  organizations: [],
};

/** Pure: computes the report from one snapshot. */
export function buildReconciliationReport(input: ReconciliationSnapshot): ReconciliationReport {
  const { overdrawn, ...liability } = summarizeLiabilities(input.userBalances);

  const organizations = new Map<string | null, OrgLiability>();
  const orgRow = (organizationId: string | null): OrgLiability => {
    let row = organizations.get(organizationId);
    if (!row) {
      row = {
        organizationId,
        organizationName: organizationId === null
          ? "Tanpa organisasi"
          : input.organizationNames.get(organizationId) ?? "(organisasi dihapus)",
        earnAvailable: 0, earnPending: 0, adjustments: 0,
        outstanding: organizationId === null ? 0 : input.allocations.availableByOrganization.get(organizationId) ?? 0,
        allocationStatus: "UNALLOCATED_LEGACY",
      };
      organizations.set(organizationId, row);
    }
    return row;
  };
  for (const group of input.organizationGroups) {
    if (group.status !== "AVAILABLE" && group.status !== "PENDING") continue;
    const row = orgRow(group.organizationId);
    if (group.entryType === "EARN") {
      if (group.status === "AVAILABLE") row.earnAvailable += group.amount;
      else row.earnPending += group.amount;
    } else if (group.entryType !== "REDEEM") {
      row.adjustments += group.amount;
    }
  }
  for (const organizationId of input.allocations.availableByOrganization.keys()) orgRow(organizationId);
  const organizationList = [...organizations.values()].sort((a, b) =>
    b.outstanding - a.outstanding || b.earnAvailable - a.earnAvailable || a.organizationName.localeCompare(b.organizationName));
  const allocated = organizationList.reduce((sum, org) => sum + org.outstanding, 0);

  const mismatches = [
    ...input.mismatchedRequests.map(requestMismatch),
    ...input.reservesWithoutRequest.map(orphanMismatch).filter((row): row is PayoutMismatch => row !== null),
  ];
  // Absolute values per request: opposite-signed differences never cancel out.
  const redeemedDiscrepancy = mismatches.reduce((sum, row) => sum + Math.abs(row.paidDifference), 0);
  const reservedDiscrepancy = mismatches.reduce((sum, row) => sum + Math.abs(row.reservedDifference), 0);
  const hasDiscrepancy = redeemedDiscrepancy !== 0 || reservedDiscrepancy !== 0;

  const sumStatuses = (statuses: readonly RedemptionStatus[]) =>
    input.redemptionTotals.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row.amount, 0);

  return {
    ...liability,
    overdrawn,
    allocationStatus: input.allocations.status,
    unallocatedLegacyAmount: liability.availableLiability - allocated,
    organizations: organizationList,
    totalOutstanding: liability.availableLiability,
    totalEarnAvailable: organizationList.reduce((sum, org) => sum + org.earnAvailable, 0),
    totalEarnPending: organizationList.reduce((sum, org) => sum + org.earnPending, 0),
    ledgerRedeemed: liability.paidTotal,
    ledgerReserved: liability.reservedLiability,
    redemptionSuccessTotal: sumStatuses(PAID_STATUSES),
    redemptionInFlightTotal: sumStatuses(IN_FLIGHT_STATUSES),
    redeemedDiscrepancy,
    reservedDiscrepancy,
    hasDiscrepancy,
    payoutMismatches: mismatches.slice(0, MAX_LISTED_MISMATCHES),
    payoutMismatchCount: mismatches.length,
    flaggedTransfers: {
      count: input.redemptionTotals.reduce((sum, row) => sum + row.flaggedCount, 0),
      amount: input.redemptionTotals.reduce((sum, row) => sum + row.flaggedAmount, 0),
    },
    rewardCases: input.rewardCases,
    funding: input.funding ?? EMPTY_FUNDING,
    snapshot: input.snapshot,
    generatedAt: input.generatedAt,
  };
}

/** Test seam injected by the caller's process (never reachable over HTTP). Production passes nothing. */
export interface ReconciliationReportHooks {
  /** Inside the snapshot, after the ledger aggregates and before the payout requests are read. */
  afterLedgerRead?: () => Promise<void>;
}

const REPORT_TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  maxWait: 10_000,
  timeout: 30_000,
};

/**
 * Builds the platform-wide reconciliation from one read-only REPEATABLE READ
 * snapshot: net liabilities from the ledger (per-user `computeBalance`), gross
 * issuance per organization, the organization allocation state, payout
 * requests compared with their reserves per request, and the open M04 reward
 * cases. Read-only: it takes no row locks, so it never waits for (or blocks)
 * a wallet transaction.
 */
export async function getReconciliationReport(hooks: ReconciliationReportHooks = {}): Promise<ReconciliationReport> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    // The first query takes the snapshot every later query reads.
    const [snapshot] = await tx.$queryRaw<{ readOnly: string; isolation: string }[]>`
      SELECT current_setting('transaction_read_only') AS "readOnly",
             current_setting('transaction_isolation') AS isolation`;

    const userBalances = await readUserBalances(tx);
    const organizationGroups = (await tx.$queryRaw<{
      organizationId: string | null; entryType: LedgerEntryType; status: LedgerStatus; amount: bigint | null;
    }[]>`
      SELECT "organizationId", "entryType"::text AS "entryType", status::text AS status, SUM(amount)::bigint AS amount
      FROM "RewardLedger"
      WHERE "entryType" IN ('EARN', 'ADJUST', 'REVERSE', 'PENALTY') AND status IN ('AVAILABLE', 'PENDING')
      GROUP BY "organizationId", "entryType", status`).map((row) => ({ ...row, amount: toNumber(row.amount) }));
    const allocations = await readOrganizationAllocations(tx);
    const funding = await readFundingVisibility(tx);
    await hooks.afterLedgerRead?.();

    const mismatchedRequests = await findMismatchedRequests(tx);
    const reservesWithoutRequest = await findReservesWithoutRequest(tx);
    const redemptionTotals = (await tx.$queryRaw<{
      status: RedemptionStatus; amount: bigint; flaggedCount: number; flaggedAmount: bigint;
    }[]>`
      SELECT status::text AS status, COALESCE(SUM(amount), 0)::bigint AS amount,
             (count(*) FILTER (WHERE "reconciliationRequired"))::int AS "flaggedCount",
             COALESCE(SUM(amount) FILTER (WHERE "reconciliationRequired"), 0)::bigint AS "flaggedAmount"
      FROM "Redemption" GROUP BY status`).map((row) => ({
      ...row, amount: toNumber(row.amount), flaggedAmount: toNumber(row.flaggedAmount) }));
    const organizations = await tx.organization.findMany({ select: { id: true, name: true } });
    const recent = await tx.rewardReconciliationCase.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, businessKey: true, userId: true, depositItemId: true,
        amount: true, entryType: true, reasonCode: true, createdAt: true,
      },
    });
    const caseTotals = await tx.rewardReconciliationCase.aggregate({
      where: { status: "OPEN" },
      _count: { _all: true },
      _sum: { amount: true },
    });

    return buildReconciliationReport({
      snapshot: { readOnly: snapshot.readOnly === "on", isolation: snapshot.isolation },
      userBalances: userBalances.values(),
      organizationGroups,
      organizationNames: new Map(organizations.map((org) => [org.id, org.name])),
      allocations,
      mismatchedRequests,
      reservesWithoutRequest,
      redemptionTotals,
      rewardCases: { open: caseTotals._count._all, openAmount: caseTotals._sum.amount ?? 0, recent },
      funding,
      generatedAt: new Date().toISOString(),
    });
  }, REPORT_TX_OPTIONS);
}
