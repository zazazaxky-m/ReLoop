import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { TripManager, type TripRow } from "@/components/trip/TripManager";
import { wasteTypeOptions } from "@/lib/queries";

export const metadata: Metadata = { title: "Trip / Trash Bag" };

export default async function AdminTripsPage() {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";

  const [trips, campaigns, travelAgents, wasteTypes] = await Promise.all([
    prisma.trip.findMany({
      where: { campaign: { organizationId: orgId } },
      orderBy: { createdAt: "desc" },
      include: {
        campaign: { select: { name: true, rewardMode: true } },
        travelAgent: { select: { id: true, name: true } },
        _count: { select: { bagAssignments: true, validations: true } },
      },
    }),
    prisma.campaign.findMany({
      where: {
        organizationId: orgId,
        campaignType: { in: ["TRASH_BAG", "TOURISM_PROGRAM"] },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
    prisma.travelAgentOrganization.findMany({
      where: { organizationId: orgId, status: "INVITED" },
      orderBy: { travelAgent: { name: "asc" } },
      include: { travelAgent: { select: { id: true, name: true, email: true } } },
    }),
    wasteTypeOptions(orgId),
  ]);

  const rows: TripRow[] = trips.map((t) => ({
    id: t.id,
    campaignName: t.campaign.name,
    rewardMode: t.campaign.rewardMode,
    travelAgentId: t.travelAgentId,
    travelAgentName: t.travelAgent?.name ?? t.travelAgentName,
    groupName: t.groupName,
    leaderName: t.leaderName,
    participantCount: t.participantCount,
    status: t.status,
    complianceStatus: t.complianceStatus,
    complianceScore: t.complianceScore,
    bagCount: t._count.bagAssignments,
    validationCount: t._count.validations,
    hasUser: t.userId != null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Trip / Trash Bag"
        description="Kelola perjalanan, kantong ber-QR, dan validasi pengembalian."
      />
      <TripManager
        trips={rows}
        campaigns={campaigns}
        travelAgents={travelAgents.map((t) => ({
          id: t.travelAgent.id,
          name: t.travelAgent.name,
          email: t.travelAgent.email,
        }))}
        wasteTypes={wasteTypes}
      />
    </div>
  );
}
