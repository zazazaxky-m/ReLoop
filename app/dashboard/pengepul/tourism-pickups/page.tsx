import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { TourismPickupManager, type TourismPickupRow } from "@/components/travel-agent/TourismPickupManager";
import { activePartnerOrgIds, requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Pickup Wisata" };

export default async function PengepulTourismPickupsPage() {
  const user = await requirePageUser(["PENGEPUL"]);
  const orgIds = await activePartnerOrgIds(user.id);

  const trips = orgIds.length
    ? await prisma.trip.findMany({
        where: {
          campaign: { organizationId: { in: orgIds }, campaignType: { in: ["TRASH_BAG", "TOURISM_PROGRAM"] } },
          status: "COMPLETED",
        },
        orderBy: { updatedAt: "desc" },
        include: {
          campaign: { select: { name: true, organization: { select: { name: true } } } },
          travelAgent: { select: { name: true } },
          bagAssignments: { select: { id: true } },
          validations: {
            where: { validationStage: "BANK_SAMPAH_PICKUP" },
            select: { id: true },
          },
        },
      })
    : [];

  const rows: TourismPickupRow[] = trips.map((t) => ({
    id: t.id,
    groupName: t.groupName,
    campaignName: t.campaign.name,
    organizationName: t.campaign.organization.name,
    travelAgentName: t.travelAgent?.name ?? t.travelAgentName,
    complianceStatus: t.complianceStatus,
    complianceScore: t.complianceScore,
    bagCount: t.bagAssignments.length,
    pickedUp: t.validations.length > 0,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pickup Wisata"
        description="Catat pengambilan trash bag terpilah dari program wisata mitra."
      />
      <TourismPickupManager rows={rows} />
    </div>
  );
}
