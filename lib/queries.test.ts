import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  wasteTypeOptions,
  regionOptions,
  organizationOptions,
  campaignOptions,
} from "./queries";
import { prisma } from "./prisma";

vi.mock("./prisma", () => ({
  prisma: {
    wasteType: { findMany: vi.fn() },
    region: { findMany: vi.fn() },
    organization: { findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
  },
}));

describe("lib/queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wasteTypeOptions without org filter", async () => {
    vi.mocked(prisma.wasteType.findMany).mockResolvedValue([{ id: "1", name: "Plastic" }] as any);
    const res = await wasteTypeOptions();
    expect(res).toHaveLength(1);
    expect(prisma.wasteType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { active: true } }),
    );
  });

  it("wasteTypeOptions with org filter", async () => {
    vi.mocked(prisma.wasteType.findMany).mockResolvedValue([]);
    await wasteTypeOptions("org1");
    expect(prisma.wasteType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { active: true, OR: [{ organizationId: null }, { organizationId: "org1" }] },
      }),
    );
  });

  it("regionOptions maps type suffix", async () => {
    vi.mocked(prisma.region.findMany).mockResolvedValue([
      { id: "r1", name: "Jakarta", type: "CITY" },
    ] as any);
    const res = await regionOptions();
    expect(res[0].name).toBe("Jakarta (CITY)");
  });

  it("organizationOptions returns ordered list", async () => {
    vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: "o1", name: "Org" }] as any);
    const res = await organizationOptions();
    expect(res).toHaveLength(1);
  });

  it("campaignOptions without org filter", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([{ id: "c1", name: "Camp" }] as any);
    const res = await campaignOptions();
    expect(res).toHaveLength(1);
  });

  it("campaignOptions with org filter", async () => {
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
    await campaignOptions("org1");
    expect(prisma.campaign.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: "org1" } }),
    );
  });
});
