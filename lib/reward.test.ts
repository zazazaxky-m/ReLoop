import { describe, expect, it, vi, beforeEach } from 'vitest';
import { validateWeight, resolveRewardRate, computeRewardAmount, evaluateSensorFusion } from './reward';
import { prisma } from './prisma';

vi.mock('./prisma', () => ({
  prisma: {
    rewardRate: { findFirst: vi.fn() },
  },
}));

describe('lib/reward', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validateWeight', () => {
    it('returns missing if weight is null', () => {
      expect(validateWeight(null, 10, 20)).toEqual({ valid: false, reasonCode: 'WEIGHT_MISSING' });
    });

    it('returns below min if weight < min', () => {
      expect(validateWeight(5, 10, 20)).toEqual({ valid: false, reasonCode: 'WEIGHT_BELOW_MIN' });
    });

    it('returns above max if weight > max', () => {
      expect(validateWeight(25, 10, 20)).toEqual({ valid: false, reasonCode: 'WEIGHT_ABOVE_MAX' });
    });

    it('returns valid if weight is within bounds', () => {
      expect(validateWeight(15, 10, 20)).toEqual({ valid: true });
    });

    it('returns valid if no bounds provided', () => {
      expect(validateWeight(15, null, null)).toEqual({ valid: true });
    });
  });

  describe('resolveRewardRate', () => {
    it('resolves campaign rate if available', async () => {
      vi.mocked(prisma.rewardRate.findFirst).mockResolvedValueOnce({ id: 'camp_rate' } as any);
      const res = await resolveRewardRate({ organizationId: 'org1', campaignId: 'camp1', wasteTypeId: 'wt1' });
      expect(res?.id).toBe('camp_rate');
      expect(prisma.rewardRate.findFirst).toHaveBeenCalledTimes(1);
    });

    it('falls back to org rate if campaign rate unavailable', async () => {
      vi.mocked(prisma.rewardRate.findFirst)
        .mockResolvedValueOnce(null) // Campaign
        .mockResolvedValueOnce({ id: 'org_rate' } as any); // Org
      
      const res = await resolveRewardRate({ organizationId: 'org1', campaignId: 'camp1', wasteTypeId: 'wt1' });
      expect(res?.id).toBe('org_rate');
      expect(prisma.rewardRate.findFirst).toHaveBeenCalledTimes(2);
    });

    it('falls back to global rate if org rate unavailable', async () => {
      vi.mocked(prisma.rewardRate.findFirst)
        .mockResolvedValueOnce(null) // Campaign (if campaignId passed)
        .mockResolvedValueOnce(null) // Org
        .mockResolvedValueOnce({ id: 'global_rate' } as any); // Global
      
      const res = await resolveRewardRate({ organizationId: 'org1', campaignId: 'camp1', wasteTypeId: 'wt1' });
      expect(res?.id).toBe('global_rate');
    });
  });

  describe('computeRewardAmount', () => {
    it('computes basic multiplication', () => {
      expect(computeRewardAmount(10, 2)).toBe(20);
    });

    it('applies multiplier and rounds', () => {
      expect(computeRewardAmount(10, 2, 1.5)).toBe(30);
      expect(computeRewardAmount(10, 2, 1.25)).toBe(25);
    });
  });

  describe('evaluateSensorFusion', () => {
    it('returns invalid if weight is invalid', () => {
      const res = evaluateSensorFusion({ wasteTypeId: 'wt1', measuredWeightGrams: 5, minWeightGrams: 10 });
      expect(res.valid).toBe(false);
      expect(res.wasteTypeMatch).toBe(false);
    });

    it('returns match true if AI confidence >= 0.5 and matches hints', () => {
      const res = evaluateSensorFusion({ 
        wasteTypeId: 'wt1', 
        measuredWeightGrams: 15, 
        minWeightGrams: 10,
        aiDetectedType: 'Plastic Bottle',
        aiConfidence: 0.8
      });
      expect(res.valid).toBe(true);
      expect(res.wasteTypeMatch).toBe(true);
    });

    it('returns match false if AI confidence < 0.5', () => {
      const res = evaluateSensorFusion({ 
        wasteTypeId: 'wt1', 
        measuredWeightGrams: 15, 
        minWeightGrams: 10,
        aiDetectedType: 'Plastic Bottle',
        aiConfidence: 0.4
      });
      expect(res.valid).toBe(true);
      expect(res.wasteTypeMatch).toBe(false);
    });

    it('returns match false if AI detected type not in hints', () => {
      const res = evaluateSensorFusion({ 
        wasteTypeId: 'wt1', 
        measuredWeightGrams: 15, 
        minWeightGrams: 10,
        aiDetectedType: 'Paper Box',
        aiConfidence: 0.9
      });
      expect(res.valid).toBe(true);
      expect(res.wasteTypeMatch).toBe(false);
    });
  });
});
