import { requirePageUser, activePartnerOrgIds } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MetricCard,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { MapPin, Recycle, Truck } from "@/components/ui/icons";

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
        description="Tugas pickup dan mesin penuh dari organisasi mitra aktif."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Mitra aktif" value={partnerships.length} icon={MapPin} />
        <MetricCard label="Tugas aktif" value={tasks.length} icon={Truck} />
        <MetricCard label="Mesin penuh" value={fullMachines.length} icon={Recycle} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tugas pickup</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <p className="text-sm text-muted">Tidak ada tugas pickup saat ini.</p>
          ) : (
            <ul className="divide-y divide-border">
              {tasks.map((t) => (
                <li key={t.id} className="py-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {t.machine?.name ?? t.organization.name}
                    </span>
                    <StatusBadge status={t.status} />
                  </div>
                  <p className="text-xs text-muted">
                    {t.organization.name}
                    {t.organization.contactPhone
                      ? ` · ${t.organization.contactPhone}`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mesin penuh (mitra aktif)</CardTitle>
        </CardHeader>
        <CardContent>
          {fullMachines.length === 0 ? (
            <p className="text-sm text-muted">Tidak ada mesin penuh.</p>
          ) : (
            <ul className="divide-y divide-border">
              {fullMachines.map((m) => (
                <li key={m.id} className="flex justify-between py-2 text-sm">
                  <span>
                    {m.name}
                    <span className="block text-xs text-muted">
                      {m.organization.name} · {m.fillLevelPercent}%
                    </span>
                  </span>
                  <StatusBadge status={m.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
