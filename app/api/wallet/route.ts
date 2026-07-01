import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { getWalletBalance, getLedgerHistory } from "@/lib/ledger";
import { CONFIG_KEYS, getConfigInt, getMinRedemption } from "@/lib/config";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireApiUser(["USER"]);
    const [
      balance,
      history,
      payoutAccounts,
      redemptions,
      minRedemption,
      travelAgentLinkCount,
      pointsToRupiah,
    ] = await Promise.all([
      getWalletBalance(user.id),
      getLedgerHistory(user.id),
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

    return jsonOk({
      balance,
      history,
      payoutAccounts,
      redemptions,
      minRedemption,
      isTravelAgent: travelAgentLinkCount > 0,
      pointsToRupiah,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
