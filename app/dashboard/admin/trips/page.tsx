import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { TripManager, type TripRow } from "@/components/trip/TripManager";

export const metadata: Metadata = { title: "Trip / Trash Bag" };

export default async function AdminTripsPage() {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";

  const [trips, campaigns] = await Promise.all([
    prisma.trip.findMany({
      where: { campaign: { organizationId: orgId } },
      orderBy: { createdAt: "desc" },
      include: {
        campaign: { select: { name: true } },
        _count: { select: { bagAssignments: true, validations: true } },
      },
    }),
    prisma.campaign.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);

  const rows: TripRow[] = trips.map((t) => ({
    id: t.id,
    campaignName: t.campaign.name,
    groupName: t.groupName,
    leaderName: t.leaderName,
    status: t.status,
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
      <TripManager trips={rows} campaigns={campaigns} />
    </div>
  );
}
