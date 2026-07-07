import type { Metadata } from "next";
import { MetricCard, PageHeader, PagePagination } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { getMinRedemption } from "@/lib/config";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";
import { Clock, Wallet } from "@/components/ui/icons";
import { formatRupiah } from "@/lib/format";
import { RedemptionQueue, type RedemptionAdminRow } from "@/components/admin/RedemptionQueue";

export const metadata: Metadata = { title: "Redemption & Payout" };

export default async function SuperadminRedemptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePageUser(["SUPERADMIN"]);
  const params = await searchParams;
  const pagination = parsePageSearchParams(params);

  const [redemptions, total, minRedemption, queueCount, paidSum] = await Promise.all([
    prisma.redemption.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: { user: { select: { name: true, email: true } } },
    }),
    prisma.redemption.count(),
    getMinRedemption(),
    prisma.redemption.count({
      where: { status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } },
    }),
    prisma.redemption.aggregate({
      where: { status: "SUCCESS" },
      _sum: { amount: true },
    }),
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
      manualTransferProofUrl: r.manualTransferProofUrl,
      createdAt: r.createdAt,
    };
  });

  const pageMeta = buildPaginationMeta(total, pagination);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Redemption & Payout"
        description="Proses permintaan pencairan dan pantau status pembayaran pengguna."
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <MetricCard label="Antrian aktif" value={queueCount} icon={Clock} tone="amber" />
        <MetricCard
          label="Total dibayar"
          value={formatRupiah(paidSum._sum.amount ?? 0)}
          icon={Wallet}
          tone="green"
        />
        <MetricCard
          label="Min. pencairan"
          value={formatRupiah(minRedemption)}
          tone="slate"
          className="col-span-2 sm:col-span-1"
        />
      </div>
      <RedemptionQueue redemptions={rows} />
      <PagePagination
        basePath="/dashboard/superadmin/redemptions"
        page={pageMeta.page}
        totalPages={pageMeta.totalPages}
      />
    </div>
  );
}
