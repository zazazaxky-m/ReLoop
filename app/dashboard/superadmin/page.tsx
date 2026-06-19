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
  QuickAction,
  buttonVariants,
} from "@/components/ui";
import { AlertTriangle, Building, FileText, Recycle, Settings, Users, Wallet } from "@/components/ui/icons";
import { formatRupiah } from "@/lib/format";
import { SecurityEventList } from "@/components/security/SecurityEventList";
import { getSecurityEvents, getSecuritySummary } from "@/lib/security-events";

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
    securitySummary,
    recentSecurityEvents,
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
    getSecuritySummary(),
    getSecurityEvents({ take: 4 }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard Superadmin"
        description="Pantau operasional, pengguna, organisasi, dan reward dalam satu ringkasan."
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <MetricCard label="Organisasi" value={orgCount} icon={Building} tone="green" />
        <MetricCard label="Mesin" value={machineCount} icon={Recycle} tone="teal" />
        <MetricCard label="Pengguna" value={userCount} icon={Users} tone="blue" />
        <MetricCard
          label="Reward tersedia"
          value={formatRupiah(ledgerSum._sum.amount ?? 0)}
          icon={Wallet}
          tone="amber"
        />
      </div>

      <Card className={securitySummary.alerts24h ? "border-amber-300 bg-amber-50/40" : ""}>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle>Peringatan Fraud & Vandalisme</CardTitle>
              <p className="mt-1 text-sm text-muted">
                {securitySummary.alerts24h
                  ? `${securitySummary.alerts24h} alert terdeteksi dalam 24 jam terakhir.`
                  : "Tidak ada alert dalam 24 jam terakhir."}
              </p>
            </div>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-100 text-xl text-amber-700">
              <AlertTriangle />
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <SecurityEventList events={recentSecurityEvents} compact />
          <a
            href="/dashboard/superadmin/security"
            className={buttonVariants({ variant: "outline", size: "sm", className: "mt-4" })}
          >
            Buka seluruh log keamanan
          </a>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickAction
          href="/dashboard/superadmin/organizations"
          title="Organisasi"
          description="Kelola cakupan dan status."
          icon={Building}
        />
        <QuickAction
          href="/dashboard/superadmin/machines"
          title="Mesin"
          description="Pantau seluruh unit."
          icon={Recycle}
          tone="teal"
        />
        <QuickAction
          href="/dashboard/superadmin/users"
          title="Pengguna"
          description="Atur akun dan peran."
          icon={Users}
          tone="blue"
        />
        <QuickAction
          href="/dashboard/superadmin/config"
          title="Konfigurasi"
          description="Atur kebijakan sistem."
          icon={Settings}
          tone="amber"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <MetricCard label="Item diterima" value={depositCount} tone="teal" />
        <MetricCard label="Kemitraan pending" value={pendingPartners} tone="amber" />
        <MetricCard
          label="Min. pencairan"
          value={formatRupiah(minRedemption)}
          tone="slate"
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cakupan wilayah</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-6 text-muted">
              Struktur wilayah mencakup provinsi, kabupaten atau kota,
              kecamatan, serta desa atau kelurahan di seluruh Indonesia.
            </p>
            <div className="mt-4 flex items-center gap-3 border-t border-border pt-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <Building />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
                  Organisasi terdaftar
                </p>
                <p className="text-xl font-bold text-foreground">{orgCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ekspor Laporan (semua organisasi)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm leading-6 text-muted">
              Unduh data operasional untuk analisis atau kebutuhan administrasi.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              {[
                { type: "deposits", label: "Deposit" },
                { type: "rewards", label: "Reward" },
                { type: "pickups", label: "Pickup" },
              ].map((d) => (
                <a
                  key={d.type}
                  href={`/api/reports?type=${d.type}`}
                  className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}
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
