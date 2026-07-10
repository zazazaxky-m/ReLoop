import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";

/** Default reward per returned & sorted trash bag (Rp). Overridden by campaign.rewardMultiplier. */
export const TRASH_BAG_REWARD_PER_BAG = 2000;

/** Campaign types that power the trash-bag / tourism trip flow. */
export const TRASH_BAG_CAMPAIGN_TYPES = ["TRASH_BAG", "TOURISM_PROGRAM"] as const;
export type TrashBagCampaignType = (typeof TRASH_BAG_CAMPAIGN_TYPES)[number];

export function isTrashBagCampaignType(
  type: string | null | undefined,
): type is TrashBagCampaignType {
  return type === "TRASH_BAG" || type === "TOURISM_PROGRAM";
}

/** Program wisata always needs an invited travel agent; trash-bag trips may be standalone. */
export function requiresTravelAgent(campaignType: string | null | undefined): boolean {
  return campaignType === "TOURISM_PROGRAM";
}

/** Generates a unique, human-shareable trash-bag QR code. */
export function generateBagQrCode(): string {
  const rand = randomBytes(6).toString("hex").toUpperCase();
  return `BAG-${rand}`;
}

/** Condition statuses that still earn a reward (sorted/returned in usable shape). */
export function isRewardableCondition(condition: string | null | undefined): boolean {
  return condition === "GOOD" || condition === "PARTIAL";
}

/**
 * Trash-bag payout:
 * base = rewardableBags × TRASH_BAG_REWARD_PER_BAG × campaignMultiplier
 * final = floor(base × complianceScore/100)
 */
export function computeTrashBagRewardAmount(input: {
  rewardableBagCount: number;
  complianceScore: number;
  rewardMultiplier?: number | null;
  rewardPerBag?: number;
}): number {
  if (input.rewardableBagCount <= 0) return 0;
  const perBag = input.rewardPerBag ?? TRASH_BAG_REWARD_PER_BAG;
  const campaignMult =
    input.rewardMultiplier != null && input.rewardMultiplier > 0
      ? input.rewardMultiplier
      : 1;
  const base = input.rewardableBagCount * perBag * campaignMult;
  const complianceMult = Math.max(0, Math.min(100, input.complianceScore)) / 100;
  return Math.floor(base * complianceMult);
}

/** Manual PATCH may only cancel (or reopen a cancelled trip). Lifecycle otherwise follows gate validations. */
export function canManuallySetTripStatus(
  current: string,
  next: string,
): { ok: boolean; reason?: string } {
  if (current === next) return { ok: true };
  if (next === "CANCELLED" && (current === "PLANNED" || current === "ACTIVE")) {
    return { ok: true };
  }
  if (next === "PLANNED" && current === "CANCELLED") {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      "Status trip hanya bisa dibatalkan (PLANNED/ACTIVE → CANCELLED) atau dibuka ulang (CANCELLED → PLANNED). Check-in/out mengatur ACTIVE/COMPLETED otomatis.",
  };
}

export function canIssueBagsForTripStatus(status: string): boolean {
  return status === "PLANNED" || status === "ACTIVE";
}

export function canValidateTripStage(
  tripStatus: string,
  stage: string,
): { ok: boolean; reason?: string } {
  if (tripStatus === "CANCELLED") {
    return { ok: false, reason: "Trip sudah dibatalkan" };
  }
  if (stage === "BANK_SAMPAH_PICKUP") {
    if (tripStatus !== "COMPLETED") {
      return { ok: false, reason: "Pickup bank sampah hanya untuk trip yang sudah check-out" };
    }
    return { ok: true };
  }
  if (tripStatus === "COMPLETED") {
    return { ok: false, reason: "Trip sudah selesai; validasi gerbang tidak dapat diulang" };
  }
  if (stage === "CHECK_IN" && tripStatus === "ACTIVE") {
    return { ok: false, reason: "Trip sudah check-in" };
  }
  if (stage === "CHECK_OUT" && tripStatus === "PLANNED") {
    return { ok: false, reason: "Lakukan check-in terlebih dahulu sebelum check-out" };
  }
  return { ok: true };
}

/**
 * Gate ops (issue bags / check-in / check-out / progressive scan) require the trip's
 * travel agent to still be INVITED for the campaign org. Pickup after COMPLETED is
 * allowed even if the agent was later suspended.
 */
export async function getTripTravelAgentGateBlockReason(input: {
  travelAgentId: string | null | undefined;
  organizationId: string;
}): Promise<string | null> {
  if (!input.travelAgentId) return null;
  const link = await prisma.travelAgentOrganization.findUnique({
    where: {
      travelAgentId_organizationId: {
        travelAgentId: input.travelAgentId,
        organizationId: input.organizationId,
      },
    },
    select: { status: true },
  });
  if (!link || link.status !== "INVITED") {
    return "Travel agent trip ini sudah ditangguhkan atau dihapus dari organisasi";
  }
  return null;
}

/** Travel-agent-linked USER may only see trips for orgs where the agent is still INVITED. */
export async function getInvitedTravelAgentTripFilters(userId: string): Promise<
  Array<{ travelAgentId: string; organizationId: string }>
> {
  const agentLinks = await prisma.travelAgentUser.findMany({
    where: { userId },
    select: { travelAgentId: true },
  });
  const travelAgentIds = agentLinks.map((link) => link.travelAgentId);
  if (travelAgentIds.length === 0) return [];

  const invited = await prisma.travelAgentOrganization.findMany({
    where: { travelAgentId: { in: travelAgentIds }, status: "INVITED" },
    select: { travelAgentId: true, organizationId: true },
  });
  return invited;
}
