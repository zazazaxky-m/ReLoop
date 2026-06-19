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
import { Coins, Download, Recycle, Truck } from "@/components/ui/icons";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { formatRupiah } from "@/lib/format";

export const metadata: Metadata = { title: "Laporan" };

export default async function AdminReportsPage() {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";

  const [deposits, rewardAgg, pickupsDone] = await Promise.all([
    prisma.depositItem.count({
      where: {
        status: "ACCEPTED",
        session: { machine: { organizationId: orgId } },
      },
    }),
    prisma.rewardLedger.aggregate({
      where: { organizationId: orgId, entryType: "EARN" },
      _sum: { amount: true },
    }),
    prisma.pickupRequest.count({
      where: { organizationId: orgId, status: "COMPLETED" },
    }),
  ]);

  const downloads = [
    { type: "deposits", label: "Data Deposit" },
    { type: "rewards", label: "Data Reward" },
    { type: "pickups", label: "Data Pickup" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Laporan Organisasi"
        description="Pantau ringkasan operasional dan unduh data organisasi."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        <MetricCard
          label="Item diterima"
          value={deposits}
          icon={Recycle}
          tone="green"
        />
        <MetricCard
          label="Pickup selesai"
          value={pickupsDone}
          icon={Truck}
          tone="blue"
        />
        <MetricCard
          label="Reward diterbitkan"
          value={formatRupiah(rewardAgg._sum.amount ?? 0)}
          icon={Coins}
          tone="amber"
          className="col-span-2 sm:col-span-1"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ekspor data</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm leading-6 text-muted">
            Unduh data terbaru dalam format CSV untuk dibuka melalui Excel
            atau Google Sheets.
          </p>
          <div className="grid gap-2 sm:grid-cols-3">
            {downloads.map((download) => (
              <a
                key={download.type}
                href={`/api/reports?type=${download.type}`}
                className={buttonVariants({
                  variant: "outline",
                  size: "md",
                  className: "w-full",
                })}
              >
                <Download />
                {download.label}
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
