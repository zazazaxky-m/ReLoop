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

/** Resolves the active reward rate for a machine deposit (org or campaign scoped). */
export async function resolveRewardRate(params: {
  organizationId: string;
  campaignId?: string | null;
  wasteTypeId: string;
}) {
  const now = new Date();
  const { organizationId, campaignId, wasteTypeId } = params;

  if (campaignId) {
    const campaignRate = await prisma.rewardRate.findFirst({
      where: {
        campaignId,
        wasteTypeId,
        active: true,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      orderBy: { effectiveFrom: "desc" },
    });
    if (campaignRate) return campaignRate;
  }

  const orgRate = await prisma.rewardRate.findFirst({
    where: {
      organizationId,
      campaignId: null,
      wasteTypeId,
      active: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  if (orgRate) return orgRate;

  return prisma.rewardRate.findFirst({
    where: {
      organizationId: null,
      campaignId: null,
      wasteTypeId,
      active: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
}

export function computeRewardAmount(
  pointsPerItem: number,
  quantity: number,
  multiplier = 1,
): number {
  return Math.round(pointsPerItem * quantity * multiplier);
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
