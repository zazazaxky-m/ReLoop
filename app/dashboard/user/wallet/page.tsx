import { requirePageUser } from "@/lib/rbac";
import { getWalletBalance, getLedgerHistory } from "@/lib/ledger";
import { getMinRedemption } from "@/lib/config";
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
import { Wallet } from "@/components/ui/icons";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { WalletPanel, type AccountRow, type RedemptionRow } from "@/components/wallet/WalletPanel";

export default async function UserWalletPage() {
  const user = await requirePageUser(["USER"]);
  const [balance, history, accounts, redemptions, minRedemption] = await Promise.all([
    getWalletBalance(user.id),
    getLedgerHistory(user.id, 30),
    prisma.payoutAccount.findMany({
      where: { userId: user.id, status: { not: "DISABLED" } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.redemption.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    getMinRedemption(),
  ]);

  const accountRows: AccountRow[] = accounts.map((a) => ({
    id: a.id,
    provider: a.provider,
    accountIdentifier: a.accountIdentifier,
    accountName: a.accountName,
    status: a.status,
  }));

  const redemptionRows: RedemptionRow[] = redemptions.map((r) => ({
    id: r.id,
    amount: r.amount,
    provider: r.provider,
    status: r.status,
    note: r.note,
    createdAt: r.createdAt,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dompet Reward"
        description="Saldo dihitung dari ledger append-only. Pencairan via transfer manual superadmin."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Tersedia" value={formatRupiah(balance.available)} icon={Wallet} />
        <MetricCard label="Pending review" value={formatRupiah(balance.pending)} />
        <MetricCard label="Direservasi" value={formatRupiah(balance.reserved)} hint="Pencairan diproses" />
        <MetricCard label="Sudah dicairkan" value={formatRupiah(balance.redeemed)} />
      </div>

      <WalletPanel
        accounts={accountRows}
        redemptions={redemptionRows}
        available={balance.available}
        minRedemption={minRedemption}
      />

      <Card>
        <CardHeader>
          <CardTitle>Riwayat ledger</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {history.map((e) => (
              <li key={e.id} className="flex items-center justify-between py-3 text-sm">
                <div>
                  <p className="font-medium">
                    {e.entryType} · {formatRupiah(e.amount)}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDateTime(e.createdAt)}
                    {e.session?.machine
                      ? ` · ${e.session.machine.name}`
                      : ""}
                  </p>
                </div>
                <StatusBadge status={e.status} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
