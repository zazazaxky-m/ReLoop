import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  validateWeight,
  rateWindowContains,
  resolveRewardRate,
  resolveRewardRateAt,
  computeRewardAmount,
  computeWeightBasedRewardAmount,
} from './reward';
import {
  campaignSupportsMachine,
  decideReward,
  machineRewardMode,
  normalizeAiLabel,
  tripRewardMode,
  verifyMaterial,
} from './reward-policy';
import { prisma } from './prisma';

vi.mock('./prisma', () => ({
  prisma: {
    rewardRate: { findMany: vi.fn() },
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
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([
        { id: 'camp_rate', campaignId: 'camp1', organizationId: null, effectiveFrom: new Date() },
      ] as any);
      const res = await resolveRewardRate({ organizationId: 'org1', campaignId: 'camp1', wasteTypeId: 'wt1' });
      expect(res?.id).toBe('camp_rate');
      expect(prisma.rewardRate.findMany).toHaveBeenCalledTimes(1);
    });

    it('falls back to org rate if campaign rate unavailable', async () => {
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([
        { id: 'org_rate', campaignId: null, organizationId: 'org1', effectiveFrom: new Date() },
      ] as any);

      const res = await resolveRewardRate({ organizationId: 'org1', campaignId: 'camp1', wasteTypeId: 'wt1' });
      expect(res?.id).toBe('org_rate');
    });

    it('falls back to global rate if org rate unavailable', async () => {
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([
        { id: 'global_rate', campaignId: null, organizationId: null, effectiveFrom: new Date() },
      ] as any);

      const res = await resolveRewardRate({ organizationId: 'org1', campaignId: 'camp1', wasteTypeId: 'wt1' });
      expect(res?.id).toBe('global_rate');
    });

    it('prefers campaign over org when multiple candidates are returned', async () => {
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([
        { id: 'org_rate', campaignId: null, organizationId: 'org1', effectiveFrom: new Date('2024-01-02') },
        { id: 'camp_rate', campaignId: 'camp1', organizationId: null, effectiveFrom: new Date('2024-01-01') },
      ] as any);

      const res = await resolveRewardRate({ organizationId: 'org1', campaignId: 'camp1', wasteTypeId: 'wt1' });
      expect(res?.id).toBe('camp_rate');
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

  describe('computeWeightBasedRewardAmount', () => {
    it('pays proportionally to measured weight, not a flat per-item amount', () => {
      expect(computeWeightBasedRewardAmount(2000, 250)).toBe(500);
      expect(computeWeightBasedRewardAmount(2000, 900)).toBe(1800);
    });

    it('floors partial-kilogram remainders instead of rounding up', () => {
      expect(computeWeightBasedRewardAmount(1500, 333)).toBe(499);
    });

    it('applies the campaign multiplier after the weight-based amount', () => {
      expect(computeWeightBasedRewardAmount(2000, 500, 1.5)).toBe(1500);
    });

    it('treats a missing measured weight as zero reward', () => {
      expect(computeWeightBasedRewardAmount(2000, null)).toBe(0);
      expect(computeWeightBasedRewardAmount(2000, undefined)).toBe(0);
    });
  });

  describe('resolveRewardRate window (EX-03)', () => {
    it('keeps the effectiveTo window: the scope OR is AND-ed, never spread over it', async () => {
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([] as any);
      const now = new Date('2026-11-01T00:00:00.000Z');
      await resolveRewardRate({ organizationId: 'org1', campaignId: 'camp1', wasteTypeId: 'wt1', now });
      const where = vi.mocked(prisma.rewardRate.findMany).mock.calls[0][0]!.where as any;
      expect(Object.keys(where).sort()).toEqual(['AND', 'wasteTypeId']);
      expect(where.wasteTypeId).toBe('wt1');
      expect(where.AND).toEqual([
        {
          active: true,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
        {
          OR: [
            { campaignId: 'camp1' },
            { organizationId: 'org1', campaignId: null },
            { organizationId: null, campaignId: null },
          ],
        },
      ]);
    });

    it('rateWindowContains is the half-open [effectiveFrom, effectiveTo) test and ignores `active` (M04 fix round 4, N1)', () => {
      const from = new Date('2026-10-01T00:00:00.000Z');
      const to = new Date('2026-11-01T00:00:00.000Z');
      const at = (iso: string) => new Date(iso);
      expect(rateWindowContains({ effectiveFrom: from, effectiveTo: to }, at('2026-09-30T23:59:59.999Z'))).toBe(false);
      expect(rateWindowContains({ effectiveFrom: from, effectiveTo: to }, from)).toBe(true);
      expect(rateWindowContains({ effectiveFrom: from, effectiveTo: to }, at('2026-10-15T12:00:00.000Z'))).toBe(true);
      expect(rateWindowContains({ effectiveFrom: from, effectiveTo: to }, at('2026-10-31T23:59:59.999Z'))).toBe(true);
      expect(rateWindowContains({ effectiveFrom: from, effectiveTo: to }, to)).toBe(false);
      expect(rateWindowContains({ effectiveFrom: from, effectiveTo: null }, at('2030-01-01T00:00:00.000Z'))).toBe(true);
      // A deactivated rate still covered the acceptance instant: the recorded price stands (R2).
      expect(rateWindowContains({ effectiveFrom: from, effectiveTo: null, active: false }, at('2026-10-15T00:00:00.000Z'))).toBe(true);
    });

    it('drops candidates outside the half-open window even if a mocked query returns them', async () => {
      const now = new Date('2026-11-01T00:00:00.000Z');
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([
        { id: 'expired', campaignId: 'camp1', organizationId: null, active: true,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: now },
        { id: 'org', campaignId: null, organizationId: 'org1', active: true,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null },
      ] as any);
      const res = await resolveRewardRate({ organizationId: 'org1', campaignId: 'camp1', wasteTypeId: 'wt1', now });
      expect(res?.id).toBe('org');
    });

    it('resolveRewardRateAt (historical) selects by window containment only and ignores `active` (M04 fix round 5, L3)', async () => {
      const at = new Date('2026-10-01T08:00:00.000Z');
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([] as any);
      await resolveRewardRateAt({ organizationId: 'org1', campaignId: 'camp1', wasteTypeId: 'wt1', at });
      const where = vi.mocked(prisma.rewardRate.findMany).mock.calls[0][0]!.where as any;
      expect(Object.keys(where).sort()).toEqual(['AND', 'wasteTypeId']);
      // The same half-open window as the live query, without the `active` condition.
      expect(where.AND[0]).toEqual({ effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] });
      expect(where.AND[1]).toEqual({ OR: [
        { campaignId: 'camp1' }, { organizationId: 'org1', campaignId: null }, { organizationId: null, campaignId: null },
      ] });

      // The deactivated-then-replaced pattern: the old rate covered `at`, its
      // replacement started later. Historical resolution keeps the old rate;
      // live resolution at the same instant drops it (active is required).
      const candidates = [
        { id: 'replacement', campaignId: null, organizationId: 'org1', active: true,
          effectiveFrom: new Date('2026-10-10T00:00:00.000Z'), effectiveTo: null },
        { id: 'deactivated', campaignId: null, organizationId: 'org1', active: false,
          effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), effectiveTo: null },
        { id: 'global', campaignId: null, organizationId: null, active: true,
          effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: null },
      ];
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue(candidates as any);
      expect((await resolveRewardRateAt({ organizationId: 'org1', campaignId: null, wasteTypeId: 'wt1', at }))?.id).toBe('deactivated');
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue(candidates as any);
      expect((await resolveRewardRate({ organizationId: 'org1', campaignId: null, wasteTypeId: 'wt1', now: at }))?.id).toBe('global');
      // The live query still asks the database for active rates only.
      const liveWhere = vi.mocked(prisma.rewardRate.findMany).mock.calls.at(-1)![0]!.where as any;
      expect(liveWhere.AND[0].active).toBe(true);
    });
  });

  describe('decideReward (LOG-04, LOG-05)', () => {
    it("never mints money in a compliance-only campaign",()=>{
      const decision=decideReward({mode:"COMPLIANCE_ONLY",baseAmount:2000,
        weightValid:true,typeMatch:true,hasAnomaly:false});
      expect(decision.amount).toBe(0);
    });
    it("holds AI mismatches for review",()=>{
      const decision=decideReward({mode:"MONEY_REWARD",baseAmount:2000,
        weightValid:true,typeMatch:false,hasAnomaly:false});
      expect(decision.status).toBe("REVIEW");
      expect(decision.ledgerStatus).toBe("PENDING");
    });

    const base = { baseAmount: 2001, weightValid: true, typeMatch: true, hasAnomaly: false };
    it.each([
      ['MONEY_REWARD', base, { status: 'ACCEPTED', amount: 2001, ledgerStatus: 'AVAILABLE', reason: 'ACCEPTED' }],
      ['MONEY_REWARD', { ...base, typeMatch: false }, { status: 'REVIEW', amount: 1000, ledgerStatus: 'PENDING', reason: 'TYPE_MISMATCH' }],
      ['MONEY_REWARD', { ...base, hasAnomaly: true }, { status: 'REVIEW', amount: 1000, ledgerStatus: 'PENDING', reason: 'ANOMALY_REVIEW' }],
      ['MONEY_REWARD', { ...base, hasAnomaly: true, typeMatch: false }, { status: 'REVIEW', amount: 1000, ledgerStatus: 'PENDING', reason: 'ANOMALY_REVIEW' }],
      ['MONEY_REWARD', { ...base, weightValid: false, hasAnomaly: true }, { status: 'REJECTED', amount: 0, ledgerStatus: 'PENDING', reason: 'WEIGHT_INVALID' }],
      ['COMPLIANCE_ONLY', base, { status: 'ACCEPTED', amount: 0, ledgerStatus: 'AVAILABLE', reason: 'ACCEPTED' }],
      ['COMPLIANCE_ONLY', { ...base, typeMatch: false }, { status: 'REVIEW', amount: 0, ledgerStatus: 'PENDING', reason: 'TYPE_MISMATCH' }],
      ['COMPLIANCE_ONLY', { ...base, weightValid: false }, { status: 'REJECTED', amount: 0, ledgerStatus: 'PENDING', reason: 'WEIGHT_INVALID' }],
    ] as const)('%s %o', (mode, input, expected) => {
      expect(decideReward({ mode, ...input })).toEqual(expected);
    });

    it('refuses amounts that are not integer rupiah', () => {
      for (const baseAmount of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => decideReward({ ...base, mode: 'MONEY_REWARD', baseAmount })).toThrow(RangeError);
      }
    });
  });

  describe('verifyMaterial (LOG-05 taxonomy)', () => {
    const pet = { acceptedLabels: ['bottle_pet'] };
    it('normalizes labels for comparison', () => {
      expect(normalizeAiLabel(' Bottle PET ')).toBe('bottle_pet');
      expect(normalizeAiLabel('can-aluminium')).toBe('can_aluminium');
    });

    it.each([
      ['WEIGHT_ONLY', { aiLabel: 'paper', aiConfidence: 0.97 }, false, 'AI_TYPE_MISMATCH'],
      ['WEIGHT_ONLY', { aiLabel: 'can_aluminium', aiConfidence: 0.97 }, false, 'AI_TYPE_MISMATCH'],
      ['WEIGHT_ONLY', { aiLabel: 'unknown', aiConfidence: 0.8 }, false, 'AI_TYPE_MISMATCH'],
      ['WEIGHT_ONLY', { aiLabel: 'bottle_pet', aiConfidence: 0.49 }, false, 'AI_LOW_CONFIDENCE'],
      ['WEIGHT_ONLY', { aiLabel: 'bottle_pet', aiConfidence: 0.5 }, true, 'AI_MATCH'],
      ['WEIGHT_ONLY', { aiLabel: 'unknown', aiConfidence: 0 }, true, 'WEIGHT_ONLY'],
      ['WEIGHT_ONLY', {}, true, 'WEIGHT_ONLY'],
      ['AI_REQUIRED', {}, false, 'AI_UNAVAILABLE'],
      ['AI_REQUIRED', { aiLabel: 'unknown', aiConfidence: 0 }, false, 'AI_UNAVAILABLE'],
      ['AI_REQUIRED', { aiLabel: 'bottle_pet', aiConfidence: 0.9 }, true, 'AI_MATCH'],
      ['BARCODE_WEIGHT', {}, false, 'BARCODE_MISSING'],
      ['BARCODE_WEIGHT', { barcodeValue: '  ' }, false, 'BARCODE_MISSING'],
      ['BARCODE_WEIGHT', { barcodeValue: '8991002100012' }, true, 'BARCODE_WEIGHT'],
      ['BARCODE_WEIGHT', { barcodeValue: '8991002100012', aiLabel: 'paper', aiConfidence: 0.9 }, false, 'AI_TYPE_MISMATCH'],
      ['BARCODE_WEIGHT', { aiLabel: 'bottle_pet', aiConfidence: 0.9 }, false, 'BARCODE_MISSING'],
      ['BARCODE_WEIGHT', { barcodeValue: '8991002100012', aiLabel: 'bottle_pet', aiConfidence: 0.9 }, true, 'BARCODE_WEIGHT'],
    ] as const)('%s %o', (policy, input, typeMatch, reason) => {
      expect(verifyMaterial({ policy, ...pet, ...input })).toEqual({ typeMatch, reason });
    });

    it('an unknown policy value fails closed as AI_REQUIRED (C4)', () => {
      expect(verifyMaterial({ policy: 'BOGUS' as any, ...pet })).toEqual({ typeMatch: false, reason: 'AI_UNAVAILABLE' });
      expect(verifyMaterial({ policy: undefined as any, ...pet, barcodeValue: '899' })).toEqual({ typeMatch: false, reason: 'AI_UNAVAILABLE' });
      expect(verifyMaterial({ policy: 'BOGUS' as any, ...pet, aiLabel: 'bottle_pet', aiConfidence: 0.9 })).toEqual({ typeMatch: true, reason: 'AI_MATCH' });
    });

    it('a waste type without a taxonomy cannot be verified by AI: AI_REQUIRED holds it, other policies decide explicitly', () => {
      expect(verifyMaterial({ policy: 'AI_REQUIRED', acceptedLabels: [], aiLabel: 'bottle_pet', aiConfidence: 0.9 }))
        .toEqual({ typeMatch: false, reason: 'AI_TAXONOMY_MISSING' });
      expect(verifyMaterial({ policy: 'WEIGHT_ONLY', acceptedLabels: [], aiLabel: 'paper', aiConfidence: 0.9 }))
        .toEqual({ typeMatch: true, reason: 'WEIGHT_ONLY' });
      expect(verifyMaterial({ policy: 'BARCODE_WEIGHT', acceptedLabels: [], aiLabel: 'paper', aiConfidence: 0.9 }))
        .toEqual({ typeMatch: false, reason: 'BARCODE_MISSING' });
    });
  });

  describe('campaign reward modes', () => {
    const campaign = (campaignType: string, extra: Record<string, unknown> = {}) =>
      ({ campaignType, rewardMode: 'MONEY_REWARD', supportsMachine: false, ...extra }) as any;

    it('allows machine deposits for MACHINE_DEPOSIT, and EVENT/SCHOOL_PROGRAM only with supportsMachine', () => {
      expect(campaignSupportsMachine(campaign('MACHINE_DEPOSIT'))).toBe(true);
      expect(campaignSupportsMachine(campaign('EVENT'))).toBe(false);
      expect(campaignSupportsMachine(campaign('EVENT', { supportsMachine: true }))).toBe(true);
      expect(campaignSupportsMachine(campaign('SCHOOL_PROGRAM', { supportsMachine: true }))).toBe(true);
      expect(campaignSupportsMachine(campaign('TRASH_BAG', { supportsMachine: true }))).toBe(false);
      expect(campaignSupportsMachine(campaign('TOURISM_PROGRAM', { supportsMachine: true }))).toBe(false);
    });

    it('resolves the machine mode from the campaign, or the organization when there is none', () => {
      expect(machineRewardMode({ campaign: null, organizationMode: 'MONEY_REWARD' })).toBe('MONEY_REWARD');
      expect(machineRewardMode({ campaign: null, organizationMode: 'COMPLIANCE_ONLY' })).toBe('COMPLIANCE_ONLY');
      expect(machineRewardMode({ campaign: campaign('MACHINE_DEPOSIT', { rewardMode: 'COMPLIANCE_ONLY' }), organizationMode: 'MONEY_REWARD' }))
        .toBe('COMPLIANCE_ONLY');
      expect(machineRewardMode({ campaign: campaign('TRASH_BAG'), organizationMode: 'MONEY_REWARD' })).toBe('COMPLIANCE_ONLY');
      expect(machineRewardMode({ campaign: campaign('MACHINE_DEPOSIT'), organizationMode: 'COMPLIANCE_ONLY' })).toBe('MONEY_REWARD');
    });

    it('pays trips only for trip campaign types in MONEY_REWARD mode', () => {
      expect(tripRewardMode(campaign('TRASH_BAG'))).toBe('MONEY_REWARD');
      expect(tripRewardMode(campaign('TOURISM_PROGRAM', { rewardMode: 'COMPLIANCE_ONLY' }))).toBe('COMPLIANCE_ONLY');
      expect(tripRewardMode(campaign('MACHINE_DEPOSIT'))).toBe('COMPLIANCE_ONLY');
    });
  });
});
