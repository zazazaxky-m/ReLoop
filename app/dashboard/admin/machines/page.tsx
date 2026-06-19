import type { Metadata } from "next";
import { Card, CardContent, PageHeader } from "@/components/ui";
import { MachineListTable } from "@/components/machine/MachineListTable";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Mesin" };

export default async function AdminMachinesPage() {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";

  const machines = await prisma.machine.findMany({
    where: { organizationId: orgId },
    include: { region: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mesin Organisasi"
        description="Pantau status, kapasitas, dan konfigurasi mesin organisasi."
      />
      <Card className="border-dashed">
        <CardContent className="py-4 text-sm text-muted">
          Unit mesin baru didaftarkan oleh <strong>superadmin</strong>. Hubungi
          pengelola sistem untuk menambahkan mesin ke organisasi Anda.
        </CardContent>
      </Card>
      <MachineListTable
        machines={machines.map((m) => ({
          id: m.id,
          machineCode: m.machineCode,
          name: m.name,
          status: m.status,
          fillLevelPercent: m.fillLevelPercent,
          regionName: m.region?.name ?? null,
          lastHeartbeatAt: m.lastHeartbeatAt,
        }))}
        detailBase="/dashboard/admin/machines"
      />
    </div>
  );
}
