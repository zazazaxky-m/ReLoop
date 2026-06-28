import Link from "next/link";
import { requirePageUser } from "@/lib/rbac";
import { getWalletBalance, getLedgerHistory } from "@/lib/ledger";
import { prisma } from "@/lib/prisma";
import { isCampaignEligible } from "@/lib/campaign";
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
import {
  ArrowUpRight,
  Coins,
  Map,
  Megaphone,
  QrCode,
  Recycle,
  Wallet,
} from "@/components/ui/icons";
import { formatDateTime, formatRupiah } from "@/lib/format";

export default async function UserDashboardPage() {
  const user = await requirePageUser(["USER"]);
  const [balance, sessions, campaigns, ledger] = await Promise.all([
    getWalletBalance(user.id),
    prisma.depositSession.findMany({
      where: { userId: user.id },
      include: {
        machine: { select: { name: true, machineCode: true } },
        _count: { select: { items: true } },
      },
      orderBy: { startedAt: "desc" },
      take: 5,
    }),
    prisma.campaign.findMany({
      where: { status: "ACTIVE" },
      include: { organization: { select: { name: true } } },
      take: 6,
    }),
    getLedgerHistory(user.id, 5),
  ]);

  const eligibleCampaigns = campaigns.filter((campaign) =>
    isCampaignEligible(campaign, user.email).eligible,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Halo, ${user.name.split(" ")[0]}!`}
        description="Pantau aktivitas setor, saldo reward, dan program yang sedang berlangsung."
        actions={
          <Link href="/scan">
            <Button>
              <QrCode />
              Scan Mesin
            </Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <MetricCard
          label="Saldo tersedia"
          value={formatRupiah(balance.available)}
          hint={
            balance.pending > 0
              ? `+${formatRupiah(balance.pending)} menunggu tinjauan`
              : undefined
          }
          icon={Wallet}
          tone="green"
          className="col-span-2 lg:col-span-1"
        />
        <MetricCard
          label="Total diperoleh"
          value={formatRupiah(balance.totalEarned)}
          icon={Coins}
          tone="amber"
        />
        <MetricCard
          label="Campaign aktif"
          value={eligibleCampaigns.length}
          icon={Megaphone}
          tone="blue"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickAction
          href="/scan"
          title="Scan mesin"
          description="Mulai sesi setor dengan QR."
          icon={QrCode}
        />
        <QuickAction
          href="/map"
          title="Cari mesin"
          description="Lihat lokasi dan kapasitas."
          icon={Map}
          tone="teal"
        />
        <QuickAction
          href="/dashboard/user/wallet"
          title="Dompet"
          description="Kelola saldo dan pencairan."
          icon={Wallet}
          tone="amber"
        />
        <QuickAction
          href="/dashboard/user/campaigns"
          title="Program"
          description="Lihat program yang tersedia."
          icon={Megaphone}
          tone="blue"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Sesi setor terakhir</CardTitle>
          </CardHeader>
          <CardContent>
            {sessions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Belum ada sesi setor.
              </p>
            ) : (
              <ul className="space-y-2">
                {sessions.map((session) => (
                  <li
                    key={session.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-soft/70 px-3 py-3 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">
                        {session.machine.name}
                      </span>
                      <span className="flex flex-wrap gap-x-2 text-xs text-muted">
                        <span>{formatDateTime(session.startedAt)}</span>
                        <span>{session._count.items} item</span>
                      </span>
                    </span>
                    <StatusBadge status={session.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Campaign untuk Anda</CardTitle>
          </CardHeader>
          <CardContent>
            {eligibleCampaigns.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Tidak ada campaign aktif saat ini.
              </p>
            ) : (
              <ul className="space-y-2">
                {eligibleCampaigns.slice(0, 4).map((campaign) => (
                  <li
                    key={campaign.id}
                    className="rounded-md border border-brand-100 bg-brand-50/70 px-3 py-2.5 text-sm"
                  >
                    <p className="font-semibold text-brand-800">
                      {campaign.name}
                    </p>
                    <p className="text-xs text-muted">
                      {campaign.organization.name}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Riwayat reward</CardTitle>
          </CardHeader>
          <CardContent>
            {ledger.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">
                Belum ada riwayat reward.
              </p>
            ) : (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {ledger.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between rounded-md border border-border px-3 py-3 text-sm"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Recycle className="shrink-0 text-brand-600" />
                      <span className="truncate">
                        {entry.depositItem?.wasteType?.name ?? entry.entryType}
                      </span>
                    </span>
                    <span className="ml-3 shrink-0 font-bold text-brand-700">
                      {formatRupiah(entry.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/dashboard/user/wallet"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700"
            >
              Lihat dompet lengkap <ArrowUpRight />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
