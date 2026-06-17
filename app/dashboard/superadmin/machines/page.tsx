import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { MachineManager } from "@/components/machine/MachineManager";
import { MachineListTable } from "@/components/machine/MachineListTable";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { wasteTypeOptions, regionOptions, organizationOptions } from "@/lib/queries";

export const metadata: Metadata = { title: "Semua Mesin" };

export default async function SuperadminMachinesPage() {
  await requirePageUser(["SUPERADMIN"]);

  const [machines, wasteTypes, regions, organizations] = await Promise.all([
    prisma.machine.findMany({
      include: {
        organization: { select: { name: true } },
        region: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    wasteTypeOptions(),
    regionOptions(),
    organizationOptions(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Semua Mesin"
        description="Seluruh mesin lintas organisasi pada platform."
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
    </div>
  );
}
