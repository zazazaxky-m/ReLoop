import type { Metadata } from "next";
import { PageHeader, PagePagination } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { displayUserField } from "@/lib/display-user";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";
import { PickupManager, type PickupRow } from "@/components/pickup/PickupManager";

export const metadata: Metadata = { title: "Pickup" };

export default async function AdminPickupsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";
  const params = await searchParams;
  const pagination = parsePageSearchParams(params, { defaultLimit: 50 });

  const pickupWhere = { organizationId: orgId };

  const [pickups, total, machines, partners] = await Promise.all([
    prisma.pickupRequest.findMany({
      where: pickupWhere,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        machine: { select: { name: true, machineCode: true } },
        assignedCollector: { select: { name: true } },
        _count: { select: { items: true } },
      },
    }),
    prisma.pickupRequest.count({ where: pickupWhere }),
    prisma.machine.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
      take: 200,
    }),
    prisma.organizationCollectorPartner.findMany({
      where: { organizationId: orgId, status: "ACTIVE" },
      include: { collectorUser: { select: { id: true, name: true } } },
      take: 100,
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

  const pageMeta = buildPaginationMeta(total, pagination);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pickup Request"
        description="Jadwalkan pengambilan, tetapkan pengepul, dan pantau progresnya."
      />
      <PickupManager pickups={rows} machines={machines} activePartners={activePartners} />
      <PagePagination
        basePath="/dashboard/admin/pickups"
        page={pageMeta.page}
        totalPages={pageMeta.totalPages}
      />
    </div>
  );
}
