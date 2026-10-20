import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, buttonVariants } from "@/components/ui";
import { MachineDetailView } from "@/components/machine/MachineDetailView";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { wasteTypeOptions, regionOptions } from "@/lib/queries";
import { getMachineSyncStatus } from "@/lib/machine-sync-status";

export const metadata: Metadata = { title: "Detail Mesin" };

export default async function AdminMachineDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePageUser(["ADMIN"]);
  const { id } = await params;

  const machine = await prisma.machine.findUnique({
    where: { id },
    include: {
      organization: { select: { id: true, name: true } },
      region: { select: { id: true, name: true } },
      wasteTypes: { include: { wasteType: { select: { id: true, name: true } } } },
      sessions: { orderBy: { startedAt: "desc" }, take: 8 },
    },
  });
  if (!machine || machine.organizationId !== user.organizationId) notFound();

  const [wasteTypes, regions, syncStatus] = await Promise.all([
    wasteTypeOptions(user.organizationId),
    regionOptions(),
    getMachineSyncStatus(machine.id),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={machine.name}
        description={`Kode mesin: ${machine.machineCode}`}
        actions={
          <Link
            href="/dashboard/admin/machines"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Kembali
          </Link>
        }
      />
      <MachineDetailView
        machine={machine}
        wasteTypes={wasteTypes}
        regions={regions}
        listHref="/dashboard/admin/machines"
        syncStatus={syncStatus}
      />
    </div>
  );
}
