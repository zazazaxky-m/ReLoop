import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export interface WeightValidation {
  valid: boolean;
  reasonCode?: string;
}

export function validateWeight(
  weightGrams: number | null | undefined,
  minGrams: number | null | undefined,
  maxGrams: number | null | undefined,
): WeightValidation {
  if (weightGrams == null) {
    return { valid: false, reasonCode: "WEIGHT_MISSING" };
  }
  if (minGrams != null && weightGrams < minGrams) {
    return { valid: false, reasonCode: "WEIGHT_BELOW_MIN" };
  }
  if (maxGrams != null && weightGrams > maxGrams) {
    return { valid: false, reasonCode: "WEIGHT_ABOVE_MAX" };
  }
  return { valid: true };
}

type RewardRateRow = Awaited<ReturnType<typeof prisma.rewardRate.findFirst>>;

function ratePriority(
  rate: NonNullable<RewardRateRow>,
  organizationId: string,
  campaignId?: string | null,
): number {
  if (campaignId && rate.campaignId === campaignId) return 0;
  if (rate.organizationId === organizationId && rate.campaignId == null) return 1;
  if (rate.organizationId == null && rate.campaignId == null) return 2;
  return 99;
}

const activeRateWindow = (now: Date): Prisma.RewardRateWhereInput => ({
  active: true,
  effectiveFrom: { lte: now },
  OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
});

/** Resolves the active reward rate for a machine deposit (campaign > org > global). */
export async function resolveRewardRate(
  params: {
    organizationId: string;
    campaignId?: string | null;
    wasteTypeId: string;
  },
  tx?: Prisma.TransactionClient,
) {
  const now = new Date();
  const { organizationId, campaignId, wasteTypeId } = params;
  const db = tx ?? prisma;

  const scopeOr: Prisma.RewardRateWhereInput[] = [
    { organizationId, campaignId: null },
    { organizationId: null, campaignId: null },
  ];
  if (campaignId) {
    scopeOr.unshift({ campaignId, wasteTypeId });
  }

  const candidates = await db.rewardRate.findMany({
    where: {
      wasteTypeId,
      ...activeRateWindow(now),
      OR: scopeOr,
    },
    orderBy: { effectiveFrom: "desc" },
  });

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const priorityDiff =
      ratePriority(a, organizationId, campaignId) -
      ratePriority(b, organizationId, campaignId);
    if (priorityDiff !== 0) return priorityDiff;
    return b.effectiveFrom.getTime() - a.effectiveFrom.getTime();
  });

  return candidates[0];
}

export function computeRewardAmount(
  pointsPerItem: number,
  quantity: number,
  multiplier = 1,
): number {
  return Math.round(pointsPerItem * quantity * multiplier);
}

/**
 * WasteUnit.KG rates/`defaultRewardPerItem` are Rp per kilogram, not per
 * deposited item — without this, a 10g and a 900g item of the same type
 * earned the same reward as long as both passed the min/max weight gate.
 * Uses Math.floor (not round) so partial-kilogram remainders are never
 * rounded in the user's favor. `pointsPerItem`/`defaultRewardPerItem` keep
 * their existing column/field names (see prisma/schema.prisma) to avoid a
 * migration; for KG waste types they mean "rupiah per kilogram".
 */
export function computeWeightBasedRewardAmount(
  ratePerKg: number,
  measuredWeightGrams: number | null | undefined,
  multiplier = 1,
): number {
  const grams = measuredWeightGrams ?? 0;
  return Math.floor((grams / 1000) * ratePerKg * multiplier);
}

export interface FusionInput {
  wasteTypeId: string;
  aiDetectedType?: string | null;
  aiConfidence?: number | null;
  barcodeValue?: string | null;
  measuredWeightGrams?: number | null;
  minWeightGrams?: number | null;
  maxWeightGrams?: number | null;
}

/** Lightweight sensor fusion: weight threshold + optional AI/barcode hints. */
export function evaluateSensorFusion(input: FusionInput): WeightValidation & {
  wasteTypeMatch: boolean;
} {
  const weight = validateWeight(
    input.measuredWeightGrams,
    input.minWeightGrams,
    input.maxWeightGrams,
  );
  if (!weight.valid) {
    return { ...weight, wasteTypeMatch: false };
  }

  let wasteTypeMatch = true;
  if (input.aiDetectedType && input.aiConfidence != null) {
    const normalized = input.aiDetectedType.toLowerCase();
    const hints = ["botol", "bottle", "pet", "kaleng", "can", "aluminium"];
    wasteTypeMatch =
      input.aiConfidence >= 0.5 &&
      hints.some((h) => normalized.includes(h));
  }

  return { valid: true, wasteTypeMatch };
}
