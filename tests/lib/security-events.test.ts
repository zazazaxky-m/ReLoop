import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getSecurityEvents, getDepositReviewQueue, getSecuritySummary } from '@/lib/security-events';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machineEvent: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    depositItem: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe('security-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getSecurityEvents', () => {
    it('queries and maps events with default take', async () => {
      vi.mocked(prisma.machineEvent.findMany).mockResolvedValue([
        {
          id: 'e1',
          eventType: 'FRAUD_DETECTED',
          occurredAt: new Date('2023-01-01'),
          receivedAt: new Date('2023-01-01'),
          payloadJson: { reason: 'test' },
          sessionId: null,
          depositItemId: 'd1',
          machine: { id: 'm1', machineCode: 'M1', name: 'Machine 1', status: 'ONLINE', organization: { id: 'org1', name: 'Org 1' } },
        },
      ] as any);

      const events = await getSecurityEvents();
      expect(events).toHaveLength(1);
      expect(events[0].eventType).toBe('FRAUD_DETECTED');
      expect(events[0].payload).toEqual({ reason: 'test' });
      expect(prisma.machineEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('maps null payloadJson to null payload', async () => {
      vi.mocked(prisma.machineEvent.findMany).mockResolvedValue([
        {
          id: 'e2',
          eventType: 'FRAUD_DETECTED',
          occurredAt: new Date(),
          receivedAt: new Date(),
          payloadJson: null,
          sessionId: null,
          depositItemId: null,
          machine: { id: 'm1', machineCode: 'M1', name: 'M', status: 'ONLINE', organization: { id: 'o1', name: 'O' } },
        },
      ] as any);

      const events = await getSecurityEvents();
      expect(events[0].payload).toBeNull();
    });

    it('applies filters for machineId and since', async () => {
      vi.mocked(prisma.machineEvent.findMany).mockResolvedValue([] as any);
      const since = new Date();
      await getSecurityEvents({ machineId: 'm1', since, take: 10 });
      expect(prisma.machineEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            machineId: 'm1',
            occurredAt: { gte: since },
          }),
          take: 10,
        }),
      );
    });
  });

  describe('getDepositReviewQueue', () => {
    it('returns paginated items and total', async () => {
      vi.mocked(prisma.depositItem.count).mockResolvedValue(50);
      vi.mocked(prisma.depositItem.findMany).mockResolvedValue([
        {
          id: 'd1',
          quantity: 1,
          measuredWeightGrams: 100,
          aiDetectedType: 'PET',
          aiConfidence: 0.9,
          validationReasonCode: 'WEIGHT_MISMATCH',
          createdAt: new Date(),
          wasteType: { id: 'w1', name: 'PET', unit: 'pcs' },
          ledgerEntries: [{ amount: 50, status: 'PENDING' }],
          session: {
            id: 's1',
            startedAt: new Date(),
            user: { id: 'u1', name: 'User 1', email: 'u@e.com' },
            machine: { id: 'm1', machineCode: 'M1', name: 'M1', organizationId: 'org1', organization: { id: 'org1', name: 'Org 1' } },
          },
        },
      ] as any);

      const result = await getDepositReviewQueue({ skip: 10, take: 20 });
      expect(result.total).toBe(50);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].pendingLedgerAmount).toBe(50);
      expect(prisma.depositItem.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 20 }),
      );
    });

    it('filters by organizationId', async () => {
      vi.mocked(prisma.depositItem.count).mockResolvedValue(0);
      vi.mocked(prisma.depositItem.findMany).mockResolvedValue([]);

      await getDepositReviewQueue({ organizationId: 'org1' });
      expect(prisma.depositItem.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            session: { machine: { organizationId: 'org1' } },
          }),
        }),
      );
    });

    it('defaults pendingLedgerAmount to 0 if no entries', async () => {
      vi.mocked(prisma.depositItem.count).mockResolvedValue(1);
      vi.mocked(prisma.depositItem.findMany).mockResolvedValue([
        { ledgerEntries: [] },
      ] as any);

      const result = await getDepositReviewQueue();
      expect(result.items[0].pendingLedgerAmount).toBe(0);
    });
  });

  describe('getSecuritySummary', () => {
    it('aggregates events for 24h and 7d', async () => {
      vi.mocked(prisma.machineEvent.count).mockImplementation((async (args: any) => {
        if (args?.where?.eventType === 'FRAUD_DETECTED') return 5;
        if (args?.where?.eventType === 'VANDALISM_DETECTED') return 2;
        return 10; // alerts24h
      }) as any);
      vi.mocked(prisma.machineEvent.findMany).mockResolvedValue([
        { machineId: 'm1' },
        { machineId: 'm2' },
      ] as any);

      const summary = await getSecuritySummary();
      expect(summary.alerts24h).toBe(10);
      expect(summary.fraud7d).toBe(5);
      expect(summary.vandalism7d).toBe(2);
      expect(summary.affectedMachines7d).toBe(2);
    });
  });
});
