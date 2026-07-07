import { prisma } from "@/lib/prisma";
import { handleApiError, jsonOk } from "@/lib/api";
import { requireApiUser, activePartnerOrgIds } from "@/lib/rbac";
import { loadPublicMapCampaigns, MAX_MAP_MACHINES } from "@/lib/map-data";

export async function GET() {
  try {
    const user = await requireApiUser();
    let organizationIds: string[] | undefined;

    if (user.role === "ADMIN") {
      organizationIds = user.organizationId ? [user.organizationId] : [];
    } else if (user.role === "PENGEPUL") {
      organizationIds = await activePartnerOrgIds(user.id);
    }

    const scopedOrgIds =
      user.role === "ADMIN" || user.role === "PENGEPUL"
        ? organizationIds
        : undefined;

    const [machines, campaigns] = await Promise.all([
      prisma.machine.findMany({
        where: {
          ...(organizationIds
            ? {
                organizationId: {
                  in: organizationIds.length ? organizationIds : ["__none__"],
                },
              }
            : {}),
          latitude: { not: null },
          longitude: { not: null },
        },
        include: {
          organization: { select: { id: true, name: true } },
          wasteTypes: {
            where: { active: true },
            include: { wasteType: { select: { id: true, name: true } } },
          },
        },
        orderBy: { name: "asc" },
        take: MAX_MAP_MACHINES,
      }),
      user.role === "PENGEPUL"
        ? Promise.resolve([])
        : loadPublicMapCampaigns(
            scopedOrgIds?.length ? { organizationIds: scopedOrgIds } : undefined,
          ),
    ]);

    return jsonOk({
      machines: machines.map((machine) => ({
        id: machine.id,
        name: machine.name,
        machineCode: machine.machineCode,
        status: machine.status,
        fillLevelPercent: machine.fillLevelPercent,
        capacityKg: machine.capacityKg,
        organization: machine.organization,
        latitude: machine.latitude,
        longitude: machine.longitude,
        supportedWasteTypes: machine.wasteTypes.map((link) => link.wasteType),
      })),
      campaigns: campaigns.map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        organization: {
          id: campaign.organizationId,
          name: campaign.organizationName,
        },
        rewardMultiplier: campaign.rewardMultiplier,
        latitude: campaign.latitude,
        longitude: campaign.longitude,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
