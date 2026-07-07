import type { Metadata } from "next";
import { PageHeader, PagePagination } from "@/components/ui";
import { MachineManager } from "@/components/machine/MachineManager";
import { MachineListTable } from "@/components/machine/MachineListTable";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { wasteTypeOptions, regionOptions, organizationOptions } from "@/lib/queries";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";

export const metadata: Metadata = { title: "Semua Mesin" };

export default async function SuperadminMachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePageUser(["SUPERADMIN"]);
  const params = await searchParams;
  const pagination = parsePageSearchParams(params);

  const [machines, total, wasteTypes, regions, organizations] = await Promise.all([
    prisma.machine.findMany({
      include: {
        organization: { select: { name: true } },
        region: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.machine.count(),
    wasteTypeOptions(),
    regionOptions(),
    organizationOptions(),
  ]);

  const pageMeta = buildPaginationMeta(total, pagination);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Semua Mesin"
        description="Pantau seluruh mesin, status, kapasitas, dan organisasi pengelolanya."
      />
      <MachineManager
        wasteTypes={wasteTypes}
        organizations={organizations}
        regions={regions}
      />
      <MachineListTable
        machines={machines.map((m) => ({
          id: m.id,
          machineCode: m.machineCode,
          name: m.name,
          status: m.status,
          fillLevelPercent: m.fillLevelPercent,
          organizationName: m.organization?.name ?? null,
          regionName: m.region?.name ?? null,
          lastHeartbeatAt: m.lastHeartbeatAt,
        }))}
        detailBase="/dashboard/superadmin/machines"
        showOrg
      />
      <PagePagination
        basePath="/dashboard/superadmin/machines"
        page={pageMeta.page}
        totalPages={pageMeta.totalPages}
      />
    </div>
  );
}
