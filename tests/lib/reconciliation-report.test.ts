import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { WalletBalance } from '@/lib/ledger';
import {
  ALLOCATION_NOT_AVAILABLE,
  MAX_LISTED_MISMATCHES,
  buildReconciliationReport,
  getReconciliationReport,
  readOrganizationAllocations,
  summarizeLiabilities,
  type PayoutRequestRow,
  type ReconciliationSnapshot,
} from '@/lib/reconciliation-report';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: vi.fn() } }));
// B01a: the funding visibility is read in the same snapshot; its own reads are unit-tested in reward-funding.test.ts.
vi.mock('@/lib/reward-funding', () => ({
  readFundingVisibility: vi.fn(async () => ({
    enforced: false, totalConfirmedRupiah: 0, totalHeldRupiah: 0, staleHoldCount: 0, organizations: [] })),
}));

const balance = (overrides: Partial<WalletBalance>): WalletBalance => ({
  available: 0, pending: 0, redeemed: 0, reserved: 0, totalEarned: 0, ...overrides,
});

function snapshot(overrides: Partial<ReconciliationSnapshot> = {}): ReconciliationSnapshot {
  return {
    snapshot: { readOnly: true, isolation: 'repeatable read' },
    userBalances: [],
    organizationGroups: [],
    organizationNames: new Map(),
    allocations: { status: ALLOCATION_NOT_AVAILABLE, availableByOrganization: new Map() },
    mismatchedRequests: [],
    reservesWithoutRequest: [],
    redemptionTotals: [],
    rewardCases: { open: 0, openAmount: 0, recent: [] },
    generatedAt: '2026-10-13T08:00:00.000Z',
    ...overrides,
  };
}

const request = (overrides: Partial<PayoutRequestRow>): PayoutRequestRow => ({
  redemptionId: 'r1', userId: 'u1', requestStatus: 'SUCCESS', requestAmount: 100,
  reserveStatuses: ['REDEEMED'], ledgerIds: ['l1'], ledgerPaid: 100, ledgerReserved: 0, ...overrides,
});

describe('summarizeLiabilities', () => {
  it('sums per-user balances into net liabilities with the brief formula', () => {
    const summary = summarizeLiabilities([
      balance({ available: 60_000, reserved: 0, redeemed: 40_000 }),
      balance({ available: 5_000, pending: 2_000, reserved: 3_000 }),
    ]);
    expect(summary).toEqual({
      availableLiability: 65_000, pendingLiability: 2_000, reservedLiability: 3_000, paidTotal: 40_000,
      totalObligation: 70_000, overdrawn: { users: 0, availableShortfall: 0, pendingShortfall: 0 },
    });
  });

  it('never nets one user\'s negative balance against what another user is owed', () => {
    const summary = summarizeLiabilities([
      balance({ available: 10_000 }),
      balance({ available: -5_000, redeemed: 5_000 }),
      balance({ available: 1_000, pending: -300 }),
    ]);
    expect(summary.availableLiability).toBe(11_000);
    expect(summary.pendingLiability).toBe(0);
    expect(summary.overdrawn).toEqual({ users: 2, availableShortfall: 5_000, pendingShortfall: 300 });
  });
});

describe('buildReconciliationReport', () => {
  it('reports a fully redeemed balance as no spendable liability and keeps totalOutstanding as its alias', () => {
    const report = buildReconciliationReport(snapshot({
      userBalances: [balance({ available: 0, redeemed: 100_000 })],
      organizationGroups: [{ organizationId: null, entryType: 'EARN', status: 'AVAILABLE', amount: 100_000 }],
      redemptionTotals: [{ status: 'SUCCESS', amount: 100_000, flaggedCount: 0, flaggedAmount: 0 }],
    }));
    expect(report).toMatchObject({
      availableLiability: 0, reservedLiability: 0, paidTotal: 100_000, totalObligation: 0,
      totalOutstanding: 0, totalEarnAvailable: 100_000, ledgerRedeemed: 100_000, redemptionSuccessTotal: 100_000,
      hasDiscrepancy: false,
    });
  });

  it('compares payout requests one by one so +100/-100 never cancels out', () => {
    const report = buildReconciliationReport(snapshot({
      mismatchedRequests: [
        request({ redemptionId: 'paid-but-held', requestStatus: 'SUCCESS', reserveStatuses: ['PENDING'], ledgerPaid: 0, ledgerReserved: 100 }),
        request({ redemptionId: 'held-but-paid', requestStatus: 'PROCESSING', reserveStatuses: ['REDEEMED'], ledgerPaid: 100, ledgerReserved: 0 }),
      ],
    }));
    expect(report.redeemedDiscrepancy).toBe(200);
    expect(report.reservedDiscrepancy).toBe(200);
    expect(report.hasDiscrepancy).toBe(true);
    expect(report.payoutMismatches.map((row) => [row.redemptionId, row.paidDifference, row.reservedDifference, row.problem]))
      .toEqual([
        ['paid-but-held', -100, 100, 'RESERVE_STATE_MISMATCH'],
        ['held-but-paid', 100, -100, 'RESERVE_STATE_MISMATCH'],
      ]);
  });

  it('classifies each request mismatch with the reserve status the request expects', () => {
    const report = buildReconciliationReport(snapshot({
      mismatchedRequests: [
        request({ redemptionId: 'missing', requestStatus: 'APPROVED', reserveStatuses: [], ledgerIds: [], ledgerPaid: 0 }),
        request({ redemptionId: 'twice', requestStatus: 'REQUESTED', reserveStatuses: ['PENDING', 'PENDING'],
          ledgerIds: ['a', 'b'], ledgerPaid: 0, ledgerReserved: 200 }),
        request({ redemptionId: 'amount', requestStatus: 'SUCCESS', ledgerPaid: 150 }),
        request({ redemptionId: 'stale', requestStatus: 'FAILED', reserveStatuses: ['PENDING'], ledgerPaid: 0, ledgerReserved: 100 }),
      ],
    }));
    expect(report.payoutMismatches.map((row) => [row.redemptionId, row.problem, row.paidDifference, row.reservedDifference]))
      .toEqual([
        ['missing', 'RESERVE_MISSING', 0, -100],
        ['twice', 'DUPLICATE_RESERVE', 0, 100],
        ['amount', 'AMOUNT_MISMATCH', 50, 0],
        ['stale', 'RESERVE_STATE_MISMATCH', 0, 100],
      ]);
    expect(report.redeemedDiscrepancy).toBe(50);
    expect(report.reservedDiscrepancy).toBe(300);
  });

  it('classifies with the reserves that still hold or paid money, never with released legacy rows', () => {
    const report = buildReconciliationReport(snapshot({
      mismatchedRequests: [
        request({ redemptionId: 'released-then-held', requestStatus: 'SUCCESS', reserveStatuses: ['REVERSED', 'PENDING'],
          ledgerIds: ['old', 'live'], ledgerPaid: 0, ledgerReserved: 100 }),
        request({ redemptionId: 'released-only', requestStatus: 'PROCESSING', reserveStatuses: ['REVERSED'],
          ledgerIds: ['old'], ledgerPaid: 0, ledgerReserved: 0 }),
        request({ redemptionId: 'released-then-paid', requestStatus: 'SUCCESS', reserveStatuses: ['REVERSED', 'REDEEMED'],
          ledgerIds: ['old', 'live'], ledgerPaid: 150 }),
        request({ redemptionId: 'two-live', requestStatus: 'APPROVED', reserveStatuses: ['REVERSED', 'PENDING', 'PENDING'],
          ledgerIds: ['old', 'a', 'b'], ledgerPaid: 0, ledgerReserved: 200 }),
      ],
    }));
    expect(report.payoutMismatches.map((row) => [row.redemptionId, row.problem])).toEqual([
      ['released-then-held', 'RESERVE_STATE_MISMATCH'],
      ['released-only', 'RESERVE_STATE_MISMATCH'],
      ['released-then-paid', 'AMOUNT_MISMATCH'],
      ['two-live', 'DUPLICATE_RESERVE'],
    ]);
    // Every row is still listed (history stays visible) and the totals do not change.
    expect(report.payoutMismatches[0].reserveStatuses).toEqual(['REVERSED', 'PENDING']);
    expect([report.redeemedDiscrepancy, report.reservedDiscrepancy]).toEqual([150, 300]);
  });

  it('lists held or paid ledger rows that back no request, and leaves amount mismatches to the request', () => {
    const orphan = (overrides: Record<string, unknown>) => ({
      ledgerId: 'l', userId: 'u2', amount: -500, status: 'PENDING', referenceType: 'Redemption',
      referenceId: 'gone', problem: 'REQUEST_NOT_FOUND' as const, ...overrides,
    });
    const report = buildReconciliationReport(snapshot({
      reservesWithoutRequest: [
        orphan({ ledgerId: 'held' }),
        orphan({ ledgerId: 'paid', status: 'REDEEMED', referenceType: 'Manual', referenceId: null, problem: 'NOT_LINKED_TO_REDEMPTION' }),
        orphan({ ledgerId: 'released', status: 'REVERSED' }),
        orphan({ ledgerId: 'amount', problem: 'AMOUNT_MISMATCH' }),
      ],
    }));
    expect(report.payoutMismatches).toEqual([
      { redemptionId: 'gone', userId: 'u2', requestStatus: null, requestAmount: null, reserveStatuses: ['PENDING'],
        ledgerIds: ['held'], paidDifference: 0, reservedDifference: 500, problem: 'REQUEST_NOT_FOUND' },
      { redemptionId: null, userId: 'u2', requestStatus: null, requestAmount: null, reserveStatuses: ['REDEEMED'],
        ledgerIds: ['paid'], paidDifference: 500, reservedDifference: 0, problem: 'NOT_LINKED_TO_REDEMPTION' },
    ]);
    expect([report.redeemedDiscrepancy, report.reservedDiscrepancy]).toEqual([500, 500]);
  });

  it('caps the listed mismatches but keeps the totals over all of them', () => {
    const rows = Array.from({ length: MAX_LISTED_MISMATCHES + 5 }, (_, i) =>
      request({ redemptionId: `r${i}`, ledgerPaid: 0, reserveStatuses: [], ledgerIds: [] }));
    const report = buildReconciliationReport(snapshot({ mismatchedRequests: rows }));
    expect(report.payoutMismatches).toHaveLength(MAX_LISTED_MISMATCHES);
    expect(report.payoutMismatchCount).toBe(MAX_LISTED_MISMATCHES + 5);
    expect(report.redeemedDiscrepancy).toBe(100 * (MAX_LISTED_MISMATCHES + 5));
  });

  it('puts the whole available liability in the legacy bucket until B01 allocates it', () => {
    const report = buildReconciliationReport(snapshot({
      userBalances: [balance({ available: 20_000, redeemed: 40_000 })],
      organizationGroups: [
        { organizationId: 'orgA', entryType: 'EARN', status: 'AVAILABLE', amount: 30_000 },
        { organizationId: 'orgB', entryType: 'EARN', status: 'AVAILABLE', amount: 20_000 },
        { organizationId: 'orgB', entryType: 'EARN', status: 'PENDING', amount: 1_000 },
        { organizationId: 'orgB', entryType: 'ADJUST', status: 'AVAILABLE', amount: -500 },
        { organizationId: 'gone', entryType: 'EARN', status: 'AVAILABLE', amount: 10_000 },
      ],
      organizationNames: new Map([['orgA', 'Org A'], ['orgB', 'Org B']]),
    }));
    expect(report.allocationStatus).toBe('NOT_ALLOCATED_UNTIL_B01');
    expect(report.unallocatedLegacyAmount).toBe(20_000);
    expect(report.organizations.map((org) => [org.organizationName, org.earnAvailable, org.earnPending, org.adjustments,
      org.outstanding, org.allocationStatus])).toEqual([
      ['Org A', 30_000, 0, 0, 0, 'UNALLOCATED_LEGACY'],
      ['Org B', 20_000, 1_000, -500, 0, 'UNALLOCATED_LEGACY'],
      ['(organisasi dihapus)', 10_000, 0, 0, 0, 'UNALLOCATED_LEGACY'],
    ]);
    expect(report.organizations.reduce((sum, org) => sum + org.outstanding, 0) + report.unallocatedLegacyAmount)
      .toBe(report.availableLiability);
  });

  it('subtracts what an allocation source reports from the legacy bucket (B01 extension point)', () => {
    const report = buildReconciliationReport(snapshot({
      userBalances: [balance({ available: 20_000 })],
      allocations: { status: ALLOCATION_NOT_AVAILABLE, availableByOrganization: new Map([['orgA', 15_000]]) },
      organizationNames: new Map([['orgA', 'Org A']]),
    }));
    expect(report.organizations).toEqual([expect.objectContaining({ organizationId: 'orgA', outstanding: 15_000 })]);
    expect(report.unallocatedLegacyAmount).toBe(5_000);
  });

  it('reports flagged uncertain transfers and the in-flight total from the request statuses', () => {
    const report = buildReconciliationReport(snapshot({
      redemptionTotals: [
        { status: 'REQUESTED', amount: 10, flaggedCount: 0, flaggedAmount: 0 },
        { status: 'APPROVED', amount: 20, flaggedCount: 0, flaggedAmount: 0 },
        { status: 'PROCESSING', amount: 30, flaggedCount: 1, flaggedAmount: 30 },
        { status: 'FAILED', amount: 999, flaggedCount: 0, flaggedAmount: 0 },
      ],
    }));
    expect(report.redemptionInFlightTotal).toBe(60);
    expect(report.redemptionSuccessTotal).toBe(0);
    expect(report.flaggedTransfers).toEqual({ count: 1, amount: 30 });
  });
});

describe('readOrganizationAllocations (B01 extension point)', () => {
  it('allocates nothing and says so instead of faking an allocation', async () => {
    const queryRaw = vi.fn();
    const allocations = await readOrganizationAllocations({ $queryRaw: queryRaw } as any);
    expect(allocations.status).toBe('NOT_ALLOCATED_UNTIL_B01');
    expect(allocations.availableByOrganization.size).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
  });
});

describe('getReconciliationReport', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads everything in one read-only REPEATABLE READ transaction, ledger before payouts', async () => {
    const statements: string[] = [];
    const sql = (args: unknown[]) => (args[0] as TemplateStringsArray).join('?');
    const tx = {
      $executeRaw: vi.fn(async (...args: unknown[]) => { statements.push(sql(args)); return 0; }),
      $queryRaw: vi.fn(async (...args: unknown[]) => {
        const text = sql(args);
        statements.push(text);
        if (text.includes('current_setting')) return [{ readOnly: 'on', isolation: 'repeatable read' }];
        if (text.includes('GROUP BY "userId"')) {
          return [{ userId: 'u1', entryType: 'EARN', status: 'AVAILABLE', amount: 100_000n },
            { userId: 'u1', entryType: 'REDEEM', status: 'REDEEMED', amount: -40_000n }];
        }
        if (text.includes('FROM "Redemption" GROUP BY status')) {
          return [{ status: 'SUCCESS', amount: 40_000n, flaggedCount: 0, flaggedAmount: 0n }];
        }
        return [];
      }),
      organization: { findMany: vi.fn(async () => { statements.push('organizations'); return []; }) },
      user: { findMany: vi.fn(async () => []) },
      depositItem: { findMany: vi.fn(async () => []) },
      rewardReconciliationCase: {
        findMany: vi.fn(async () => []),
        aggregate: vi.fn(async () => ({ _count: { _all: 0 }, _sum: { amount: null } })),
      },
    };
    vi.mocked(prisma.$transaction).mockImplementation((async (fn: (client: unknown) => unknown, options: unknown) => {
      expect(options).toMatchObject({ isolationLevel: 'RepeatableRead' });
      return fn(tx);
    }) as any);
    const afterLedgerRead = vi.fn(async () => { statements.push('HOOK'); });

    const report = await getReconciliationReport({ afterLedgerRead });

    expect(statements[0]).toBe('SET TRANSACTION READ ONLY');
    expect(statements[1]).toContain('current_setting');
    const hook = statements.indexOf('HOOK');
    expect(statements.findIndex((s) => s.includes('GROUP BY "userId"'))).toBeLessThan(hook);
    expect(statements.findIndex((s) => s.includes('FROM "Redemption" r'))).toBeGreaterThan(hook);
    expect(report).toMatchObject({
      availableLiability: 60_000, paidTotal: 40_000, redemptionSuccessTotal: 40_000, hasDiscrepancy: false,
      snapshot: { readOnly: true, isolation: 'repeatable read' },
    });
  });
});
