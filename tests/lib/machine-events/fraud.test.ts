import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flagAnomaly, fraudHoldKey, holdItemForFraud, notifyOrgAdmins } from '@/lib/machine-events/fraud';
import { prisma } from '@/lib/prisma';
import * as notifications from '@/lib/notifications';
import * as locks from '@/lib/db-locks';
import * as ledger from '@/lib/ledger';
import * as credit from '@/lib/reward-credit';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: vi.fn() },
    notification: { createMany: vi.fn() },
  },
}));

vi.mock('@/lib/notifications', () => ({
  sendPushToUsersBestEffort: vi.fn(),
}));
vi.mock('@/lib/db-locks', () => ({
  lockUser: vi.fn(),
  lockDepositSession: vi.fn(),
  lockDepositItem: vi.fn(),
}));
vi.mock('@/lib/ledger', () => ({ getWalletBalance: vi.fn() }));
vi.mock('@/lib/reward-credit', () => ({
  CASE_ALREADY_PAID_OUT: 'ANOMALY_ALREADY_PAID_OUT',
  openRewardReconciliationCase: vi.fn(async () => ({ id: 'case1' })),
}));

const mockTx = {
  depositItem: { update: vi.fn(), findUnique: vi.fn() },
  depositSession: { findUnique: vi.fn(), update: vi.fn() },
  rewardLedger: { findMany: vi.fn(), updateMany: vi.fn() },
} as any;

describe('fraud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('flagAnomaly', () => {
    it('updates deposit item if ID is provided', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue(null);
      await flagAnomaly(mockTx, 's1', 'd1', 'TEST_REASON');
      expect(mockTx.depositItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'd1' }, data: { status: 'REVIEW', validationReasonCode: 'TEST_REASON' } })
      );
    });

    it('updates session status to REVIEW if ACTIVE', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE' });
      await flagAnomaly(mockTx, 's1', null, 'TEST_REASON');
      expect(mockTx.depositSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'REVIEW', anomalyCount: { increment: 1 } } })
      );
    });

    it('keeps existing non-active status while incrementing anomalyCount', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'REVIEW' });
      await flagAnomaly(mockTx, 's1', null, 'TEST_REASON');
      expect(mockTx.depositSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'REVIEW', anomalyCount: { increment: 1 } },
        }),
      );
    });

    it('writes the session before the item (DepositSession -> DepositItem)', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE' });
      await flagAnomaly(mockTx, 's1', 'd1', 'TEST_REASON');
      expect(mockTx.depositSession.update.mock.invocationCallOrder[0])
        .toBeLessThan(mockTx.depositItem.update.mock.invocationCallOrder[0]);
    });

    it('does not change session status if COMPLETED', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'COMPLETED' });
      await flagAnomaly(mockTx, 's1', null, 'TEST_REASON');
      expect(mockTx.depositSession.update).not.toHaveBeenCalled();
    });
  });

  describe('holdItemForFraud (M04)', () => {
    const ref = { sessionId: 's1', session: { userId: 'u1' } };
    beforeEach(() => {
      mockTx.depositItem.findUnique.mockResolvedValueOnce(ref).mockResolvedValueOnce({ validationReasonCode: 'ACCEPTED' });
      mockTx.rewardLedger.findMany.mockResolvedValue([{ id: 'e1', amount: 100 }]);
      mockTx.rewardLedger.updateMany.mockResolvedValue({ count: 1 });
      vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 100 } as any);
    });

    it('locks User -> DepositSession -> DepositItem before re-reading, then holds the earning while the balance covers it', async () => {
      const result = await holdItemForFraud(mockTx, 'd1', 'STRING_PULL');
      const order = [locks.lockUser, locks.lockDepositSession, locks.lockDepositItem]
        .map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]);
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(locks.lockUser).toHaveBeenCalledWith(mockTx, 'u1');
      expect(mockTx.depositItem.findUnique.mock.invocationCallOrder[1]).toBeGreaterThan(order[2]);
      expect(mockTx.depositItem.update).toHaveBeenCalledWith({ where: { id: 'd1' },
        data: { status: 'REVIEW', externalFraudFlag: true, validationReasonCode: 'STRING_PULL' } });
      expect(mockTx.rewardLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { depositItemId: 'd1', userId: 'u1', entryType: 'EARN', status: 'AVAILABLE' } }));
      expect(ledger.getWalletBalance).toHaveBeenCalledWith('u1', mockTx);
      expect(mockTx.rewardLedger.updateMany).toHaveBeenCalledWith({ where: { id: 'e1', status: 'AVAILABLE' }, data: { status: 'PENDING' } });
      expect(credit.openRewardReconciliationCase).not.toHaveBeenCalled();
      expect(result).toEqual({ sessionId: 's1', reviewFinal: false, heldAmount: 100, reconciliationCaseId: null });
    });

    it('opens a reconciliation case instead of pushing the balance below zero', async () => {
      vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 99 } as any);
      const result = await holdItemForFraud(mockTx, 'd1', 'STRING_PULL');
      expect(mockTx.rewardLedger.updateMany).not.toHaveBeenCalled();
      expect(credit.openRewardReconciliationCase).toHaveBeenCalledWith(mockTx, expect.objectContaining({
        businessKey: fraudHoldKey('d1'), userId: 'u1', amount: 100, reasonCode: 'ANOMALY_ALREADY_PAID_OUT', depositItemId: 'd1' }));
      expect(result).toMatchObject({ heldAmount: 0, reconciliationCaseId: 'case1' });
      expect(fraudHoldKey('d1')).toBe('fraud:d1:hold:v1');
    });

    it("keeps a reviewer's final decision and only records the fraud flag", async () => {
      mockTx.depositItem.findUnique.mockReset();
      mockTx.depositItem.findUnique.mockResolvedValueOnce(ref).mockResolvedValueOnce({ validationReasonCode: 'REVIEW_APPROVED' });
      const result = await holdItemForFraud(mockTx, 'd1', 'STRING_PULL');
      expect(mockTx.depositItem.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { externalFraudFlag: true } });
      expect(mockTx.rewardLedger.findMany).not.toHaveBeenCalled();
      expect(result).toMatchObject({ reviewFinal: true, heldAmount: 0 });
    });

    it('does nothing for an unknown item', async () => {
      mockTx.depositItem.findUnique.mockReset();
      mockTx.depositItem.findUnique.mockResolvedValue(null);
      expect(await holdItemForFraud(mockTx, 'missing', 'X')).toBeNull();
      expect(locks.lockUser).not.toHaveBeenCalled();
    });
  });

  describe('notifyOrgAdmins', () => {
    it('creates notifications and sends push to admins', async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'a1' }, { id: 'a2' }] as any);
      
      await notifyOrgAdmins('org1', { type: 'MACHINE_FRAUD', title: 'Title', body: 'Body' });
      
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org1', role: 'ADMIN', status: 'ACTIVE' } }));
      expect(prisma.notification.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: [
            { userId: 'a1', type: 'MACHINE_FRAUD', title: 'Title', body: 'Body', dataJson: undefined },
            { userId: 'a2', type: 'MACHINE_FRAUD', title: 'Title', body: 'Body', dataJson: undefined },
          ]
        })
      );
      expect(notifications.sendPushToUsersBestEffort).toHaveBeenCalledWith(['a1', 'a2'], 'Title', 'Body', undefined);
    });

    it('does nothing if no admins found', async () => {
      vi.mocked(prisma.user.findMany).mockResolvedValue([]);
      
      await notifyOrgAdmins('org1', { type: 'MACHINE_FRAUD', title: 'Title', body: 'Body' });
      
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
      expect(notifications.sendPushToUsersBestEffort).not.toHaveBeenCalled();
    });

    it('swallows errors gracefully', async () => {
      vi.mocked(prisma.user.findMany).mockRejectedValue(new Error('DB error'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      await notifyOrgAdmins('org1', { type: 'MACHINE_FRAUD', title: 'Title', body: 'Body' });
      
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });
});
