import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { getWalletBalance, getLedgerHistory } from "@/lib/ledger";
import { getMinRedemption } from "@/lib/config";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireApiUser(["USER"]);
    const [balance, history, payoutAccount, minRedemption] = await Promise.all([
      getWalletBalance(user.id),
      getLedgerHistory(user.id),
      prisma.payoutAccount.findFirst({
        where: { userId: user.id, status: { not: "DISABLED" } },
        orderBy: { createdAt: "desc" },
      }),
      getMinRedemption(),
    ]);

    return jsonOk({ balance, history, payoutAccount, minRedemption });
  } catch (error) {
    return handleApiError(error);
  }
}
