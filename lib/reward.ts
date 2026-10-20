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

/**
 * Rates apply in the half-open UTC window [effectiveFrom, effectiveTo): a rate
 * ending at T and its successor starting at T never overlap. `rateWindow` is
 * the containment test alone (historical pricing); `activeRateWindow` adds
 * the `active` flag (what a new acceptance may use).
 */
export const rateWindow = (at: Date): Prisma.RewardRateWhereInput => ({
  effectiveFrom: { lte: at },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
});

export const activeRateWindow = (now: Date): Prisma.RewardRateWhereInput => ({
  active: true,
  ...rateWindow(now),
});

/**
 * Whether `at` lies in the rate's half-open window [effectiveFrom, effectiveTo).
 * Ignores `active` on purpose: a deposit review asks whether the rate recorded
 * at acceptance covered the acceptance instant, which a later deactivation
 * does not change (M04 fix round 4, N1). Selection of a *current* rate adds
 * the `active` check (`inRateWindow`).
 */
export function rateWindowContains(
  rate: { effectiveFrom: Date; effectiveTo: Date | null; active?: boolean },
  at: Date,
): boolean {
  return rate.effectiveFrom.getTime() <= at.getTime() && (rate.effectiveTo == null || rate.effectiveTo.getTime() > at.getTime());
}

function inRateWindow(rate: NonNullable<RewardRateRow>, now: Date): boolean {
  return rate.active !== false && rateWindowContains(rate, now);
}

interface RateScope {
  organizationId: string;
  campaignId?: string | null;
  wasteTypeId: string;
}

/**
 * Shared selection: campaign > org > global; the newest effectiveFrom wins
 * inside one scope.
 *
 * EX-03: the window and the scope are both `OR` conditions, so they are
 * combined with `AND` instead of spread into one object (the scope's `OR`
 * used to replace the window's and selected expired rates). Candidates are
 * re-checked against the window in memory as well.
 */
async function selectRewardRate(
  scope: RateScope,
  at: Date,
  requireActive: boolean,
  db: Prisma.TransactionClient | typeof prisma,
) {
  const { organizationId, campaignId, wasteTypeId } = scope;

  const scopeOr: Prisma.RewardRateWhereInput[] = [
    { organizationId, campaignId: null },
    { organizationId: null, campaignId: null },
  ];
  if (campaignId) {
    scopeOr.unshift({ campaignId });
  }

  const candidates = (
    await db.rewardRate.findMany({
      where: { wasteTypeId, AND: [requireActive ? activeRateWindow(at) : rateWindow(at), { OR: scopeOr }] },
      orderBy: { effectiveFrom: "desc" },
    })
  ).filter((rate) => (requireActive ? inRateWindow(rate, at) : rateWindowContains(rate, at)));

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

/**
 * Resolves the active reward rate for a new machine deposit: the rate an
 * acceptance point records and prices from. Requires `active` inside the
 * window (a deactivated rate is never used for new money).
 */
export async function resolveRewardRate(
  params: RateScope & {
    /** Evaluation instant (UTC); defaults to now. */
    now?: Date;
  },
  tx?: Prisma.TransactionClient,
) {
  return selectRewardRate(params, params.now ?? new Date(), true, tx ?? prisma);
}

/**
 * Resolves the rate that was in effect at a past instant: what a deposit
 * review prices a held or legacy item from, at its recorded time (M04 fix
 * round 5, L3). Window containment only, exactly like the recorded-rate rule
 * (`rateWindowContains`): `active` is ignored, so a rate that covered `at`
 * and was deactivated or replaced later still prices the item as it was
 * priced then. Never used for a new acceptance.
 */
export async function resolveRewardRateAt(
  params: RateScope & {
    /** The recorded instant (UTC) to price at. */
    at: Date;
  },
  tx?: Prisma.TransactionClient,
) {
  return selectRewardRate(params, params.at, false, tx ?? prisma);
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
