import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  computeBalance,
  getWalletBalance,
  createEarnEntry,
  createRedeemReserve,
  settleRedeemLedger,
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

  describe('settleRedeemLedger', () => {
    it('returns null if no pending reserve found', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue(null);
      const res = await settleRedeemLedger('red1', 'success');
      expect(res).toBeNull();
    });

    it('updates to REDEEMED on success', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue({ id: 'ledger1' } as any);
      await settleRedeemLedger('red1', 'success');
      expect(prisma.rewardLedger.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ledger1' }, data: { status: 'REDEEMED' } })
      );
    });

    it('updates to REVERSED on failure', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue({ id: 'ledger1' } as any);
      await settleRedeemLedger('red1', 'failed');
      expect(prisma.rewardLedger.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ledger1' }, data: { status: 'REVERSED' } })
      );
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
