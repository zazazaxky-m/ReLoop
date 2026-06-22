import { prisma } from "@/lib/prisma";
import { handleApiError, jsonOk } from "@/lib/api";
import { requireApiUser, activePartnerOrgIds } from "@/lib/rbac";
import { machineCentroid } from "@/lib/map";

export async function GET() {
  try {
    const user = await requireApiUser();
    let organizationIds: string[] | undefined;

    if (user.role === "ADMIN") {
      organizationIds = user.organizationId ? [user.organizationId] : [];
    } else if (user.role === "PENGEPUL") {
      organizationIds = await activePartnerOrgIds(user.id);
    }

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
      }),
      user.role === "PENGEPUL"
        ? Promise.resolve([])
        : prisma.campaign.findMany({
            where: {
              visibility: "PUBLIC",
              status: "ACTIVE",
              ...(organizationIds
                ? {
                    organizationId: {
                      in: organizationIds.length ? organizationIds : ["__none__"],
                    },
                  }
                : {}),
            },
            include: {
              organization: {
                select: {
                  id: true,
                  name: true,
                  machines: { select: { latitude: true, longitude: true } },
                },
              },
            },
          }),
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
      campaigns: campaigns.flatMap((campaign) => {
        const centroid = machineCentroid(campaign.organization.machines);
        return centroid
          ? [
              {
                id: campaign.id,
                name: campaign.name,
                organization: {
                  id: campaign.organization.id,
                  name: campaign.organization.name,
                },
                rewardMultiplier: campaign.rewardMultiplier,
                latitude: centroid.latitude,
                longitude: centroid.longitude,
              },
            ]
          : [];
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
