import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, buttonVariants } from "@/components/ui";
import { MachineDetailView } from "@/components/machine/MachineDetailView";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { wasteTypeOptions, regionOptions } from "@/lib/queries";
import { getSecurityEvents } from "@/lib/security-events";

export const metadata: Metadata = { title: "Detail Mesin" };

export default async function SuperadminMachineDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requirePageUser(["SUPERADMIN"]);
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
  if (!machine) notFound();

  const [wasteTypes, regions, securityEvents] = await Promise.all([
    wasteTypeOptions(machine.organizationId),
    regionOptions(),
    getSecurityEvents({ machineId: machine.id, take: 20 }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={machine.name}
        description={`Kode mesin: ${machine.machineCode} | Organisasi: ${machine.organization?.name ?? "-"}`}
        actions={
          <Link
            href="/dashboard/superadmin/machines"
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
        listHref="/dashboard/superadmin/machines"
        ingestSecret={machine.ingestSecret ?? null}
        securityEvents={securityEvents}
      />
    </div>
  );
}
