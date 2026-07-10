import { describe, expect, it, vi, beforeEach } from 'vitest';
import { flagAnomaly, notifyOrgAdmins } from '@/lib/machine-events/fraud';
import { prisma } from '@/lib/prisma';
import * as notifications from '@/lib/notifications';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findMany: vi.fn() },
    notification: { createMany: vi.fn() },
  },
}));

vi.mock('@/lib/notifications', () => ({
  sendPushToUsersBestEffort: vi.fn(),
}));

const mockTx = {
  depositItem: { update: vi.fn() },
  depositSession: { findUnique: vi.fn(), update: vi.fn() },
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

    it('does not change session status if COMPLETED', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'COMPLETED' });
      await flagAnomaly(mockTx, 's1', null, 'TEST_REASON');
      expect(mockTx.depositSession.update).not.toHaveBeenCalled();
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
