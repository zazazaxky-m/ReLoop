import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { displayUserField } from "@/lib/display-user";
import { PickupManager, type PickupRow } from "@/components/pickup/PickupManager";

export const metadata: Metadata = { title: "Pickup" };

export default async function AdminPickupsPage() {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";

  const [pickups, machines, partners] = await Promise.all([
    prisma.pickupRequest.findMany({
      where: { organizationId: orgId },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      include: {
        machine: { select: { name: true, machineCode: true } },
        assignedCollector: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.machine.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.organizationCollectorPartner.findMany({
      where: { organizationId: orgId, status: "ACTIVE" },
      include: { collectorUser: { select: { id: true, name: true } } },
    }),
  ]);

  const rows: PickupRow[] = pickups.map((p) => ({
    id: p.id,
    machineName: p.machine?.name ?? null,
    machineCode: p.machine?.machineCode ?? null,
    organizationName: "",
    status: p.status,
    reason: p.reason,
    priority: p.priority,
    assignedCollectorName: displayUserField(p.assignedCollector?.name) ?? null,
    itemCount: p._count.items,
  }));

  const activePartners = partners.map((p) => ({
    id: p.collectorUser.id,
    name: displayUserField(p.collectorUser.name) ?? "-",
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pickup Request"
        description="Jadwalkan pengambilan, tetapkan pengepul, dan pantau progresnya."
      />
      <PickupManager pickups={rows} machines={machines} activePartners={activePartners} />
    </div>
  );
}
