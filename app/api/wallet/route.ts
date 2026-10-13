import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { getWalletBalance, getLedgerHistory, countLedgerHistory } from "@/lib/ledger";
import { CONFIG_KEYS, getConfigInt, getMinRedemption } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { VERIFIED_MEMBERSHIP } from "@/lib/travel-agent-access";
import { buildPaginationMeta, parsePagination } from "@/lib/pagination";
import { REDEMPTION_PRIVATE_COLUMNS } from "@/lib/payout-destination";

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["USER"]);
    const pagination = parsePagination(new URL(req.url));

    const [
      balance,
      historyTotal,
      history,
      payoutAccounts,
      redemptions,
      minRedemption,
      travelAgentLinkCount,
      pointsToRupiah,
    ] = await Promise.all([
      getWalletBalance(user.id),
      countLedgerHistory(user.id),
      getLedgerHistory(user.id, { skip: pagination.skip, take: pagination.take }),
      prisma.payoutAccount.findMany({
        where: { userId: user.id, status: { not: "DISABLED" } },
        orderBy: { createdAt: "desc" },
      }),
      prisma.redemption.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 20,
        omit: REDEMPTION_PRIVATE_COLUMNS,
      }),
      getMinRedemption(),
      prisma.travelAgentUser.count({ where: { userId: user.id, ...VERIFIED_MEMBERSHIP } }),
      getConfigInt(CONFIG_KEYS.POINTS_TO_RUPIAH),
    ]);

    return jsonOk({
      balance,
      history,
      historyPagination: buildPaginationMeta(historyTotal, pagination),
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
