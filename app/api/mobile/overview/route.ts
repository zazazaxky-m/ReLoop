import { prisma } from "@/lib/prisma";
import { handleApiError, jsonOk } from "@/lib/api";
import { CONFIG_KEYS, getConfigInt, getMinRedemption } from "@/lib/config";
import { getWalletBalance, getLedgerHistory } from "@/lib/ledger";
import { getLiabilitySummary } from "@/lib/reconciliation-report";
import { requireApiUser, activePartnerOrgIds } from "@/lib/rbac";
import { isCampaignEligible } from "@/lib/campaign";
import { getSecurityEvents, getSecuritySummary } from "@/lib/security-events";
import { getInvitedTravelAgentTripFilters } from "@/lib/trip";

export async function GET() {
  try {
    const user = await requireApiUser();

    if (user.role === "USER") {
      const [
        balance,
        sessions,
        campaigns,
        ledger,
        minRedemption,
        invitedAgentOrgs,
        pointsToRupiah,
      ] =
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
          getLedgerHistory(user.id, { take: 8 }),
          getMinRedemption(),
          getInvitedTravelAgentTripFilters(user.id),
          getConfigInt(CONFIG_KEYS.POINTS_TO_RUPIAH),
        ]);

      const tripWhere = {
        OR: [
          { userId: user.id },
          ...invitedAgentOrgs.map((link) => ({
            travelAgentId: link.travelAgentId,
            campaign: { organizationId: link.organizationId },
          })),
        ],
      };
      const [activeTrips, completedTrips, trashBagRewardSum] = await Promise.all([
        prisma.trip.count({
          where: { AND: [tripWhere, { status: { in: ["PLANNED", "ACTIVE"] } }] },
        }),
        prisma.trip.count({
          where: { AND: [tripWhere, { status: "COMPLETED" }] },
        }),
        prisma.rewardLedger.aggregate({
          where: { userId: user.id, reasonCode: "TRASH_BAG_RETURN", entryType: "EARN" },
          _sum: { amount: true },
        }),
      ]);

      return jsonOk({
        role: user.role,
        balance,
        isTravelAgent: invitedAgentOrgs.length > 0,
        pointsToRupiah,
        recentSessions: sessions,
        campaigns: campaigns.filter((campaign) =>
          isCampaignEligible(campaign, user.email).eligible,
        ),
        recentLedger: ledger,
        minRedemption,
        tourismSummary: {
          activeTrips,
          completedTrips,
          trashBagRewardTotal: trashBagRewardSum._sum.amount ?? 0,
        },
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
            take: 50,
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
      const tripOrgWhere = { campaign: { organizationId } };
      const [machines, pickups, campaignCount, depositCount, partnerships, tripTotal, tripCompliant, tripNeedsReview, tripNonCompliant, tripActive] =
        await Promise.all([
          prisma.machine.findMany({
            where: { organizationId },
            orderBy: { name: "asc" },
            take: 100,
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
          prisma.trip.count({ where: tripOrgWhere }),
          prisma.trip.count({ where: { ...tripOrgWhere, complianceStatus: "COMPLIANT" } }),
          prisma.trip.count({ where: { ...tripOrgWhere, complianceStatus: "NEEDS_REVIEW" } }),
          prisma.trip.count({ where: { ...tripOrgWhere, complianceStatus: "NON_COMPLIANT" } }),
          prisma.trip.count({ where: { ...tripOrgWhere, status: { in: ["PLANNED", "ACTIVE"] } } }),
        ]);

      return jsonOk({
        role: user.role,
        machines,
        pickups,
        campaignCount,
        depositCount,
        partnershipCount: partnerships,
        tourismSummary: {
          tripTotal,
          tripActive,
          compliant: tripCompliant,
          needsReview: tripNeedsReview,
          nonCompliant: tripNonCompliant,
          complianceRate: tripTotal
            ? Math.round((tripCompliant / tripTotal) * 100)
            : 0,
        },
      });
    }

    const [
      organizationCount,
      machineCount,
      userCount,
      depositCount,
      liability,
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
      getLiabilitySummary(),
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
      // M05: net spendable liability (payouts and reserves subtracted). Until
      // M05 this was the gross AVAILABLE earning; the name stays for old clients.
      rewardAvailable: liability.availableLiability,
      rewardLiability: liability,
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
