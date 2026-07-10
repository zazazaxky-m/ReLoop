import { describe, expect, it, vi, beforeEach } from 'vitest';
import { resolveOrCreateUnknownWasteType, resolveFraudDepositItemId, resolveDepositItemId } from '@/lib/machine-events/item';
import { UNKNOWN_WASTE_TYPE_NAME } from '@/lib/machine-events/shared';
import { createDepositItemCache } from '@/lib/machine-events/item-cache';

const mockTx = {
  wasteType: { findFirst: vi.fn(), create: vi.fn() },
  depositItem: { findFirst: vi.fn() },
} as any;

describe('machine-events item utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveOrCreateUnknownWasteType', () => {
    it('returns existing unknown waste type if found', async () => {
      mockTx.wasteType.findFirst.mockResolvedValue({ id: 'wt1' });
      const id = await resolveOrCreateUnknownWasteType(mockTx);
      expect(id).toBe('wt1');
      expect(mockTx.wasteType.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { name: UNKNOWN_WASTE_TYPE_NAME, organizationId: null } })
      );
      expect(mockTx.wasteType.create).not.toHaveBeenCalled();
    });

    it('creates unknown waste type if not found', async () => {
      mockTx.wasteType.findFirst.mockResolvedValue(null);
      mockTx.wasteType.create.mockResolvedValue({ id: 'wt2' });
      const id = await resolveOrCreateUnknownWasteType(mockTx);
      expect(id).toBe('wt2');
      expect(mockTx.wasteType.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: UNKNOWN_WASTE_TYPE_NAME, active: false }) })
      );
    });
  });

  describe('resolveFraudDepositItemId', () => {
    it('returns input.depositItemId if provided', async () => {
      const id = await resolveFraudDepositItemId(mockTx, { depositItemId: 'd1' } as any);
      expect(id).toBe('d1');
    });

    it('returns null if no depositItemId and no sessionId', async () => {
      const id = await resolveFraudDepositItemId(mockTx, {} as any);
      expect(id).toBeNull();
    });

    it('queries most recent item for sessionId', async () => {
      mockTx.depositItem.findFirst.mockResolvedValue({ id: 'd2' });
      const id = await resolveFraudDepositItemId(mockTx, { sessionId: 's1' } as any);
      expect(id).toBe('d2');
      expect(mockTx.depositItem.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sessionId: 's1' }, orderBy: { createdAt: 'desc' } })
      );
    });

    it('returns null when session has no deposit items', async () => {
      mockTx.depositItem.findFirst.mockResolvedValue(null);
      const id = await resolveFraudDepositItemId(mockTx, { sessionId: 's1' } as any);
      expect(id).toBeNull();
    });
  });

  describe('resolveDepositItemId', () => {
    it('returns input.depositItemId if provided and sets cache', async () => {
      const cache = createDepositItemCache();
      const id = await resolveDepositItemId(mockTx, { sessionId: 's1', depositItemId: 'd1' } as any, cache);
      expect(id).toBe('d1');
      expect(cache.get('s1')).toBe('d1');
    });

    it('returns depositItemId without caching when sessionId is missing', async () => {
      const id = await resolveDepositItemId(mockTx, { depositItemId: 'd9' } as any);
      expect(id).toBe('d9');
    });

    it('returns null when neither depositItemId nor sessionId is provided', async () => {
      const id = await resolveDepositItemId(mockTx, {} as any);
      expect(id).toBeNull();
    });

    it('returns from cache if hit', async () => {
      const cache = createDepositItemCache();
      cache.set('s1', 'd2');
      const id = await resolveDepositItemId(mockTx, { sessionId: 's1' } as any, cache);
      expect(id).toBe('d2');
      expect(mockTx.depositItem.findFirst).not.toHaveBeenCalled();
    });

    it('queries most recent PENDING/REVIEW item and sets cache', async () => {
      mockTx.depositItem.findFirst.mockResolvedValue({ id: 'd3' });
      const cache = createDepositItemCache();
      const id = await resolveDepositItemId(mockTx, { sessionId: 's1' } as any, cache);
      expect(id).toBe('d3');
      expect(cache.get('s1')).toBe('d3');
      expect(mockTx.depositItem.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: 's1', status: { in: ['PENDING', 'REVIEW'] } }
        })
      );
    });

    it('caches null if no item found', async () => {
      mockTx.depositItem.findFirst.mockResolvedValue(null);
      const cache = createDepositItemCache();
      const id = await resolveDepositItemId(mockTx, { sessionId: 's1' } as any, cache);
      expect(id).toBeNull();
      expect(cache.get('s1')).toBeNull(); // It sets it internally
    });
  });
});
