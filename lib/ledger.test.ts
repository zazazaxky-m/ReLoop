import { describe, expect, it, vi, beforeEach } from 'vitest';
import { 
  computeBalance, 
  getWalletBalance, 
  createEarnEntry, 
  createRedeemReserve, 
  settleRedeemLedger,
  assertAppendOnlyPolicy,
  ledgerReasonLabel,
  getReconciliationReport,
  getLedgerHistory,
  depositItemEarnKey,
  redemptionReserveKey,
  type LedgerGroup 
} from './ledger';
import { prisma } from './prisma';

vi.mock('./prisma', () => ({
  prisma: {
    rewardLedger: { 
      groupBy: vi.fn(), 
      findFirst: vi.fn(), 
      create: vi.fn(), 
      update: vi.fn(),
      findMany: vi.fn(),
    },
    redemption: { groupBy: vi.fn() },
    organization: { findMany: vi.fn() },
    rewardReconciliationCase: {
      findMany: vi.fn(async () => []),
      aggregate: vi.fn(async () => ({ _count: { _all: 0 }, _sum: { amount: null } })),
    },
  }
}));

describe('lib/ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ledgerReasonLabel', () => {
    it('labels trash bag and deposit reasons', () => {
      expect(ledgerReasonLabel('TRASH_BAG_RETURN')).toBe('Reward trash bag');
      expect(ledgerReasonLabel('DEPOSIT_ACCEPTED')).toBe('Setoran mesin');
      expect(ledgerReasonLabel('ITEM_ACCEPTED')).toBe('Setoran mesin');
      expect(ledgerReasonLabel('ANOMALY_REVIEW')).toBe('Setoran ditinjau');
      expect(ledgerReasonLabel('TOURISM_COMPLIANCE_BONUS')).toBe('Bonus kepatuhan wisata');
      expect(ledgerReasonLabel('REDEMPTION_PROCESSING')).toBe('Pencairan');
      expect(ledgerReasonLabel('REDEMPTION_RESERVE')).toBe('Pencairan');
      expect(ledgerReasonLabel('REDEMPTION_REVERSED')).toBe('Pencairan dibatalkan');
      expect(ledgerReasonLabel('FOO_BAR')).toBe('FOO BAR');
      expect(ledgerReasonLabel(null, 'EARN')).toBe('EARN');
      expect(ledgerReasonLabel(undefined)).toBe('Transaksi');
    });
  });

  describe('computeBalance', () => {
    it('sums available and pending earn', () => {
      const groups: LedgerGroup[] = [
        { entryType: 'EARN', status: 'AVAILABLE', amount: 12500 },
        { entryType: 'EARN', status: 'PENDING', amount: 200 },
      ];
      const b = computeBalance(groups);
      expect(b.available).toBe(12500);
      expect(b.pending).toBe(200);
      expect(b.totalEarned).toBe(12700);
    });

    it('treats null amount as 0', () => {
      const b = computeBalance([
        { entryType: 'EARN', status: 'AVAILABLE', amount: null as any },
      ]);
      expect(b.available).toBe(0);
    });

    it('treats undefined amount as 0', () => {
      const b = computeBalance([
        { entryType: 'EARN', status: 'AVAILABLE', amount: undefined as any },
      ]);
      expect(b.available).toBe(0);
    });

    it('reserves available on a pending redemption', () => {
      const b = computeBalance([
        { entryType: 'EARN', status: 'AVAILABLE', amount: 12500 },
        { entryType: 'REDEEM', status: 'PENDING', amount: -10000 },
      ]);
      expect(b.available).toBe(2500);
      expect(b.reserved).toBe(10000);
      expect(b.redeemed).toBe(0);
    });

    it('counts settled redemption as redeemed and keeps available reduced', () => {
      const b = computeBalance([
        { entryType: 'EARN', status: 'AVAILABLE', amount: 12500 },
        { entryType: 'REDEEM', status: 'REDEEMED', amount: -10000 },
      ]);
      expect(b.available).toBe(2500);
      expect(b.reserved).toBe(0);
      expect(b.redeemed).toBe(10000);
    });

    it('releases reserve when redemption is reversed', () => {
      const b = computeBalance([
        { entryType: 'EARN', status: 'AVAILABLE', amount: 12500 },
        { entryType: 'REDEEM', status: 'REVERSED', amount: -10000 },
      ]);
      expect(b.available).toBe(12500);
      expect(b.reserved).toBe(0);
      expect(b.redeemed).toBe(0);
    });

    it('applies adjustments and penalties to available', () => {
      const b = computeBalance([
        { entryType: 'EARN', status: 'AVAILABLE', amount: 10000 },
        { entryType: 'PENALTY', status: 'AVAILABLE', amount: -1500 },
        { entryType: 'ADJUST', status: 'AVAILABLE', amount: 500 },
      ]);
      expect(b.available).toBe(9000);
    });

    it('never lets a pending-earn count as spendable', () => {
      const b = computeBalance([{ entryType: 'EARN', status: 'PENDING', amount: 5000 }]);
      expect(b.available).toBe(0);
      expect(b.pending).toBe(5000);
    });
  });

  describe('getWalletBalance', () => {
    it('queries and computes balance', async () => {
      vi.mocked(prisma.rewardLedger.groupBy).mockResolvedValue([
        { entryType: 'EARN', status: 'AVAILABLE', _sum: { amount: 100 } },
        { entryType: 'REDEEM', status: 'PENDING', _sum: { amount: -20 } },
      ] as any);

      const bal = await getWalletBalance('user1');
      expect(bal.available).toBe(80);
      expect(bal.reserved).toBe(20);
      expect(prisma.rewardLedger.groupBy).toHaveBeenCalledWith({
        by: ['status', 'entryType'],
        where: { userId: 'user1' },
        _sum: { amount: true },
      });
    });

    it('treats null group sum as 0', async () => {
      vi.mocked(prisma.rewardLedger.groupBy).mockResolvedValue([
        { entryType: 'EARN', status: 'AVAILABLE', _sum: { amount: null } },
      ] as any);
      const bal = await getWalletBalance('user1');
      expect(bal.available).toBe(0);
    });

    it('reads through the given transaction client instead of the global client', async () => {
      const tx = {
        rewardLedger: {
          groupBy: vi.fn().mockResolvedValue([
            { entryType: 'EARN', status: 'AVAILABLE', _sum: { amount: 500 } },
            { entryType: 'REDEEM', status: 'PENDING', _sum: { amount: -200 } },
          ]),
        },
      };
      const bal = await getWalletBalance('user1', tx as any);
      expect(bal).toMatchObject({ available: 300, reserved: 200 });
      expect(tx.rewardLedger.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user1' } }),
      );
      expect(prisma.rewardLedger.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('business keys', () => {
    it('formats one key per financial effect', () => {
      expect(redemptionReserveKey('r1')).toBe('redemption:r1:reserve');
      expect(depositItemEarnKey('di1')).toBe('deposit-item:di1:earn');
    });
  });

  describe('getLedgerHistory', () => {
    it('defaults take to 50 when options.take omitted', async () => {
      vi.mocked(prisma.rewardLedger.findMany).mockResolvedValue([]);
      await getLedgerHistory('u1', { skip: 0 });
      expect(prisma.rewardLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 50 }),
      );
    });
  });

  describe('createEarnEntry', () => {
    it('returns existing entry if already exists', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue({ id: 'existing' } as any);
      
      const res = await createEarnEntry({
        userId: 'u1',
        depositItemId: 'di1',
        amount: 100,
        status: 'AVAILABLE'
      });
      
      expect(res).toEqual({ id: 'existing' });
      expect(prisma.rewardLedger.create).not.toHaveBeenCalled();
    });

    it('creates new entry', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.rewardLedger.create).mockResolvedValue({ id: 'new' } as any);
      
      const res = await createEarnEntry({
        userId: 'u1',
        depositItemId: 'di1',
        amount: 100,
        status: 'AVAILABLE'
      });
      
      expect(res).toEqual({ id: 'new' });
      expect(prisma.rewardLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'u1',
          amount: 100,
          entryType: 'EARN',
          referenceType: 'DepositItem',
          referenceId: 'di1',
          businessKey: 'deposit-item:di1:earn',
        })
      });
    });
  });

  describe('createRedeemReserve', () => {
    it('converts positive amount to negative and creates entry', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.rewardLedger.create).mockResolvedValue({ id: 'res_1' } as any);
      
      const res = await createRedeemReserve({
        userId: 'u1',
        amount: 50,
        redemptionId: 'r1',
      });
      
      expect(res).toEqual({ id: 'res_1' });
      expect(prisma.rewardLedger.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entryType: 'REDEEM',
          amount: -50,
          status: 'PENDING',
          referenceType: 'Redemption',
          referenceId: 'r1',
          businessKey: 'redemption:r1:reserve',
        })
      });
    });
  });

  describe('settleRedeemLedger', () => {
    // Full contract: tests/lib/ledger.test.ts. Here: it only ever uses the given tx.
    it('reads and writes through the caller transaction only', async () => {
      const tx = {
        redemption: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', userId: 'u1', amount: 50 }) },
        rewardLedger: {
          findMany: vi.fn().mockResolvedValue([{ id: 'res_1', userId: 'u1', amount: -50, status: 'PENDING' }]),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      const res = await settleRedeemLedger('r1', 'failed', tx as any);
      expect(res).toMatchObject({ changed: true, entry: { id: 'res_1', status: 'REVERSED' } });
      expect(tx.rewardLedger.updateMany).toHaveBeenCalledWith({ where: { id: 'res_1', status: 'PENDING' }, data: { status: 'REVERSED' } });
      expect(prisma.rewardLedger.update).not.toHaveBeenCalled();
      expect(prisma.rewardLedger.findFirst).not.toHaveBeenCalled();
    });

    it('answers 409 instead of a no-op when the reserve was settled the other way', async () => {
      const tx = {
        redemption: { findUnique: vi.fn().mockResolvedValue({ id: 'r1', userId: 'u1', amount: 50 }) },
        rewardLedger: {
          findMany: vi.fn().mockResolvedValue([{ id: 'res_1', userId: 'u1', amount: -50, status: 'REDEEMED' }]),
          updateMany: vi.fn(),
        },
      };
      await expect(settleRedeemLedger('r1', 'failed', tx as any)).rejects.toMatchObject({ status: 409 });
      expect(tx.rewardLedger.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('assertAppendOnlyPolicy', () => {
    it('throws error', () => {
      expect(() => assertAppendOnlyPolicy('update')).toThrowError('append-only');
    });
  });

  describe('getReconciliationReport', () => {
    it('aggregates org liability and payout reconciliation with null sums', async () => {
      vi.mocked(prisma.rewardLedger.groupBy)
        .mockResolvedValueOnce([
          { organizationId: 'org1', status: 'AVAILABLE', _sum: { amount: 100 } },
          { organizationId: 'org1', status: 'PENDING', _sum: { amount: 20 } },
          { organizationId: null, status: 'AVAILABLE', _sum: { amount: null } },
          { organizationId: 'gone', status: 'AVAILABLE', _sum: { amount: 5 } },
        ] as any)
        .mockResolvedValueOnce([
          { organizationId: 'org1', status: 'AVAILABLE', _sum: { amount: -10 } },
          { organizationId: 'org1', status: 'PENDING', _sum: { amount: null } },
          { organizationId: 'org1', status: 'REDEEMED', _sum: { amount: 1 } },
        ] as any)
        .mockResolvedValueOnce([
          { status: 'REDEEMED', _sum: { amount: -50 } },
          { status: 'PENDING', _sum: { amount: null } },
          { status: 'AVAILABLE', _sum: { amount: -1 } },
        ] as any);
      vi.mocked(prisma.redemption.groupBy).mockResolvedValue([
        { status: 'SUCCESS', _sum: { amount: 40 } },
        { status: 'REQUESTED', _sum: { amount: 5 } },
        { status: 'APPROVED', _sum: { amount: null } },
        { status: 'FAILED', _sum: { amount: 9 } },
      ] as any);
      vi.mocked(prisma.organization.findMany).mockResolvedValue([
        { id: 'org1', name: 'Org One' },
      ] as any);

      const report = await getReconciliationReport();
      expect(report.organizations.some((o) => o.organizationName === 'Org One')).toBe(true);
      expect(report.organizations.some((o) => o.organizationName === 'Tanpa organisasi')).toBe(true);
      expect(report.organizations.some((o) => o.organizationName === '(organisasi dihapus)')).toBe(true);
      expect(report.ledgerRedeemed).toBe(50);
      expect(report.ledgerReserved).toBe(0);
      expect(report.redemptionSuccessTotal).toBe(40);
      expect(report.redemptionInFlightTotal).toBe(5);
      expect(report.hasDiscrepancy).toBe(true);
    });
  });
});
