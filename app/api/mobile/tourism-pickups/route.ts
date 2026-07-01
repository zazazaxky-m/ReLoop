import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser, activePartnerOrgIds } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["PENGEPUL"]);
    const orgIds = await activePartnerOrgIds(user.id);
    
    if (orgIds.length === 0) {
      return jsonOk({ trips: [] });
    }

    // Query trips with proper filtering
    const where: Prisma.TripWhereInput = {
      status: "COMPLETED",
      campaign: {
        organizationId: { in: orgIds },
        campaignType: { in: ["TRASH_BAG", "TOURISM_PROGRAM"] },
      },
    };

    const trips = await prisma.trip.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    // Fetch related data separately to avoid type issues
    const campaignIds = [...new Set(trips.map((t) => t.campaignId))];
    const travelAgentIds = [...new Set(trips.map((t) => t.travelAgentId).filter(Boolean))];

    const [campaigns, travelAgents, bagCounts, validationCounts] = await Promise.all([
      prisma.campaign.findMany({
        where: { id: { in: campaignIds } },
        select: { 
          id: true, 
          name: true, 
          organization: { select: { name: true } } 
        },
      }),
      prisma.travelAgent.findMany({
        where: { id: { in: travelAgentIds as string[] } },
        select: { id: true, name: true },
      }),
      prisma.trashBagAssignment.groupBy({
        by: ["tripId"],
        where: { tripId: { in: trips.map((t) => t.id) } },
        _count: { id: true },
      }),
      prisma.manualValidation.groupBy({
        by: ["tripId"],
        where: {
          tripId: { in: trips.map((t) => t.id) },
          validationStage: "BANK_SAMPAH_PICKUP",
        },
        _count: { id: true },
      }),
    ]);

    // Build lookup maps
    const campaignMap = new Map(campaigns.map((c) => [c.id, c]));
    const travelAgentMap = new Map(travelAgents.map((t) => [t.id, t]));
    const bagCountMap = new Map(bagCounts.map((b) => [b.tripId, b._count.id]));
    const validationMap = new Map(validationCounts.map((v) => [v.tripId, v._count.id]));

    return jsonOk({
      trips: trips.map((trip) => {
        const campaign = campaignMap.get(trip.campaignId);
        const travelAgent = trip.travelAgentId
          ? travelAgentMap.get(trip.travelAgentId)
          : null;
        return {
          id: trip.id,
          groupName: trip.groupName,
          campaignName: campaign?.name ?? "-",
          organizationName: campaign?.organization?.name ?? "-",
          travelAgentName: travelAgent?.name ?? null,
          complianceStatus: trip.complianceStatus,
          complianceScore: trip.complianceScore,
          bagCount: bagCountMap.get(trip.id) ?? 0,
          pickedUp: (validationMap.get(trip.id) ?? 0) > 0,
        };
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
