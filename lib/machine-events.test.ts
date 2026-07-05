import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as me from './machine-events';
import { prisma } from './prisma';

vi.mock('./prisma', () => {
  const mockTx = {
    machineEvent: { create: vi.fn(), update: vi.fn() },
    machine: { update: vi.fn() },
    depositSession: { findUnique: vi.fn(), update: vi.fn() },
    depositItem: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    wasteType: { findFirst: vi.fn() },
    pickupRequest: { findFirst: vi.fn(), create: vi.fn() },
    rewardLedger: { updateMany: vi.fn() },
  };
  return {
    prisma: {
      machine: { findUnique: vi.fn() },
      machineEvent: { findUnique: vi.fn() },
      depositSession: { findFirst: vi.fn() },
      depositItem: { findFirst: vi.fn() },
      $transaction: vi.fn().mockImplementation((cb) => cb(mockTx)),
    },
    mockTx,
  };
});

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

    it('creates auto pickup if machine is FULL during heartbeat', async () => {
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'o1' } as any);
      vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue(null);
      
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
    });
  });
});
