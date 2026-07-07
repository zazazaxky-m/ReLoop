import { prisma } from "./prisma";
import { machineCentroid, type MapCampaign } from "./map";

const MAX_MAP_MACHINES = 500;
const MAX_MAP_CAMPAIGNS = 100;

export async function loadPublicMapCampaigns(options?: {
  organizationIds?: string[];
}): Promise<MapCampaign[]> {
  const campaigns = await prisma.campaign.findMany({
    where: {
      visibility: "PUBLIC",
      status: "ACTIVE",
      ...(options?.organizationIds?.length
        ? { organizationId: { in: options.organizationIds } }
        : {}),
    },
    include: {
      organization: { select: { id: true, name: true } },
    },
    orderBy: { startAt: "desc" },
    take: MAX_MAP_CAMPAIGNS,
  });

  if (!campaigns.length) return [];

  const orgIds = Array.from(new Set(campaigns.map((c) => c.organizationId)));
  const machines = await prisma.machine.findMany({
    where: {
      organizationId: { in: orgIds },
      latitude: { not: null },
      longitude: { not: null },
    },
    select: { organizationId: true, latitude: true, longitude: true },
  });

  const machinesByOrg = new Map<string, { latitude: number | null; longitude: number | null }[]>();
  for (const machine of machines) {
    const list = machinesByOrg.get(machine.organizationId) ?? [];
    list.push({ latitude: machine.latitude, longitude: machine.longitude });
    machinesByOrg.set(machine.organizationId, list);
  }

  return campaigns
    .map((campaign) => {
      const centroid = machineCentroid(machinesByOrg.get(campaign.organizationId) ?? []);
      if (!centroid) return null;
      return {
        id: campaign.id,
        name: campaign.name,
        organizationId: campaign.organizationId,
        organizationName: campaign.organization.name,
        latitude: centroid.latitude,
        longitude: centroid.longitude,
        rewardMultiplier: campaign.rewardMultiplier,
      };
    })
    .filter((campaign): campaign is MapCampaign => campaign !== null);
}

export { MAX_MAP_MACHINES };
