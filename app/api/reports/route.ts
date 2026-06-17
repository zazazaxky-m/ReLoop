import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonError } from "@/lib/api";
import { toCsv, csvResponse } from "@/lib/csv";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const url = new URL(req.url);
    const type = url.searchParams.get("type") ?? "deposits";
    const orgId = user.role === "ADMIN" ? (user.organizationId ?? "__none__") : null;
    const stamp = ymd(new Date());

    if (type === "deposits") {
      const where: Prisma.DepositItemWhereInput = orgId
        ? { session: { machine: { organizationId: orgId } } }
        : {};
      const items = await prisma.depositItem.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 5000,
        include: {
          wasteType: { select: { name: true } },
          session: {
            select: {
              user: { select: { email: true } },
              machine: { select: { machineCode: true, name: true } },
            },
          },
        },
      });
      const csv = toCsv(
        items.map((i) => ({
          tanggal: ymd(i.createdAt),
          mesin: i.session?.machine?.machineCode ?? "",
          jenis: i.wasteType.name,
          qty: i.quantity,
          beratGram: i.measuredWeightGrams ?? "",
          reward: i.rewardAmount,
          status: i.status,
          user: i.session?.user?.email ?? "",
        })),
        [
          { key: "tanggal", header: "Tanggal" },
          { key: "mesin", header: "Mesin" },
          { key: "jenis", header: "Jenis Sampah" },
          { key: "qty", header: "Qty" },
          { key: "beratGram", header: "Berat (g)" },
          { key: "reward", header: "Reward (Rp)" },
          { key: "status", header: "Status" },
          { key: "user", header: "User" },
        ],
      );
      return csvResponse(csv, `deposits-${stamp}.csv`);
    }

    if (type === "rewards") {
      const where: Prisma.RewardLedgerWhereInput = orgId ? { organizationId: orgId } : {};
      const rows = await prisma.rewardLedger.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 5000,
        include: { user: { select: { email: true } } },
      });
      const csv = toCsv(
        rows.map((r) => ({
          tanggal: ymd(r.createdAt),
          user: r.user.email,
          tipe: r.entryType,
          jumlah: r.amount,
          status: r.status,
          alasan: r.reasonCode ?? "",
        })),
        [
          { key: "tanggal", header: "Tanggal" },
          { key: "user", header: "User" },
          { key: "tipe", header: "Tipe" },
          { key: "jumlah", header: "Jumlah (Rp)" },
          { key: "status", header: "Status" },
          { key: "alasan", header: "Alasan" },
        ],
      );
      return csvResponse(csv, `rewards-${stamp}.csv`);
    }

    if (type === "pickups") {
      const where: Prisma.PickupRequestWhereInput = orgId ? { organizationId: orgId } : {};
      const rows = await prisma.pickupRequest.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 5000,
        include: {
          machine: { select: { machineCode: true } },
          assignedCollector: { select: { name: true } },
          _count: { select: { items: true } },
        },
      });
      const csv = toCsv(
        rows.map((r) => ({
          tanggal: ymd(r.createdAt),
          mesin: r.machine?.machineCode ?? "",
          status: r.status,
          alasan: r.reason,
          pengepul: r.assignedCollector?.name ?? "",
          material: r._count.items,
        })),
        [
          { key: "tanggal", header: "Tanggal" },
          { key: "mesin", header: "Mesin" },
          { key: "status", header: "Status" },
          { key: "alasan", header: "Alasan" },
          { key: "pengepul", header: "Pengepul" },
          { key: "material", header: "Jml Material" },
        ],
      );
      return csvResponse(csv, `pickups-${stamp}.csv`);
    }

    return jsonError(422, "type tidak dikenal (deposits|rewards|pickups)");
  } catch (error) {
    return handleApiError(error);
  }
}
