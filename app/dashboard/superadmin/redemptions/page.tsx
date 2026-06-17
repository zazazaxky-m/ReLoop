import type { Metadata } from "next";
import { MetricCard, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getMinRedemption } from "@/lib/config";
import { Clock, Wallet } from "@/components/ui/icons";
import { formatRupiah } from "@/lib/format";
import { RedemptionQueue, type RedemptionAdminRow } from "@/components/admin/RedemptionQueue";

export const metadata: Metadata = { title: "Redemption & Payout" };

export default async function SuperadminRedemptionsPage() {
  await requirePageUser(["SUPERADMIN"]);

  const [redemptions, minRedemption] = await Promise.all([
    prisma.redemption.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      include: { user: { select: { name: true, email: true } } },
    }),
    getMinRedemption(),
  ]);

  const accountIds = redemptions
    .map((r) => r.payoutAccountId)
    .filter((x): x is string => Boolean(x));
  const accounts = accountIds.length
    ? await prisma.payoutAccount.findMany({ where: { id: { in: accountIds } } })
    : [];
  const accById = new Map(accounts.map((a) => [a.id, a]));

  const rows: RedemptionAdminRow[] = redemptions.map((r) => {
    const acc = r.payoutAccountId ? accById.get(r.payoutAccountId) : null;
    return {
      id: r.id,
      userName: r.user.name,
      userEmail: r.user.email,
      amount: r.amount,
      provider: r.provider,
      accountIdentifier: acc?.accountIdentifier ?? null,
      accountName: acc?.accountName ?? null,
      status: r.status,
      note: r.note,
      createdAt: r.createdAt,
    };
  });

  const queueCount = rows.filter((r) =>
    ["REQUESTED", "APPROVED", "PROCESSING"].includes(r.status),
  ).length;
  const paidTotal = rows
    .filter((r) => r.status === "SUCCESS")
    .reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Redemption & Payout"
        description="Antrian transfer manual ke e-wallet pengguna. Tandai status setelah transfer — upload bukti tidak wajib."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Antrian aktif" value={queueCount} icon={Clock} />
        <MetricCard label="Total dibayar" value={formatRupiah(paidTotal)} icon={Wallet} />
        <MetricCard label="Min. redemption" value={formatRupiah(minRedemption)} />
      </div>
      <RedemptionQueue redemptions={rows} />
    </div>
  );
}
