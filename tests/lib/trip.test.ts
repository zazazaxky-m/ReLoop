import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  isTrashBagCampaignType,
  requiresTravelAgent,
  generateBagQrCode,
  isRewardableCondition,
  computeTrashBagRewardAmount,
  canManuallySetTripStatus,
  canIssueBagsForTripStatus,
  canValidateTripStage,
  getTripTravelAgentGateBlockReason,
  getInvitedTravelAgentTripFilters,
  aggregateBagCondition,
  evaluateTripBags,
} from "@/lib/trip";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    travelAgentOrganization: { findUnique: vi.fn(), findMany: vi.fn() },
    travelAgentUser: { findMany: vi.fn() },
  },
}));

describe("trip", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("isTrashBagCampaignType", () => {
    it("returns true for valid types", () => {
      expect(isTrashBagCampaignType("TRASH_BAG")).toBe(true);
      expect(isTrashBagCampaignType("TOURISM_PROGRAM")).toBe(true);
    });

    it("returns false for others", () => {
      expect(isTrashBagCampaignType("STANDARD")).toBe(false);
      expect(isTrashBagCampaignType(null)).toBe(false);
      expect(isTrashBagCampaignType(undefined)).toBe(false);
    });
  });

  describe("requiresTravelAgent", () => {
    it("returns true for TOURISM_PROGRAM", () => {
      expect(requiresTravelAgent("TOURISM_PROGRAM")).toBe(true);
      expect(requiresTravelAgent("TRASH_BAG")).toBe(false);
      expect(requiresTravelAgent(null)).toBe(false);
    });
  });

  describe("generateBagQrCode", () => {
    it("generates BAG- prefixed code", () => {
      const code = generateBagQrCode();
      expect(code.startsWith("BAG-")).toBe(true);
      expect(code.length).toBe(16); // BAG- (4) + 12 hex chars
    });
  });

  describe("isRewardableCondition", () => {
    it("returns true for GOOD or PARTIAL", () => {
      expect(isRewardableCondition("GOOD")).toBe(true);
      expect(isRewardableCondition("PARTIAL")).toBe(true);
    });

    it("returns false for BAD or null", () => {
      expect(isRewardableCondition("BAD")).toBe(false);
      expect(isRewardableCondition(null)).toBe(false);
    });
  });

  describe("computeTrashBagRewardAmount", () => {
    it("computes reward with multipliers", () => {
      expect(
        computeTrashBagRewardAmount({ rewardableBagCount: 2, complianceScore: 100 })
      ).toBe(4000); // 2 * 2000 * 1

      expect(
        computeTrashBagRewardAmount({ rewardableBagCount: 2, complianceScore: 50 })
      ).toBe(2000); // 2 * 2000 * 1 * 0.5

      expect(
        computeTrashBagRewardAmount({ rewardableBagCount: 2, complianceScore: 100, rewardMultiplier: 1.5 })
      ).toBe(6000); // 2 * 2000 * 1.5

      expect(
        computeTrashBagRewardAmount({ rewardableBagCount: 2, complianceScore: 100, rewardPerBag: 1000 })
      ).toBe(2000); // 2 * 1000
      
      expect(
        computeTrashBagRewardAmount({ rewardableBagCount: 0, complianceScore: 100 })
      ).toBe(0);
      
      expect(
        computeTrashBagRewardAmount({ rewardableBagCount: -1, complianceScore: 100 })
      ).toBe(0);

      // bounds on compliance
      expect(
        computeTrashBagRewardAmount({ rewardableBagCount: 2, complianceScore: 150 })
      ).toBe(4000); // capped at 100

      expect(
        computeTrashBagRewardAmount({ rewardableBagCount: 2, complianceScore: -10 })
      ).toBe(0); // floored at 0
      
      // Zero multiplier handled gracefully
      expect(
        computeTrashBagRewardAmount({ rewardableBagCount: 2, complianceScore: 100, rewardMultiplier: 0 })
      ).toBe(4000); // default to 1 if <= 0
    });
  });

  describe("canManuallySetTripStatus", () => {
    it("allows same status", () => {
      expect(canManuallySetTripStatus("ACTIVE", "ACTIVE").ok).toBe(true);
    });

    it("allows cancel from PLANNED/ACTIVE", () => {
      expect(canManuallySetTripStatus("PLANNED", "CANCELLED").ok).toBe(true);
      expect(canManuallySetTripStatus("ACTIVE", "CANCELLED").ok).toBe(true);
    });

    it("allows reopen from CANCELLED to PLANNED", () => {
      expect(canManuallySetTripStatus("CANCELLED", "PLANNED").ok).toBe(true);
    });

    it("blocks other transitions", () => {
      const res = canManuallySetTripStatus("PLANNED", "COMPLETED");
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/Status trip hanya bisa dibatalkan/);
    });
  });

  describe("canIssueBagsForTripStatus", () => {
    it("allows for PLANNED and ACTIVE", () => {
      expect(canIssueBagsForTripStatus("PLANNED")).toBe(true);
      expect(canIssueBagsForTripStatus("ACTIVE")).toBe(true);
      expect(canIssueBagsForTripStatus("CANCELLED")).toBe(false);
    });
  });

  describe("canValidateTripStage", () => {
    it("blocks if CANCELLED", () => {
      const res = canValidateTripStage("CANCELLED", "CHECK_IN");
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/Trip sudah dibatalkan/);
    });

    it("blocks BANK_SAMPAH_PICKUP if not COMPLETED", () => {
      expect(canValidateTripStage("ACTIVE", "BANK_SAMPAH_PICKUP").ok).toBe(false);
      expect(canValidateTripStage("COMPLETED", "BANK_SAMPAH_PICKUP").ok).toBe(true);
    });

    it("blocks if already COMPLETED and not BANK_SAMPAH_PICKUP", () => {
      const res = canValidateTripStage("COMPLETED", "CHECK_IN");
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/Trip sudah selesai/);
    });

    it("blocks CHECK_IN if already ACTIVE", () => {
      const res = canValidateTripStage("ACTIVE", "CHECK_IN");
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/Trip sudah check-in/);
    });

    it("blocks CHECK_OUT if only PLANNED", () => {
      const res = canValidateTripStage("PLANNED", "CHECK_OUT");
      expect(res.ok).toBe(false);
      expect(res.reason).toMatch(/Lakukan check-in terlebih dahulu/);
    });

    it("allows valid transitions", () => {
      expect(canValidateTripStage("PLANNED", "CHECK_IN").ok).toBe(true);
      expect(canValidateTripStage("ACTIVE", "CHECK_OUT").ok).toBe(true);
    });
  });

  describe("getTripTravelAgentGateBlockReason", () => {
    it("allows trips without travel agent", async () => {
      await expect(
        getTripTravelAgentGateBlockReason({ travelAgentId: null, organizationId: "org1" }),
      ).resolves.toBeNull();
      expect(prisma.travelAgentOrganization.findUnique).not.toHaveBeenCalled();
    });

    it("allows invited agents", async () => {
      vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue({
        status: "INVITED",
      } as any);
      await expect(
        getTripTravelAgentGateBlockReason({ travelAgentId: "ta1", organizationId: "org1" }),
      ).resolves.toBeNull();
    });

    it("blocks missing or non-invited agent links", async () => {
      vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue(null);
      await expect(
        getTripTravelAgentGateBlockReason({ travelAgentId: "ta1", organizationId: "org1" }),
      ).resolves.toMatch(/ditangguhkan atau dihapus/);

      vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue({
        status: "SUSPENDED",
      } as any);
      await expect(
        getTripTravelAgentGateBlockReason({ travelAgentId: "ta1", organizationId: "org1" }),
      ).resolves.toMatch(/ditangguhkan atau dihapus/);
    });

    it("reads the link through a transaction client when one is given", async () => {
      const tx = { travelAgentOrganization: { findUnique: vi.fn().mockResolvedValue({ status: "INVITED" }) } };
      await expect(
        getTripTravelAgentGateBlockReason({ travelAgentId: "ta1", organizationId: "org1" }, tx as any),
      ).resolves.toBeNull();
      expect(tx.travelAgentOrganization.findUnique).toHaveBeenCalled();
      expect(prisma.travelAgentOrganization.findUnique).not.toHaveBeenCalled();
    });
  });

  describe("aggregateBagCondition", () => {
    it("ignores unreviewed bags and derives the trip condition", () => {
      expect(aggregateBagCondition([])).toBeNull();
      expect(aggregateBagCondition([null, undefined])).toBeNull();
      expect(aggregateBagCondition(["NOT_RETURNED", "NOT_RETURNED", null])).toBe("NOT_RETURNED");
      expect(aggregateBagCondition(["GOOD", null, "GOOD"])).toBe("GOOD");
      expect(aggregateBagCondition(["GOOD", "POOR", "PARTIAL"])).toBe("POOR");
      expect(aggregateBagCondition(["GOOD", "PARTIAL"])).toBe("PARTIAL");
      expect(aggregateBagCondition(["GOOD", "NOT_RETURNED"])).toBe("PARTIAL");
    });
  });

  describe("evaluateTripBags", () => {
    it("scores and prices a trip from its bag rows only (one row = one unit)", () => {
      expect(evaluateTripBags({ statuses: ["GOOD", "POOR", "PARTIAL", null], appCompleted: true,
        rewardMode: "MONEY_REWARD", hasRecipient: true, rewardMultiplier: null })).toEqual({
        assignedCount: 4, reviewedCount: 3, returnedCount: 3, rewardableCount: 2, conditionStatus: "POOR",
        // app 30 + some returned 20 + POOR 0 = 50 -> 2 x 2.000 x 50%.
        compliance: { score: 50, status: "NEEDS_REVIEW" }, rewardAmount: 2_000 });
    });

    it("earns nothing without a recipient, for COMPLIANCE_ONLY, or without rewardable bags", () => {
      const base = { statuses: ["GOOD"] as const, appCompleted: true, rewardMultiplier: 2 };
      expect(evaluateTripBags({ ...base, rewardMode: "MONEY_REWARD", hasRecipient: true }).rewardAmount).toBe(4_000);
      expect(evaluateTripBags({ ...base, rewardMode: "MONEY_REWARD", hasRecipient: false }).rewardAmount).toBe(0);
      expect(evaluateTripBags({ ...base, rewardMode: "COMPLIANCE_ONLY", hasRecipient: true }).rewardAmount).toBe(0);
      expect(evaluateTripBags({ statuses: ["NOT_RETURNED"], appCompleted: false, rewardMode: "MONEY_REWARD",
        hasRecipient: true }).rewardAmount).toBe(0);
      expect(evaluateTripBags({ statuses: [], appCompleted: true, rewardMode: "MONEY_REWARD", hasRecipient: true }))
        .toMatchObject({ assignedCount: 0, reviewedCount: 0, conditionStatus: null, rewardAmount: 0 });
    });
  });

  describe("getInvitedTravelAgentTripFilters", () => {
    it("returns empty when user has no agent links", async () => {
      vi.mocked(prisma.travelAgentUser.findMany).mockResolvedValue([]);
      await expect(getInvitedTravelAgentTripFilters("u1")).resolves.toEqual([]);
      expect(prisma.travelAgentOrganization.findMany).not.toHaveBeenCalled();
    });

    it("returns invited org filters for linked agents", async () => {
      vi.mocked(prisma.travelAgentUser.findMany).mockResolvedValue([
        { travelAgentId: "ta1" },
        { travelAgentId: "ta2" },
      ] as any);
      vi.mocked(prisma.travelAgentOrganization.findMany).mockResolvedValue([
        { travelAgentId: "ta1", organizationId: "org1" },
      ] as any);

      await expect(getInvitedTravelAgentTripFilters("u1")).resolves.toEqual([
        { travelAgentId: "ta1", organizationId: "org1" },
      ]);
      // A03: only memberships verified from the invited mailbox, by a verified account email.
      expect(prisma.travelAgentUser.findMany).toHaveBeenCalledWith({
        where: { userId: "u1", verifiedAt: { not: null }, user: { emailVerifiedAt: { not: null } } },
        select: { travelAgentId: true },
      });
      expect(prisma.travelAgentOrganization.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { travelAgentId: { in: ["ta1", "ta2"] }, status: "INVITED" },
        }),
      );
    });
  });
});
