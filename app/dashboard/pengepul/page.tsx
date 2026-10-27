import type { PickupStatus } from "@prisma/client";
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
import { MapPin, Recycle, Truck } from "@/components/ui/icons";

export default async function PengepulDashboardPage() {
  const user = await requirePageUser(["PENGEPUL"]);
  const orgIds = await activePartnerOrgIds(user.id);
  const orgFilter = { organizationId: { in: orgIds.length ? orgIds : ["__none__"] } };
  const closedPickupStatuses: PickupStatus[] = ["COMPLETED", "CANCELLED", "FAILED"];
  const taskWhere = {
    assignedCollectorId: user.id,
    status: { notIn: closedPickupStatuses },
  };

  const [tasks, taskCount, fullMachines, fullMachineCount, _partnerships, partnerCount] =
    await Promise.all([
    prisma.pickupRequest.findMany({
      where: taskWhere,
      include: {
        machine: { select: { name: true, machineCode: true } },
        organization: { select: { name: true, contactPhone: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
    }),
    prisma.pickupRequest.count({ where: taskWhere }),
    prisma.machine.findMany({
      where: {
        ...orgFilter,
        status: "FULL",
      },
      include: { organization: { select: { name: true } } },
      orderBy: { fillLevelPercent: "desc" },
      take: 30,
    }),
    prisma.machine.count({
      where: { ...orgFilter, status: "FULL" },
    }),
    prisma.organizationCollectorPartner.findMany({
      where: { collectorUserId: user.id, status: "ACTIVE" },
      include: { organization: { select: { name: true } } },
      take: 50,
    }),
    prisma.organizationCollectorPartner.count({
      where: { collectorUserId: user.id, status: "ACTIVE" },
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
          value={taskCount}
          icon={Truck}
          tone="amber"
          className="col-span-2 lg:col-span-1"
        />
        <MetricCard
          label="Mitra aktif"
          value={partnerCount}
          icon={MapPin}
          tone="teal"
        />
        <MetricCard
          label="Mesin penuh"
          value={fullMachineCount}
          icon={Recycle}
          tone="blue"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickAction
          href="/dashboard/pengepul/tasks"
          title="Tugas pickup"
          description="Lihat dan perbarui tugas."
          index={1}
        />
        <QuickAction
          href="/dashboard/pengepul/map"
          title="Peta mesin"
          description="Cari mesin organisasi mitra."
          index={2}
        />
        <QuickAction
          href="/dashboard/pengepul/area"
          title="Area layanan"
          description="Kelola wilayah dan mitra."
          index={3}
        />
        <QuickAction
          href="/dashboard/pengepul/profile"
          title="Profil"
          description="Periksa informasi kontak."
          index={4}
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
                Belum ada tugas. Menunggu penugasan admin.
              </p>
            ) : (
              <ul className="space-y-2">
                {tasks.map((task) => (
                  <li
                    key={task.id}
                    className="rounded-md border border-border bg-surface-soft/60 px-3 py-3 text-sm"
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
