import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  validateWeight,
  resolveRewardRate,
  computeRewardAmount,
  computeWeightBasedRewardAmount,
} from '@/lib/reward';
import { verifyMaterial } from '@/lib/reward-policy';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rewardRate: { findMany: vi.fn() },
  },
}));

describe('reward', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateWeight', () => {
    it('returns WEIGHT_MISSING if null', () => {
      expect(validateWeight(null, 10, 100)).toEqual({ valid: false, reasonCode: 'WEIGHT_MISSING' });
    });
    
    it('returns WEIGHT_BELOW_MIN if under min', () => {
      expect(validateWeight(5, 10, 100)).toEqual({ valid: false, reasonCode: 'WEIGHT_BELOW_MIN' });
    });

    it('returns WEIGHT_ABOVE_MAX if over max', () => {
      expect(validateWeight(105, 10, 100)).toEqual({ valid: false, reasonCode: 'WEIGHT_ABOVE_MAX' });
    });

    it('returns valid if within bounds', () => {
      expect(validateWeight(50, 10, 100)).toEqual({ valid: true });
    });
    
    it('returns valid if no bounds', () => {
      expect(validateWeight(50, null, null)).toEqual({ valid: true });
    });
  });

  describe('resolveRewardRate', () => {
    it('returns null if no candidates', async () => {
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([]);
      const rate = await resolveRewardRate({ organizationId: 'o1', wasteTypeId: 'w1' });
      expect(rate).toBeNull();
    });

    it('sorts candidates by priority (campaign > org > global)', async () => {
      const now = new Date();
      const globalRate = { id: 'r1', organizationId: null, campaignId: null, effectiveFrom: new Date(now.getTime() - 1000) };
      const orgRate = { id: 'r2', organizationId: 'o1', campaignId: null, effectiveFrom: new Date(now.getTime() - 1000) };
      const campRate = { id: 'r3', organizationId: 'o1', campaignId: 'c1', effectiveFrom: new Date(now.getTime() - 1000) };

      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([globalRate, orgRate, campRate] as any);

      const rate = await resolveRewardRate({ organizationId: 'o1', campaignId: 'c1', wasteTypeId: 'w1' });
      expect(rate?.id).toBe('r3');
    });

    it('sorts by effectiveFrom if priorities are equal', async () => {
      const now = new Date();
      const orgRate1 = { id: 'r1', organizationId: 'o1', campaignId: null, effectiveFrom: new Date(now.getTime() - 1000) };
      const orgRate2 = { id: 'r2', organizationId: 'o1', campaignId: null, effectiveFrom: new Date(now.getTime() - 2000) };

      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([orgRate2, orgRate1] as any); // returned out of order

      const rate = await resolveRewardRate({ organizationId: 'o1', wasteTypeId: 'w1' });
      expect(rate?.id).toBe('r1'); // most recent
    });

    it('handles unexpected ratePriority fallback (99)', async () => {
      // Create a rate that doesn't match campaignId, orgId, or global (impossible via DB filter, but good for coverage)
      const weirdRate = { id: 'r1', organizationId: 'different', campaignId: 'different', effectiveFrom: new Date() };
      const globalRate = { id: 'r2', organizationId: null, campaignId: null, effectiveFrom: new Date() };
      
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([weirdRate, globalRate] as any);
      
      const rate = await resolveRewardRate({ organizationId: 'o1', wasteTypeId: 'w1' });
      expect(rate?.id).toBe('r2'); // global rate wins because weirdRate gets priority 99
    });
  });

  describe('computeRewardAmount', () => {
    it('computes simple points per item', () => {
      expect(computeRewardAmount(100, 3)).toBe(300);
      expect(computeRewardAmount(100, 3, 1.5)).toBe(450);
      expect(computeRewardAmount(10.5, 3)).toBe(32); // rounds to nearest
    });
  });

  describe('computeWeightBasedRewardAmount', () => {
    it('computes amount based on kg flooring', () => {
      expect(computeWeightBasedRewardAmount(10000, 500)).toBe(5000); // 0.5kg * 10k = 5000
      expect(computeWeightBasedRewardAmount(10000, 550)).toBe(5500); // 0.55kg * 10k = 5500
      expect(computeWeightBasedRewardAmount(10000, 999.9)).toBe(9999); // floor
      expect(computeWeightBasedRewardAmount(10000, null)).toBe(0);
    });
  });

  describe('material verification replaces the keyword hint matcher (LOG-05)', () => {
    it('a label that merely contains a hint word is not a match unless the taxonomy lists it', () => {
      const pet = { policy: 'WEIGHT_ONLY' as const, acceptedLabels: ['bottle_pet'] };
      expect(verifyMaterial({ ...pet, aiLabel: 'botol plastik', aiConfidence: 0.9 }).typeMatch).toBe(false);
      expect(verifyMaterial({ ...pet, aiLabel: 'can_aluminium', aiConfidence: 0.9 }).typeMatch).toBe(false);
      expect(verifyMaterial({ ...pet, aiLabel: 'kertas', aiConfidence: 0.9 }).typeMatch).toBe(false);
      expect(verifyMaterial({ ...pet, aiLabel: 'bottle_pet', aiConfidence: 0.9 }).typeMatch).toBe(true);
    });
  });
});
