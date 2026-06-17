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
  StatusBadge,
} from "@/components/ui";
import { Coins, Megaphone, QrCode, Recycle, Wallet } from "@/components/ui/icons";
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

  const eligibleCampaigns = campaigns.filter((c) =>
    isCampaignEligible(c, user.email).eligible,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Halo, ${user.name.split(" ")[0]}!`}
        description="Setor sampah, kumpulkan reward, dan ikuti campaign lingkungan."
        actions={
          <Link href="/scan">
            <Button>
              <QrCode className="mr-2" />
              Scan Mesin
            </Button>
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard
          label="Saldo tersedia"
          value={formatRupiah(balance.available)}
          hint={balance.pending > 0 ? `+${formatRupiah(balance.pending)} pending review` : undefined}
          icon={Wallet}
        />
        <MetricCard
          label="Total diperoleh"
          value={formatRupiah(balance.totalEarned)}
          icon={Coins}
        />
        <MetricCard
          label="Campaign aktif"
          value={eligibleCampaigns.length}
          icon={Megaphone}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sesi setor terakhir</CardTitle>
        </CardHeader>
        <CardContent>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted">Belum ada sesi setor.</p>
          ) : (
            <ul className="divide-y divide-border">
              {sessions.map((s) => (
                <li key={s.id} className="flex items-center justify-between py-3 text-sm">
                  <span>
                    <span className="font-medium">{s.machine.name}</span>
                    <span className="block text-xs text-muted">
                      {formatDateTime(s.startedAt)} · {s._count.items} item
                    </span>
                  </span>
                  <StatusBadge status={s.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Campaign untuk Anda</CardTitle>
          </CardHeader>
          <CardContent>
            {eligibleCampaigns.length === 0 ? (
              <p className="text-sm text-muted">Tidak ada campaign aktif saat ini.</p>
            ) : (
              <ul className="space-y-3">
                {eligibleCampaigns.slice(0, 4).map((c) => (
                  <li key={c.id} className="rounded-xl bg-mint/60 px-3 py-2 text-sm">
                    <p className="font-medium text-brand-800">{c.name}</p>
                    <p className="text-xs text-muted">{c.organization.name}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Riwayat reward</CardTitle>
          </CardHeader>
          <CardContent>
            {ledger.length === 0 ? (
              <p className="text-sm text-muted">Belum ada entri ledger.</p>
            ) : (
              <ul className="divide-y divide-border">
                {ledger.map((e) => (
                  <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <Recycle className="text-brand-500" />
                      {e.depositItem?.wasteType?.name ?? e.entryType}
                    </span>
                    <span className="font-medium text-brand-700">
                      {formatRupiah(e.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/dashboard/user/wallet" className="mt-3 inline-block text-sm text-brand-600">
              Lihat dompet lengkap →
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
