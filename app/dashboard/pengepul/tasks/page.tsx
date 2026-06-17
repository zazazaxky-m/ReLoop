import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { wasteTypeOptions } from "@/lib/queries";
import { PickupTaskList, type TaskRow } from "@/components/pickup/PickupTaskList";

export const metadata: Metadata = { title: "Tugas Pickup" };

export default async function PengepulTasksPage() {
  const user = await requirePageUser(["PENGEPUL"]);

  const [pickups, wasteTypes] = await Promise.all([
    prisma.pickupRequest.findMany({
      where: { assignedCollectorId: user.id },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      include: {
        machine: { select: { name: true, machineCode: true } },
        organization: {
          select: { name: true, address: true, contactName: true, contactPhone: true },
        },
        items: { include: { wasteType: { select: { name: true } } } },
      },
    }),
    wasteTypeOptions(),
  ]);

  const rows: TaskRow[] = pickups.map((p) => ({
    id: p.id,
    machineName: p.machine?.name ?? null,
    machineCode: p.machine?.machineCode ?? null,
    organizationName: p.organization.name,
    contactName: p.organization.contactName,
    contactPhone: p.organization.contactPhone,
    address: p.organization.address,
    status: p.status,
    reason: p.reason,
    items: p.items.map((it) => ({
      id: it.id,
      wasteTypeName: it.wasteType?.name ?? null,
      itemCount: it.itemCount,
      actualWeightKg: it.actualWeightKg,
      notes: it.notes,
    })),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tugas Pickup"
        description="Tugas pengambilan dari organisasi mitra aktif Anda. Perbarui status dan catat material."
      />
      <PickupTaskList tasks={rows} wasteTypes={wasteTypes} />
    </div>
  );
}
