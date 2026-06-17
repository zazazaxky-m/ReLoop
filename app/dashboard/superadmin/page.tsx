import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getMinRedemption } from "@/lib/config";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MetricCard,
  PageHeader,
  buttonVariants,
} from "@/components/ui";
import { Building, FileText, Recycle, Users, Wallet } from "@/components/ui/icons";
import { formatRupiah } from "@/lib/format";

export default async function SuperadminDashboardPage() {
  await requirePageUser(["SUPERADMIN"]);

  const [
    orgCount,
    machineCount,
    userCount,
    depositCount,
    ledgerSum,
    pendingPartners,
    minRedemption,
  ] = await Promise.all([
    prisma.organization.count(),
    prisma.machine.count(),
    prisma.user.count({ where: { role: "USER" } }),
    prisma.depositItem.count({ where: { status: "ACCEPTED" } }),
    prisma.rewardLedger.aggregate({
      where: { entryType: "EARN", status: "AVAILABLE" },
      _sum: { amount: true },
    }),
    prisma.organizationCollectorPartner.count({
      where: { status: "PENDING_SUPERADMIN_APPROVAL" },
    }),
    getMinRedemption(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard Superadmin"
        description="Platform Smart Waste Bank Pangandaran — siap agregasi Jawa Barat."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Organisasi" value={orgCount} icon={Building} />
        <MetricCard label="Mesin" value={machineCount} icon={Recycle} />
        <MetricCard label="Pengguna" value={userCount} icon={Users} />
        <MetricCard
          label="Reward tersedia"
          value={formatRupiah(ledgerSum._sum.amount ?? 0)}
          icon={Wallet}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Item diterima" value={depositCount} />
        <MetricCard label="Kemitraan pending" value={pendingPartners} />
        <MetricCard label="Min. redemption" value={formatRupiah(minRedemption)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Wilayah baseline</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">
            Seed: Jawa Barat → Kabupaten Pangandaran → kecamatan & desa. Model siap
            untuk ekspansi provinsi.
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ekspor Laporan (semua organisasi)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {[
                { type: "deposits", label: "Deposit" },
                { type: "rewards", label: "Reward" },
                { type: "pickups", label: "Pickup" },
              ].map((d) => (
                <a
                  key={d.type}
                  href={`/api/reports?type=${d.type}`}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <FileText className="mr-1.5" />
                  {d.label} CSV
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
