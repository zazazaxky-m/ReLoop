import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const orgId = user.role === "ADMIN" ? (user.organizationId ?? "__none__") : null;

    const pickupWhere: Prisma.PickupRequestWhereInput = orgId
      ? { organizationId: orgId }
      : {};
    const itemWhere: Prisma.DepositItemWhereInput = orgId
      ? { session: { machine: { organizationId: orgId } } }
      : {};
    // Scope userCount to organization for ADMIN, global for SUPERADMIN
    const userWhere: Prisma.UserWhereInput = orgId
      ? { role: "USER", organizationId: orgId }
      : { role: "USER" };

    const [
      pickupCount,
      pickupCompleted,
      depositItemCount,
      depositItemAccepted,
      rewardSum,
      userCount,
    ] = await Promise.all([
      prisma.pickupRequest.count({ where: pickupWhere }),
      prisma.pickupRequest.count({
        where: { ...pickupWhere, status: "COMPLETED" },
      }),
      prisma.depositItem.count({ where: itemWhere }),
      prisma.depositItem.count({
        where: { ...itemWhere, status: "ACCEPTED" },
      }),
      prisma.rewardLedger.aggregate({
        where: {
          entryType: "EARN",
          status: "AVAILABLE",
          ...(orgId ? { organizationId: orgId } : {}),
        },
        _sum: { amount: true },
      }),
      prisma.user.count({ where: userWhere }),
    ]);

    return jsonOk({
      pickupCount,
      pickupCompleted,
      depositItemCount,
      depositItemAccepted,
      rewardAvailable: rewardSum._sum.amount ?? 0,
      userCount,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
