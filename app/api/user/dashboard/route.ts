import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { getWalletBalance, getLedgerHistory } from "@/lib/ledger";
import { prisma } from "@/lib/prisma";
import { isCampaignEligible } from "@/lib/campaign";

export async function GET() {
  try {
    const user = await requireApiUser(["USER"]);

    const [balance, recentSessions, campaigns, ledger] = await Promise.all([
      getWalletBalance(user.id),
      prisma.depositSession.findMany({
        where: { userId: user.id },
        include: {
          machine: { select: { name: true, machineCode: true } },
          _count: { select: { items: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 5,
      }),
      prisma.campaign.findMany({
        where: { status: "ACTIVE" },
        include: { organization: { select: { name: true } } },
        orderBy: { startAt: "desc" },
        take: 10,
      }),
      getLedgerHistory(user.id, 5),
    ]);

    const eligibleCampaigns = campaigns.filter((c) =>
      isCampaignEligible(c, user.email).eligible,
    );

    return jsonOk({
      balance,
      recentSessions,
      campaigns: eligibleCampaigns,
      recentLedger: ledger,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
