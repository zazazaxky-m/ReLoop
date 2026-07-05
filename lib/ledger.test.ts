import { describe, expect, it, vi, beforeEach } from 'vitest';
import { 
  computeBalance, 
  getWalletBalance, 
  createEarnEntry, 
  createRedeemReserve, 
  settleRedeemLedger,
  assertAppendOnlyPolicy,
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
    }
  }
}));

describe('lib/ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        })
      });
    });
  });

  describe('settleRedeemLedger', () => {
    it('returns null if entry not found (or already settled)', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue(null);
      const res = await settleRedeemLedger('r1', 'success');
      expect(res).toBeNull();
      expect(prisma.rewardLedger.update).not.toHaveBeenCalled();
    });

    it('updates status to REDEEMED on success', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue({ id: 'res_1' } as any);
      vi.mocked(prisma.rewardLedger.update).mockResolvedValue({ id: 'res_1', status: 'REDEEMED' } as any);
      
      const res = await settleRedeemLedger('r1', 'success');
      
      expect(res).toEqual({ id: 'res_1', status: 'REDEEMED' });
      expect(prisma.rewardLedger.update).toHaveBeenCalledWith({
        where: { id: 'res_1' },
        data: { status: 'REDEEMED' }
      });
    });

    it('updates status to REVERSED on failure', async () => {
      vi.mocked(prisma.rewardLedger.findFirst).mockResolvedValue({ id: 'res_1' } as any);
      vi.mocked(prisma.rewardLedger.update).mockResolvedValue({ id: 'res_1', status: 'REVERSED' } as any);
      
      const res = await settleRedeemLedger('r1', 'failed');
      
      expect(res).toEqual({ id: 'res_1', status: 'REVERSED' });
      expect(prisma.rewardLedger.update).toHaveBeenCalledWith({
        where: { id: 'res_1' },
        data: { status: 'REVERSED' }
      });
    });
  });

  describe('assertAppendOnlyPolicy', () => {
    it('throws error', () => {
      expect(() => assertAppendOnlyPolicy('update')).toThrowError('append-only');
    });
  });
});
