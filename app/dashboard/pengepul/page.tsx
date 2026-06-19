import { requirePageUser, activePartnerOrgIds } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MetricCard,
  PageHeader,
  QuickAction,
  StatusBadge,
} from "@/components/ui";
import { Map, MapPin, Recycle, Truck, User } from "@/components/ui/icons";

export default async function PengepulDashboardPage() {
  const user = await requirePageUser(["PENGEPUL"]);
  const orgIds = await activePartnerOrgIds(user.id);

  const [tasks, fullMachines, partnerships] = await Promise.all([
    prisma.pickupRequest.findMany({
      where: {
        assignedCollectorId: user.id,
        status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] },
      },
      include: {
        machine: { select: { name: true, machineCode: true } },
        organization: { select: { name: true, contactPhone: true } },
      },
      take: 10,
    }),
    prisma.machine.findMany({
      where: {
        organizationId: { in: orgIds },
        status: "FULL",
      },
      include: { organization: { select: { name: true } } },
    }),
    prisma.organizationCollectorPartner.findMany({
      where: { collectorUserId: user.id, status: "ACTIVE" },
      include: { organization: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard Pengepul"
        description="Pantau tugas pengambilan dan mesin yang membutuhkan penanganan."
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <MetricCard
          label="Tugas aktif"
          value={tasks.length}
          icon={Truck}
          tone="amber"
          className="col-span-2 lg:col-span-1"
        />
        <MetricCard
          label="Mitra aktif"
          value={partnerships.length}
          icon={MapPin}
          tone="teal"
        />
        <MetricCard
          label="Mesin penuh"
          value={fullMachines.length}
          icon={Recycle}
          tone="blue"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickAction
          href="/dashboard/pengepul/tasks"
          title="Tugas pickup"
          description="Lihat dan perbarui tugas."
          icon={Truck}
          tone="amber"
        />
        <QuickAction
          href="/dashboard/pengepul/map"
          title="Peta mesin"
          description="Cari mesin organisasi mitra."
          icon={Map}
          tone="blue"
        />
        <QuickAction
          href="/dashboard/pengepul/area"
          title="Area layanan"
          description="Kelola wilayah dan mitra."
          icon={MapPin}
          tone="teal"
        />
        <QuickAction
          href="/dashboard/pengepul/profile"
          title="Profil"
          description="Periksa informasi kontak."
          icon={User}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Tugas pickup</CardTitle>
          </CardHeader>
          <CardContent>
            {tasks.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Tidak ada tugas pickup saat ini.
              </p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className="rounded-md border border-border bg-slate-50/60 px-3 py-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate font-semibold">
                        {task.machine?.name ?? task.organization.name}
                      </span>
                      <StatusBadge status={task.status} />
                    </div>
                    <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
                      <span>{task.organization.name}</span>
                      {task.organization.contactPhone ? (
                        <span>{task.organization.contactPhone}</span>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mesin penuh dari mitra</CardTitle>
          </CardHeader>
          <CardContent>
            {fullMachines.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Tidak ada mesin penuh.
              </p>
            ) : (
              <ul className="space-y-2">
                {fullMachines.map((machine) => (
                  <li
                    key={machine.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-3 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {machine.name}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
                        <span>{machine.organization.name}</span>
                        <span>{machine.fillLevelPercent}% terisi</span>
                      </span>
                    </span>
                    <StatusBadge status={machine.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
