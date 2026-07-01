import { requirePageUser } from "@/lib/rbac";
import { getWalletBalance, getLedgerHistory } from "@/lib/ledger";
import { CONFIG_KEYS, getConfigInt, getMinRedemption } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { formatRewardPoints } from "@/lib/reward-points";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MetricCard,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { Clock, Coins, Wallet } from "@/components/ui/icons";
import { formatDateTime, formatRupiah } from "@/lib/format";
import {
  WalletPanel,
  type AccountRow,
  type RedemptionRow,
} from "@/components/wallet/WalletPanel";

export default async function UserWalletPage() {
  const user = await requirePageUser(["USER"]);
  const [
    balance,
    history,
    accounts,
    redemptions,
    minRedemption,
    travelAgentLinkCount,
    pointsToRupiah,
  ] = await Promise.all([
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
    prisma.travelAgentUser.count({ where: { userId: user.id } }),
    getConfigInt(CONFIG_KEYS.POINTS_TO_RUPIAH),
  ]);

  const isTravelAgentUser = travelAgentLinkCount > 0;

  const accountRows: AccountRow[] = accounts.map((account) => ({
    id: account.id,
    provider: account.provider,
    accountIdentifier: account.accountIdentifier,
    accountName: account.accountName,
    status: account.status,
  }));

  const redemptionRows: RedemptionRow[] = redemptions.map((redemption) => ({
    id: redemption.id,
    amount: redemption.amount,
    provider: redemption.provider,
    status: redemption.status,
    note: redemption.note,
    createdAt: redemption.createdAt,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dompet Reward"
        description="Kelola saldo reward, akun pencairan, dan riwayat transaksi."
      />

      <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${isTravelAgentUser ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
        <MetricCard
          label="Tersedia"
          value={formatRupiah(balance.available)}
          icon={Wallet}
          tone="green"
          className="col-span-2 sm:col-span-1"
        />
        {isTravelAgentUser ? (
          <MetricCard
            label="Poin"
            value={formatRewardPoints(balance.available, pointsToRupiah)}
            hint="Setara saldo tersedia"
            icon={Coins}
            tone="teal"
          />
        ) : null}
        <MetricCard
          label="Pending"
          value={formatRupiah(balance.pending)}
          icon={Clock}
          tone="amber"
        />
        <MetricCard
          label="Direservasi"
          value={formatRupiah(balance.reserved)}
          hint="Pencairan diproses"
          tone="blue"
        />
        <MetricCard
          label="Sudah dicairkan"
          value={formatRupiah(balance.redeemed)}
          icon={Coins}
          tone="teal"
        />
      </div>

      <WalletPanel
        accounts={accountRows}
        redemptions={redemptionRows}
        available={balance.available}
        minRedemption={minRedemption}
      />

      <Card>
        <CardHeader>
          <CardTitle>Riwayat transaksi</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">
              Belum ada riwayat transaksi.
            </p>
          ) : (
            <ul className="grid gap-2 lg:grid-cols-2">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {entry.entryType} · {formatRupiah(entry.amount)}
                    </p>
                    <p className="flex flex-wrap gap-x-2 text-xs text-muted">
                      <span>{formatDateTime(entry.createdAt)}</span>
                      {entry.session?.machine ? (
                        <span>{entry.session.machine.name}</span>
                      ) : null}
                    </p>
                  </div>
                  <StatusBadge status={entry.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
