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
        include: {
          user: { select: { email: true } },
          campaign: { select: { name: true, campaignType: true } },
        },
      });
      const csv = toCsv(
        rows.map((r) => ({
          tanggal: ymd(r.createdAt),
          user: r.user.email,
          tipe: r.entryType,
          jumlah: r.amount,
          status: r.status,
          alasan: r.reasonCode ?? "",
          referensiTipe: r.referenceType ?? "",
          referensiId: r.referenceId ?? "",
          campaign: r.campaign?.name ?? "",
          campaignTipe: r.campaign?.campaignType ?? "",
        })),
        [
          { key: "tanggal", header: "Tanggal" },
          { key: "user", header: "User" },
          { key: "tipe", header: "Tipe" },
          { key: "jumlah", header: "Jumlah (Rp)" },
          { key: "status", header: "Status" },
          { key: "alasan", header: "Alasan" },
          { key: "referensiTipe", header: "Referensi Tipe" },
          { key: "referensiId", header: "Referensi ID" },
          { key: "campaign", header: "Campaign" },
          { key: "campaignTipe", header: "Tipe Campaign" },
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

    if (type === "trips") {
      const where: Prisma.TripWhereInput = orgId
        ? { campaign: { organizationId: orgId } }
        : {};
      const rows = await prisma.trip.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 5000,
        include: {
          campaign: { select: { name: true, campaignType: true, rewardMode: true } },
          travelAgent: { select: { name: true, email: true } },
          user: { select: { email: true } },
          _count: { select: { bagAssignments: true, validations: true } },
        },
      });
      const csv = toCsv(
        rows.map((r) => ({
          tanggal: ymd(r.createdAt),
          tripId: r.id,
          grup: r.groupName ?? "",
          campaign: r.campaign.name,
          campaignTipe: r.campaign.campaignType,
          rewardMode: r.campaign.rewardMode,
          travelAgent: r.travelAgent?.name ?? r.travelAgentName ?? "",
          penerimaReward: r.user?.email ?? "",
          status: r.status,
          compliance: r.complianceStatus,
          skor: r.complianceScore,
          peserta: r.participantCount,
          kantong: r._count.bagAssignments,
          validasi: r._count.validations,
          checkIn: r.checkInAt ? ymd(r.checkInAt) : "",
          checkOut: r.checkOutAt ? ymd(r.checkOutAt) : "",
        })),
        [
          { key: "tanggal", header: "Tanggal" },
          { key: "tripId", header: "Trip ID" },
          { key: "grup", header: "Grup" },
          { key: "campaign", header: "Campaign" },
          { key: "campaignTipe", header: "Tipe Campaign" },
          { key: "rewardMode", header: "Mode Reward" },
          { key: "travelAgent", header: "Travel Agent" },
          { key: "penerimaReward", header: "Penerima Reward" },
          { key: "status", header: "Status Trip" },
          { key: "compliance", header: "Compliance" },
          { key: "skor", header: "Skor" },
          { key: "peserta", header: "Peserta" },
          { key: "kantong", header: "Kantong" },
          { key: "validasi", header: "Validasi" },
          { key: "checkIn", header: "Check-in" },
          { key: "checkOut", header: "Check-out" },
        ],
      );
      return csvResponse(csv, `trips-${stamp}.csv`);
    }

    return jsonError(422, "type tidak dikenal (deposits|rewards|pickups|trips)");
  } catch (error) {
    return handleApiError(error);
  }
}
