import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  computeBalance,
  getWalletBalance,
  createEarnEntry,
  createRedeemReserve,
  settleRedeemLedger,
  expectedReserveStatus,
  RESERVE_MISMATCH,
  RESERVE_MISSING,
  getLedgerHistory,
  countLedgerHistory,
  assertAppendOnlyPolicy,
  getReconciliationReport,
} from '@/lib/ledger';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rewardLedger: {
      groupBy: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    redemption: {
      groupBy: vi.fn(),
    },
    organization: {
      findMany: vi.fn(),
    },
    rewardReconciliationCase: {
      findMany: vi.fn(async () => []),
      aggregate: vi.fn(async () => ({ _count: { _all: 0 }, _sum: { amount: null } })),
    },
  },
}));

describe('ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeBalance', () => {
    it('computes balance correctly', () => {
      const groups = [
        { entryType: 'EARN', status: 'AVAILABLE', amount: 100 },
        { entryType: 'EARN', status: 'PENDING', amount: 50 },
        { entryType: 'REDEEM', status: 'PENDING', amount: -20 },
        { entryType: 'REDEEM', status: 'REDEEMED', amount: -30 },
        { entryType: 'ADJUST', status: 'AVAILABLE', amount: 10 },
        { entryType: 'PENALTY', status: 'AVAILABLE', amount: -5 },
        { entryType: 'REVERSE', status: 'PENDING', amount: -15 },
        { entryType: 'REDEEM', status: 'REVERSED', amount: -50 }, // ignored
      ] as any;
      const bal = computeBalance(groups);
      // available: 100 (earn) - 20 (pending redeem) - 30 (redeemed) + 10 (adjust) - 5 (penalty) = 55
      expect(bal.available).toBe(55);
      // pending: 50 (earn) - 15 (reverse) = 35
      expect(bal.pending).toBe(35);
      // redeemed: 30
      expect(bal.redeemed).toBe(30);
      // reserved: 20
      expect(bal.reserved).toBe(20);
      // totalEarned: 100 + 50 = 150
      expect(bal.totalEarned).toBe(150);
    });
  });

  describe('getWalletBalance', () => {
    it('groups by status and entryType and computes balance', async () => {
      vi.mocked(prisma.rewardLedger.groupBy).mockResolvedValue([
        { entryType: 'EARN', status: 'AVAILABLE', _sum: { amount: 100 } },
      ] as any);
      const bal = await getWalletBalance('u1');
      expect(bal.available).toBe(100);
      expect(prisma.rewardLedger.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ by: ['status', 'entryType'], where: { userId: 'u1' } })
      );
    });
  });

  describe('createEarnEntry', () => {
    it('returns existing entry if found', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue({ id: '1' } as any);
      const res = await createEarnEntry({ userId: 'u1', depositItemId: 'd1', amount: 10, status: 'AVAILABLE' });
      expect(res.id).toBe('1');
      expect(prisma.rewardLedger.create).not.toHaveBeenCalled();
    });

    it('creates new entry if not found', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.rewardLedger.create).mockResolvedValue({ id: '2' } as any);
      const res = await createEarnEntry({ userId: 'u1', depositItemId: 'd1', amount: 10, status: 'AVAILABLE' });
      expect(res.id).toBe('2');
      expect(prisma.rewardLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ entryType: 'EARN', depositItemId: 'd1', businessKey: 'deposit-item:d1:earn' }),
      });
    });
  });

  describe('createRedeemReserve', () => {
    it('returns existing reserve if found', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue({ id: 'r1' } as any);
      const res = await createRedeemReserve({ userId: 'u1', amount: 100, redemptionId: 'red1' });
      expect(res.id).toBe('r1');
      expect(prisma.rewardLedger.create).not.toHaveBeenCalled();
    });

    it('creates new reserve if not found', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue(null);
      await createRedeemReserve({ userId: 'u1', amount: 100, redemptionId: 'red1' });
      expect(prisma.rewardLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ entryType: 'REDEEM', amount: -100, status: 'PENDING', referenceType: 'Redemption', referenceId: 'red1', businessKey: 'redemption:red1:reserve' })
        })
      );
    });

    it('writes through the transaction it is given', async () => {
      const tx = {
        rewardLedger: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'res-tx' }),
        },
      };
      const res = await createRedeemReserve({ userId: 'u1', amount: 100, redemptionId: 'red1' }, tx as any);
      expect(res).toEqual({ id: 'res-tx' });
      expect(tx.rewardLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ userId: 'u1', amount: -100, businessKey: 'redemption:red1:reserve' }),
      });
      expect(prisma.rewardLedger.create).not.toHaveBeenCalled();
    });
  });

  describe('settleRedeemLedger (strict, inside the caller transaction)', () => {
    type Row = Record<string, any>;
    function settleTx(redemption: Row | null, reserves: Row[]) {
      const tx = {
        redemption: { findUnique: vi.fn(async () => redemption) },
        rewardLedger: {
          findMany: vi.fn(async () => reserves.map((r) => ({ ...r }))),
          updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
            const row = reserves.find((r) => r.id === where.id && r.status === where.status);
            if (!row) return { count: 0 };
            row.status = data.status;
            return { count: 1 };
          }),
          findUnique: vi.fn(async ({ where }: { where: Row }) => reserves.find((r) => r.id === where.id) ?? null),
        },
      };
      return tx as any;
    }
    const request = { id: 'red1', userId: 'u1', amount: 100 };
    const reserve = (overrides: Row = {}) => ({ id: 'l1', userId: 'u1', amount: -100, status: 'PENDING', ...overrides });

    it.each([
      ['success', 'REDEEMED'],
      ['failed', 'REVERSED'],
    ] as const)('moves a PENDING reserve to the %s outcome with one conditional update', async (outcome, status) => {
      const rows = [reserve()];
      const tx = settleTx(request, rows);
      await expect(settleRedeemLedger('red1', outcome, tx)).resolves.toMatchObject({ changed: true, entry: { id: 'l1', status } });
      expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({ where: { id: 'l1', status: 'PENDING' }, data: { status } });
      expect(tx.rewardLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { entryType: 'REDEEM', referenceType: 'Redemption', referenceId: 'red1', status: { not: 'REJECTED' } } }));
      expect(rows[0].status).toBe(status);
      expect(prisma.rewardLedger.update).not.toHaveBeenCalled();
    });

    it('proves an existing matching settlement without mutating it', async () => {
      const tx = settleTx(request, [reserve({ status: 'REDEEMED' })]);
      await expect(settleRedeemLedger('red1', 'success', tx)).resolves.toMatchObject({ changed: false, entry: { status: 'REDEEMED' } });
      expect(tx.rewardLedger.updateMany).not.toHaveBeenCalled();
    });

    it('refuses the opposite outcome instead of succeeding as a no-op', async () => {
      const tx = settleTx(request, [reserve({ status: 'REVERSED' })]);
      await expect(settleRedeemLedger('red1', 'success', tx)).rejects.toMatchObject({ status: 409, message: RESERVE_MISMATCH });
      const paid = settleTx(request, [reserve({ status: 'REDEEMED' })]);
      await expect(settleRedeemLedger('red1', 'failed', paid)).rejects.toMatchObject({ status: 409 });
      expect(tx.rewardLedger.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      ['missing', [], RESERVE_MISSING],
      ['for another amount', [{ id: 'l1', userId: 'u1', amount: -90, status: 'PENDING' }], RESERVE_MISMATCH],
      ['owned by another user', [{ id: 'l1', userId: 'u2', amount: -100, status: 'PENDING' }], RESERVE_MISMATCH],
      ['duplicated', [{ id: 'l1', userId: 'u1', amount: -100, status: 'PENDING' }, { id: 'l2', userId: 'u1', amount: -100, status: 'PENDING' }], RESERVE_MISMATCH],
    ])('answers 409 when the reserve is %s', async (_label, rows, message) => {
      const tx = settleTx(request, rows as Row[]);
      await expect(settleRedeemLedger('red1', 'success', tx)).rejects.toMatchObject({ status: 409, message });
      expect(tx.rewardLedger.updateMany).not.toHaveBeenCalled();
    });

    it('answers 404 for an unknown request', async () => {
      await expect(settleRedeemLedger('nope', 'failed', settleTx(null, []))).rejects.toMatchObject({ status: 404 });
    });

    it('accepts a lost conditional update only when the row already has the outcome', async () => {
      const rows = [reserve()];
      const tx = settleTx(request, rows);
      tx.rewardLedger.updateMany = vi.fn(async () => {
        rows[0].status = 'REDEEMED'; // settled by someone else between read and update
        return { count: 0 };
      });
      await expect(settleRedeemLedger('red1', 'success', tx)).resolves.toMatchObject({ changed: false });
      rows[0].status = 'PENDING';
      tx.rewardLedger.updateMany = vi.fn(async () => {
        rows[0].status = 'REVERSED';
        return { count: 0 };
      });
      await expect(settleRedeemLedger('red1', 'success', tx)).rejects.toMatchObject({ status: 409 });
    });

    it('maps request status to the reserve status it must have', () => {
      expect(expectedReserveStatus('REQUESTED')).toBe('PENDING');
      expect(expectedReserveStatus('APPROVED')).toBe('PENDING');
      expect(expectedReserveStatus('PROCESSING')).toBe('PENDING');
      expect(expectedReserveStatus('SUCCESS')).toBe('REDEEMED');
      expect(expectedReserveStatus('FAILED')).toBe('REVERSED');
      expect(expectedReserveStatus('REVERSED')).toBe('REVERSED');
    });
  });

  describe('getLedgerHistory & countLedgerHistory', () => {
    it('fetches history and counts', async () => {
      vi.mocked(prisma.rewardLedger.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.rewardLedger.count).mockResolvedValue(5);
      
      await getLedgerHistory('u1', { skip: 10, take: 5 });
      expect(prisma.rewardLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 10, take: 5 }));
      
      const c = await countLedgerHistory('u1');
      expect(c).toBe(5);
    });
  });

  describe('assertAppendOnlyPolicy', () => {
    it('throws error', () => {
      expect(() => assertAppendOnlyPolicy('update')).toThrow(/Append-only/i);
      expect(() => assertAppendOnlyPolicy('delete')).toThrow(/Append-only/i);
    });
  });

  describe('getReconciliationReport', () => {
    it('generates report correctly', async () => {
      vi.mocked(prisma.rewardLedger.groupBy).mockImplementation((async (args: any) => {
        if (args.where.entryType === 'EARN') {
          return [
            { organizationId: 'org1', status: 'AVAILABLE', _sum: { amount: 1000 } },
            { organizationId: null, status: 'PENDING', _sum: { amount: 500 } },
          ] as any;
        }
        if (args.where.entryType?.in) {
          return [
            { organizationId: 'org1', status: 'AVAILABLE', _sum: { amount: -100 } },
          ] as any;
        }
        if (args.where.entryType === 'REDEEM') {
          return [
            { status: 'REDEEMED', _sum: { amount: -200 } },
            { status: 'PENDING', _sum: { amount: -50 } },
          ] as any;
        }
        return [];
      }) as any);

      vi.mocked(prisma.redemption.groupBy).mockResolvedValue([
        { status: 'SUCCESS', _sum: { amount: 200 } },
        { status: 'REQUESTED', _sum: { amount: 50 } },
      ] as any);

      vi.mocked(prisma.organization.findMany).mockResolvedValue([
        { id: 'org1', name: 'Org 1' }
      ] as any);

      const report = await getReconciliationReport();
      expect(report.totalEarnAvailable).toBe(1000);
      expect(report.totalEarnPending).toBe(500);
      expect(report.totalOutstanding).toBe(900); // 1000 + (-100)
      expect(report.ledgerRedeemed).toBe(200);
      expect(report.ledgerReserved).toBe(50);
      expect(report.redemptionSuccessTotal).toBe(200);
      expect(report.redemptionInFlightTotal).toBe(50);
      expect(report.hasDiscrepancy).toBe(false);
      expect(report.organizations).toHaveLength(2);
    });

    it('flags discrepancies and labels deleted orgs', async () => {
      vi.mocked(prisma.rewardLedger.groupBy).mockImplementation((async (args: any) => {
        if (args.where.entryType === 'EARN') {
          return [
            { organizationId: 'gone', status: 'AVAILABLE', _sum: { amount: 100 } },
            { organizationId: 'gone', status: 'PENDING', _sum: { amount: null } },
          ] as any;
        }
        if (args.where.entryType?.in) {
          return [
            { organizationId: 'gone', status: 'REDEEMED', _sum: { amount: 5 } },
            { organizationId: 'gone', status: 'PENDING', _sum: { amount: -10 } },
          ] as any;
        }
        if (args.where.entryType === 'REDEEM') {
          return [
            { status: 'REDEEMED', _sum: { amount: -300 } },
            { status: 'PENDING', _sum: { amount: -80 } },
            { status: 'REVERSED', _sum: { amount: -10 } },
          ] as any;
        }
        return [];
      }) as any);
      vi.mocked(prisma.redemption.groupBy).mockResolvedValue([
        { status: 'SUCCESS', _sum: { amount: 250 } },
        { status: 'APPROVED', _sum: { amount: 40 } },
        { status: 'FAILED', _sum: { amount: 999 } },
      ] as any);
      vi.mocked(prisma.organization.findMany).mockResolvedValue([] as any);

      const report = await getReconciliationReport();
      expect(report.organizations[0].organizationName).toBe('(organisasi dihapus)');
      expect(report.ledgerRedeemed).toBe(300);
      expect(report.ledgerReserved).toBe(80);
      expect(report.redemptionSuccessTotal).toBe(250);
      expect(report.redemptionInFlightTotal).toBe(40);
      expect(report.redeemedDiscrepancy).toBe(50);
      expect(report.reservedDiscrepancy).toBe(40);
      expect(report.hasDiscrepancy).toBe(true);
    });
  });

  describe('ledgerReasonLabel coverage', () => {
    it('covers known reason codes and fallbacks', async () => {
      const { ledgerReasonLabel } = await import('@/lib/ledger');
      expect(ledgerReasonLabel('ITEM_ACCEPTED')).toBe('Setoran mesin');
      expect(ledgerReasonLabel('ANOMALY_REVIEW')).toBe('Setoran ditinjau');
      expect(ledgerReasonLabel('TOURISM_COMPLIANCE_BONUS')).toBe('Bonus kepatuhan wisata');
      expect(ledgerReasonLabel('REDEMPTION_SUCCESS')).toBe('Pencairan');
      expect(ledgerReasonLabel('REDEMPTION_REVERSED')).toBe('Pencairan dibatalkan');
      expect(ledgerReasonLabel('CUSTOM_CODE')).toBe('CUSTOM CODE');
      expect(ledgerReasonLabel(undefined)).toBe('Transaksi');
    });
  });
});
