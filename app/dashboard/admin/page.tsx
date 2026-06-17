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
  StatusBadge,
} from "@/components/ui";
import { Megaphone, Recycle, Truck } from "@/components/ui/icons";

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
        description={user.organizationName ?? "Organisasi Anda"}
        actions={
          <Link href="/dashboard/admin/machines">
            <Button variant="secondary">Kelola Mesin</Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Mesin" value={machines.length} icon={Recycle} />
        <MetricCard label="Mesin penuh" value={fullMachines} icon={Truck} hint="Perlu pickup" />
        <MetricCard label="Offline/error" value={offlineMachines} />
        <MetricCard label="Campaign aktif" value={campaigns} icon={Megaphone} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Status mesin</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {machines.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                  <Link
                    href={`/dashboard/admin/machines/${m.id}`}
                    className="font-medium hover:text-brand-600"
                  >
                    {m.name}
                  </Link>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted">{m.fillLevelPercent}%</span>
                    <StatusBadge status={m.status} />
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
              <p className="text-sm text-muted">Tidak ada pickup pending.</p>
            ) : (
              <ul className="divide-y divide-border">
                {pickups.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <span>{p.machine?.name ?? "Manual"}</span>
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
