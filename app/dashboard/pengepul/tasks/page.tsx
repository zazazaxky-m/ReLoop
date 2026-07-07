import type { Metadata } from "next";
import { PageHeader, PagePagination } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { wasteTypeOptions } from "@/lib/queries";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";
import { PickupTaskList, type TaskRow } from "@/components/pickup/PickupTaskList";

export const metadata: Metadata = { title: "Tugas Pickup" };

export default async function PengepulTasksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requirePageUser(["PENGEPUL"]);
  const params = await searchParams;
  const pagination = parsePageSearchParams(params, { defaultLimit: 25 });

  const where = { assignedCollectorId: user.id };

  const [pickups, total, wasteTypes] = await Promise.all([
    prisma.pickupRequest.findMany({
      where,
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        machine: { select: { name: true, machineCode: true } },
        organization: {
          select: { name: true, address: true, contactName: true, contactPhone: true },
        },
        items: { include: { wasteType: { select: { name: true } } } },
      },
    }),
    prisma.pickupRequest.count({ where }),
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

  const pageMeta = buildPaginationMeta(total, pagination);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tugas Pickup"
        description="Lihat tugas pengambilan, perbarui progres, dan catat material."
      />
      <PickupTaskList tasks={rows} wasteTypes={wasteTypes} />
      <PagePagination
        basePath="/dashboard/pengepul/tasks"
        page={pageMeta.page}
        totalPages={pageMeta.totalPages}
      />
    </div>
  );
}
