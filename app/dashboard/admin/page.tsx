import Link from "next/link";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MetricCard,
  PageHeader,
  QuickAction,
  StatusBadge,
} from "@/components/ui";
import { FileText, Megaphone, Recycle, Truck, Users } from "@/components/ui/icons";

export default async function AdminDashboardPage() {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId!;

  const [machines, pickups, campaigns, deposits] = await Promise.all([
    prisma.machine.findMany({
      where: { organizationId: orgId },
      orderBy: { name: "asc" },
    }),
    prisma.pickupRequest.findMany({
      where: { organizationId: orgId, status: { not: "COMPLETED" } },
      take: 5,
      include: { machine: { select: { name: true } } },
    }),
    prisma.campaign.count({ where: { organizationId: orgId, status: "ACTIVE" } }),
    prisma.depositSession.count({
      where: { machine: { organizationId: orgId }, status: "COMPLETED" },
    }),
  ]);

  const fullMachines = machines.filter((m) => m.status === "FULL").length;
  const offlineMachines = machines.filter((m) =>
    ["OFFLINE", "ERROR", "MAINTENANCE"].includes(m.status),
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard Admin"
        description="Pantau mesin, pickup, dan aktivitas operasional organisasi."
        actions={
          <Link href="/dashboard/admin/machines">
            <Button variant="secondary">Kelola Mesin</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard label="Mesin" value={machines.length} icon={Recycle} tone="green" />
        <MetricCard label="Mesin penuh" value={fullMachines} icon={Truck} hint="Perlu pickup" tone="amber" />
        <MetricCard label="Perlu perhatian" value={offlineMachines} icon={Recycle} tone="slate" />
        <MetricCard label="Campaign aktif" value={campaigns} icon={Megaphone} tone="blue" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickAction
          href="/dashboard/admin/machines"
          title="Kelola mesin"
          description="Pantau status dan kapasitas."
          icon={Recycle}
        />
        <QuickAction
          href="/dashboard/admin/pickups"
          title="Atur pickup"
          description="Buat dan tetapkan tugas."
          icon={Truck}
          tone="amber"
        />
        <QuickAction
          href="/dashboard/admin/partners"
          title="Mitra pengepul"
          description="Kelola hubungan kemitraan."
          icon={Users}
          tone="teal"
        />
        <QuickAction
          href="/dashboard/admin/reports"
          title="Laporan"
          description="Lihat dan unduh data."
          icon={FileText}
          tone="blue"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status mesin</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {machines.map((m) => (
                <li key={m.id} className="rounded-md border border-border bg-surface-soft/60 px-3 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href={`/dashboard/admin/machines/${m.id}`}
                      className="truncate font-semibold hover:text-brand-700"
                    >
                      {m.name}
                    </Link>
                    <StatusBadge status={m.status} />
                  </div>
                  <div className="mt-2 flex items-center gap-3">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-border">
                      <div
                        className={m.fillLevelPercent >= 80 ? "h-full bg-amber-500" : "h-full bg-brand-500"}
                        style={{ width: `${Math.min(m.fillLevelPercent, 100)}%` }}
                      />
                    </div>
                    <span className="w-9 text-right text-xs font-semibold text-muted">
                      {m.fillLevelPercent}%
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pickup aktif</CardTitle>
          </CardHeader>
          <CardContent>
            {pickups.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">Tidak ada pickup aktif.</p>
            ) : (
              <ul className="space-y-2">
                {pickups.map((p) => (
                  <li key={p.id} className="flex items-center justify-between rounded-md border border-border px-3 py-3 text-sm">
                    <span className="font-semibold">{p.machine?.name ?? "Pickup manual"}</span>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-muted">
              Total sesi selesai organisasi: {deposits}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
