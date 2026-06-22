import { prisma } from "@/lib/prisma";
import { handleApiError, jsonOk } from "@/lib/api";
import { getMinRedemption } from "@/lib/config";
import { getWalletBalance, getLedgerHistory } from "@/lib/ledger";
import { requireApiUser, activePartnerOrgIds } from "@/lib/rbac";
import { isCampaignEligible } from "@/lib/campaign";
import { getSecurityEvents, getSecuritySummary } from "@/lib/security-events";

export async function GET() {
  try {
    const user = await requireApiUser();

    if (user.role === "USER") {
      const [balance, sessions, campaigns, ledger, minRedemption] =
        await Promise.all([
          getWalletBalance(user.id),
          prisma.depositSession.findMany({
            where: { userId: user.id },
            include: {
              machine: { select: { name: true, machineCode: true } },
              _count: { select: { items: true } },
            },
            orderBy: { startedAt: "desc" },
            take: 8,
          }),
          prisma.campaign.findMany({
            where: { status: "ACTIVE" },
            include: { organization: { select: { id: true, name: true } } },
            orderBy: { startAt: "desc" },
            take: 20,
          }),
          getLedgerHistory(user.id, 8),
          getMinRedemption(),
        ]);

      return jsonOk({
        role: user.role,
        balance,
        recentSessions: sessions,
        campaigns: campaigns.filter((campaign) =>
          isCampaignEligible(campaign, user.email).eligible,
        ),
        recentLedger: ledger,
        minRedemption,
      });
    }

    if (user.role === "PENGEPUL") {
      const orgIds = await activePartnerOrgIds(user.id);
      const [tasks, availableTasks, fullMachines, partnerships] =
        await Promise.all([
          prisma.pickupRequest.findMany({
            where: {
              assignedCollectorId: user.id,
              status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] },
            },
            include: {
              machine: { select: { id: true, name: true, machineCode: true } },
              organization: {
                select: { id: true, name: true, contactPhone: true },
              },
            },
            orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
            take: 10,
          }),
          prisma.pickupRequest.count({
            where: {
              organizationId: { in: orgIds.length ? orgIds : ["__none__"] },
              assignedCollectorId: null,
              status: { in: ["REQUESTED", "ASSIGNED"] },
            },
          }),
          prisma.machine.findMany({
            where: {
              organizationId: { in: orgIds.length ? orgIds : ["__none__"] },
              status: "FULL",
            },
            include: { organization: { select: { id: true, name: true } } },
            take: 10,
          }),
          prisma.organizationCollectorPartner.findMany({
            where: { collectorUserId: user.id },
            include: { organization: { select: { id: true, name: true } } },
            orderBy: { updatedAt: "desc" },
          }),
        ]);

      return jsonOk({
        role: user.role,
        tasks,
        availableTasks,
        fullMachines,
        partnerships,
      });
    }

    if (user.role === "ADMIN") {
      const organizationId = user.organizationId ?? "__none__";
      const [machines, pickups, campaignCount, depositCount, partnerships] =
        await Promise.all([
          prisma.machine.findMany({
            where: { organizationId },
            orderBy: { name: "asc" },
          }),
          prisma.pickupRequest.findMany({
            where: {
              organizationId,
              status: { notIn: ["COMPLETED", "CANCELLED", "FAILED"] },
            },
            include: {
              machine: { select: { id: true, name: true, machineCode: true } },
              assignedCollector: { select: { id: true, name: true } },
            },
            orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
            take: 10,
          }),
          prisma.campaign.count({
            where: { organizationId, status: "ACTIVE" },
          }),
          prisma.depositSession.count({
            where: {
              machine: { organizationId },
              status: "COMPLETED",
            },
          }),
          prisma.organizationCollectorPartner.count({
            where: { organizationId, status: "ACTIVE" },
          }),
        ]);

      return jsonOk({
        role: user.role,
        machines,
        pickups,
        campaignCount,
        depositCount,
        partnershipCount: partnerships,
      });
    }

    const [
      organizationCount,
      machineCount,
      userCount,
      depositCount,
      ledgerSum,
      pendingPartners,
      pendingRedemptions,
      minRedemption,
      securitySummary,
      recentSecurityEvents,
    ] = await Promise.all([
      prisma.organization.count(),
      prisma.machine.count(),
      prisma.user.count({ where: { role: "USER" } }),
      prisma.depositItem.count({ where: { status: "ACCEPTED" } }),
      prisma.rewardLedger.aggregate({
        where: { entryType: "EARN", status: "AVAILABLE" },
        _sum: { amount: true },
      }),
      prisma.organizationCollectorPartner.count({
        where: { status: "PENDING_SUPERADMIN_APPROVAL" },
      }),
      prisma.redemption.count({
        where: { status: { in: ["REQUESTED", "APPROVED", "PROCESSING"] } },
      }),
      getMinRedemption(),
      getSecuritySummary(),
      getSecurityEvents({ take: 8 }),
    ]);

    return jsonOk({
      role: user.role,
      organizationCount,
      machineCount,
      userCount,
      depositCount,
      rewardAvailable: ledgerSum._sum.amount ?? 0,
      pendingPartners,
      pendingRedemptions,
      minRedemption,
      securitySummary,
      recentSecurityEvents,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
