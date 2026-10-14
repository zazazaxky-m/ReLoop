import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as me from './machine-events';
import { prisma } from './prisma';

vi.mock('./prisma', () => {
  const mockTx = {
    machineEvent: { create: vi.fn(), update: vi.fn() },
    machine: { update: vi.fn() },
    depositSession: { findUnique: vi.fn(), update: vi.fn() },
    depositItem: { create: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    wasteType: { findFirst: vi.fn(), create: vi.fn() },
    machineWasteType: { findFirst: vi.fn() },
    pickupRequest: { findFirst: vi.fn(), create: vi.fn() },
    rewardLedger: { updateMany: vi.fn() },
    // R03: ITEM_DETECTED locks the session row before re-reading it.
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'sess1' }]),
  };
  return {
    prisma: {
      machine: { findUnique: vi.fn() },
      machineEvent: { findUnique: vi.fn() },
      depositSession: { findFirst: vi.fn() },
      depositItem: { findFirst: vi.fn() },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      notification: { createMany: vi.fn() },
      deviceToken: { findMany: vi.fn().mockResolvedValue([]) },
      $transaction: vi.fn().mockImplementation((cb) => cb(mockTx)),
    },
    mockTx,
  };
});

vi.mock('./notifications', () => ({
  sendPushToUsersBestEffort: vi.fn(),
}));

describe('lib/machine-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ingestMachineEvent', () => {
    it('throws error if machine not found', async () => {
      vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
      await expect(me.ingestMachineEvent({ machineCode: 'UNKNOWN', localEventId: '1', eventType: 'HEARTBEAT' })).rejects.toThrow('Mesin tidak ditemukan');
    });

    it('returns duplicate if event already exists', async () => {
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1' } as any);
      vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue({ id: 'evt_old' } as any);
      
      const res = await me.ingestMachineEvent({ machineCode: 'm1', localEventId: '1', eventType: 'HEARTBEAT' });
      expect(res.duplicate).toBe(true);
      expect(res.eventId).toBe('evt_old');
    });

    it('processes HEARTBEAT event correctly', async () => {
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'o1' } as any);
      vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue(null);
      
      const { mockTx } = await import('./prisma') as any;
      mockTx.machineEvent.create.mockResolvedValue({ id: 'evt_new' });
      mockTx.pickupRequest.findFirst.mockResolvedValue(null);
      
      const res = await me.ingestMachineEvent({ 
        machineCode: 'm1', 
        localEventId: '1', 
        eventType: 'HEARTBEAT',
        payload: { status: 'ONLINE', fillLevelPercent: 50 }
      });
      
      expect(res.duplicate).toBe(false);
      expect(res.eventId).toBe('evt_new');
      expect(mockTx.machine.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: expect.objectContaining({ status: 'ONLINE', fillLevelPercent: 50 })
      });
    });

    it('creates auto pickup and notifies org admins if machine is FULL during heartbeat', async () => {
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'o1' } as any);
      vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.user.findMany).mockResolvedValue([{ id: 'admin_1' }] as any);
      
      const { mockTx } = await import('./prisma') as any;
      mockTx.machineEvent.create.mockResolvedValue({ id: 'evt_new' });
      mockTx.pickupRequest.findFirst.mockResolvedValue(null); // No open pickup yet
      
      await me.ingestMachineEvent({ 
        machineCode: 'm1', 
        localEventId: '2', 
        eventType: 'HEARTBEAT',
        payload: { status: 'FULL' }
      });
      
      expect(mockTx.pickupRequest.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ machineId: 'm1', reason: 'FULL' })
      }));
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ organizationId: 'o1', role: 'ADMIN' }),
      }));
      expect(prisma.notification.createMany).toHaveBeenCalledWith(expect.objectContaining({
        data: [expect.objectContaining({
          userId: 'admin_1',
          type: 'MACHINE_FULL',
        })],
      }));
    });
  });

  describe('ITEM_DETECTED waste type resolution', () => {
    it('creates a MACHINE-sourced PENDING item when the kiosk-selected wasteTypeId is linked to the machine', async () => {
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'o1', sessionIdleTimeoutMinutes: 3 } as any);
      vi.mocked(prisma.depositSession.findFirst).mockResolvedValue({ id: 'sess1' } as any);

      const { mockTx } = await import('./prisma') as any;
      mockTx.machineEvent.create.mockResolvedValue({ id: 'evt_new' });
      mockTx.depositSession.findUnique.mockResolvedValue({ id: 'sess1', status: 'ACTIVE', startedAt: new Date() });
      mockTx.machineWasteType.findFirst.mockResolvedValue({ id: 'link1' });
      mockTx.depositItem.create.mockResolvedValue({ id: 'item1' });

      await me.ingestMachineEvent({
        machineCode: 'm1',
        localEventId: '3',
        eventType: 'ITEM_DETECTED',
        sessionId: 'sess1',
        payload: { wasteTypeId: 'wt-bottle' },
      });

      expect(mockTx.machineWasteType.findFirst).toHaveBeenCalledWith({
        where: { machineId: 'm1', wasteTypeId: 'wt-bottle', active: true },
        select: { id: true },
      });
      expect(mockTx.depositItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          wasteTypeId: 'wt-bottle',
          source: 'MACHINE',
          status: 'PENDING',
        }),
      });
    });

    it('falls back to the shared unknown WasteType and marks the item REVIEW when no waste type hint resolves', async () => {
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'o1', sessionIdleTimeoutMinutes: 3 } as any);
      vi.mocked(prisma.depositSession.findFirst).mockResolvedValue({ id: 'sess1' } as any);

      const { mockTx } = await import('./prisma') as any;
      mockTx.machineEvent.create.mockResolvedValue({ id: 'evt_new' });
      mockTx.depositSession.findUnique.mockResolvedValue({ id: 'sess1', status: 'ACTIVE', startedAt: new Date() });
      mockTx.wasteType.findFirst.mockResolvedValue(null);
      mockTx.wasteType.create.mockResolvedValue({ id: 'wt-unknown' });
      mockTx.depositItem.create.mockResolvedValue({ id: 'item1' });

      await me.ingestMachineEvent({
        machineCode: 'm1',
        localEventId: '4',
        eventType: 'ITEM_DETECTED',
        sessionId: 'sess1',
        payload: { inputBeam: true },
      });

      expect(mockTx.wasteType.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ name: me.UNKNOWN_WASTE_TYPE_NAME, active: false }),
      }));
      expect(mockTx.depositItem.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          wasteTypeId: 'wt-unknown',
          source: 'PYTHON_SIMULATOR',
          status: 'REVIEW',
          validationReasonCode: me.UNKNOWN_WASTE_TYPE_REASON,
        }),
      });
    });
  });
});
