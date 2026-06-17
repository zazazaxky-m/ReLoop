import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MetricCard,
  PageHeader,
  buttonVariants,
} from "@/components/ui";
import { Coins, FileText, Recycle, Truck } from "@/components/ui/icons";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { formatRupiah } from "@/lib/format";

export const metadata: Metadata = { title: "Laporan" };

export default async function AdminReportsPage() {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";

  const [deposits, rewardAgg, pickupsDone] = await Promise.all([
    prisma.depositItem.count({
      where: { status: "ACCEPTED", session: { machine: { organizationId: orgId } } },
    }),
    prisma.rewardLedger.aggregate({
      where: { organizationId: orgId, entryType: "EARN" },
      _sum: { amount: true },
    }),
    prisma.pickupRequest.count({ where: { organizationId: orgId, status: "COMPLETED" } }),
  ]);

  const downloads = [
    { type: "deposits", label: "Deposit (CSV)" },
    { type: "rewards", label: "Reward Ledger (CSV)" },
    { type: "pickups", label: "Pickup (CSV)" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laporan Organisasi"
        description="Ringkasan operasional dan ekspor data organisasi Anda."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Item diterima" value={deposits} icon={Recycle} />
        <MetricCard label="Reward diterbitkan" value={formatRupiah(rewardAgg._sum.amount ?? 0)} icon={Coins} />
        <MetricCard label="Pickup selesai" value={pickupsDone} icon={Truck} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ekspor CSV</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-muted">
            Unduh data terbaru (maks 5.000 baris) dalam format CSV — kompatibel Excel/Sheets.
          </p>
          <div className="flex flex-wrap gap-2">
            {downloads.map((d) => (
              <a
                key={d.type}
                href={`/api/reports?type=${d.type}`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <FileText className="mr-1.5" />
                {d.label}
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
