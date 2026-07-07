import type { Metadata } from "next";
import { Card, CardContent, PageHeader, PagePagination } from "@/components/ui";
import { MachineListTable } from "@/components/machine/MachineListTable";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";

export const metadata: Metadata = { title: "Mesin" };

export default async function AdminMachinesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";
  const params = await searchParams;
  const pagination = parsePageSearchParams(params);

  const where = { organizationId: orgId };

  const [machines, total] = await Promise.all([
    prisma.machine.findMany({
      where,
      include: { region: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.machine.count({ where }),
  ]);

  const pageMeta = buildPaginationMeta(total, pagination);

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
      <PagePagination
        basePath="/dashboard/admin/machines"
        page={pageMeta.page}
        totalPages={pageMeta.totalPages}
      />
    </div>
  );
}
