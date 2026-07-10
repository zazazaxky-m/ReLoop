import { describe, expect, it, vi, beforeEach } from "vitest";
import { loadPublicMapCampaigns } from "./map-data";
import { prisma } from "./prisma";

vi.mock("./prisma", () => ({
  prisma: {
    campaign: { findMany: vi.fn() },
    machine: { findMany: vi.fn() },
  },
}));

describe("lib/map-data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array when no campaigns", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
    const res = await loadPublicMapCampaigns();
    expect(res).toEqual([]);
  });

  it("returns campaigns with centroid", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      {
        id: "c1",
        name: "Camp",
        organizationId: "o1",
        rewardMultiplier: 2,
        organization: { id: "o1", name: "Org" },
      },
    ] as any);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([
      { organizationId: "o1", latitude: 1, longitude: 2 },
      { organizationId: "o1", latitude: 3, longitude: 4 },
    ] as any);
    const res = await loadPublicMapCampaigns();
    expect(res).toHaveLength(1);
    expect(res[0].latitude).toBe(2);
    expect(res[0].longitude).toBe(3);
  });

  it("filters out campaigns without machine coords", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      {
        id: "c1",
        name: "Camp",
        organizationId: "o1",
        rewardMultiplier: null,
        organization: { id: "o1", name: "Org" },
      },
    ] as any);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([]);
    const res = await loadPublicMapCampaigns();
    expect(res).toHaveLength(0);
  });

  it("filters by organizationIds option", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
    await loadPublicMapCampaigns({ organizationIds: ["o1"] });
    expect(prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: { in: ["o1"] } }),
      }),
    );
  });
});
