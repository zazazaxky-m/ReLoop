import type { Prisma, Trip, TrashBagAssignment, TripStatus } from "@prisma/client";
import { logAudit } from "./audit";
import { lockCampaign, lockTrip, lockUser } from "./db-locks";
import { prisma } from "./prisma";
import { HttpError, assertOrgScope, type CurrentUser } from "./rbac";
import {
  lockFundingAccountForOrganization,
  reserveRewardBudget,
  tripIssuanceCeiling,
  tripIssuanceKey,
} from "./reward-funding";
import { tripRewardMode } from "./reward-policy";
import { canIssueBagsForTripStatus, generateBagQrCode, getTripTravelAgentGateBlockReason } from "./trip";
import { TRIP_CHANGED, closeTripReservation, lockTripAggregate } from "./trip-validation";
import { afterCommitSafely, runWalletTransaction } from "./wallet-service";

/**
 * Trash-bag issuance (POST /api/trash-bags), as a service so the enforced
 * funding path can be exercised in-process (B01a).
 *
 * One unique QR per physical bag (one row = one unit). Issued under the
 * reward recipient's User -> RewardFundingAccount -> Campaign -> Trip locks:
 * the issuance first reserves the most these bags can ever pay (issued rows x
 * Rp2.000 x the campaign multiplier at full compliance,
 * lib/reward-funding.ts `tripIssuanceCeiling`) and only then inserts the
 * rows, so a refused reservation (REWARD_FUNDING_ENFORCED) rolls the whole
 * issuance back and a closing check-out and a new bag cannot interleave. The
 * transaction is retried on a rare QR collision.
 */

export const ISSUE_STATUS_ERROR = "Kantong hanya dapat diterbitkan untuk trip PLANNED atau ACTIVE";

/**
 * Reserves (or extends / re-activates) the trip's issuance reservation for
 * `issuedRows` bags: the most they can ever pay. Nothing for a trip without a
 * recipient or a program that pays no money. The caller holds the trip
 * locks (`lockTripAggregate`, or User -> account -> Campaign -> Trip).
 */
export async function reserveTripIssuance(
  tx: Prisma.TransactionClient,
  trip: {
    id: string;
    userId: string | null;
    campaignId: string;
    campaign: { organizationId: string; campaignType: string; rewardMode: string; rewardMultiplier: number | null };
  },
  issuedRows: number,
): Promise<string | null> {
  if (!trip.userId || issuedRows <= 0 || tripRewardMode(trip.campaign) !== "MONEY_REWARD") return null;
  return reserveRewardBudget(tx, {
    businessKey: tripIssuanceKey(trip.id),
    organizationId: trip.campaign.organizationId,
    campaignId: trip.campaignId,
    userId: trip.userId,
    ceilingRupiah: tripIssuanceCeiling(issuedRows, trip.campaign.rewardMultiplier),
    sourceType: "TRIP",
    sourceId: trip.id,
  });
}

/**
 * Manual trip status change (PATCH /api/trips/[id]), under the trip locks
 * (lib/trip-validation.ts; B01: User -> funding account -> Campaign -> Trip):
 * a check-out that closed the trip meanwhile is never overwritten (409). A
 * cancelled trip gives its issuance reservation back; a reopened one
 * (CANCELLED -> PLANNED) reserves its issued bags again before it can earn
 * (fix round 1, I1), refused under enforcement when capacity cannot cover it.
 * The scope and transition checks are the caller's (loadScopedTrip,
 * canManuallySetTripStatus).
 */
export async function changeTripStatus(
  tripId: string,
  expectedStatus: TripStatus,
  status: TripStatus,
): Promise<Trip> {
  return runWalletTransaction(async (tx) => {
    const locked = await lockTripAggregate(tx, tripId);
    if (locked.status !== expectedStatus) throw new HttpError(409, TRIP_CHANGED);
    const { count } = await tx.trip.updateMany({ where: { id: tripId, status: expectedStatus }, data: { status } });
    if (count !== 1) throw new HttpError(409, TRIP_CHANGED);
    if (status === "CANCELLED") await closeTripReservation(tx, tripId, "TRIP_CANCELLED");
    if (expectedStatus === "CANCELLED" && status === "PLANNED") {
      await reserveTripIssuance(tx, locked, locked.bagAssignments.length);
    }
    return tx.trip.findUniqueOrThrow({ where: { id: tripId } });
  });
}

export interface IssueTrashBagsInput {
  tripId: string;
  bagCount: number;
  wasteTypeId?: string;
}

export async function issueTrashBags(user: CurrentUser, data: IssueTrashBagsInput): Promise<TrashBagAssignment[]> {
  // Immutable relations (recipient, campaign, organization) say which rows to lock.
  const trip = await prisma.trip.findUnique({
    where: { id: data.tripId },
    include: {
      campaign: { select: { organizationId: true, campaignType: true, rewardMode: true, rewardMultiplier: true } },
    },
  });
  if (!trip) throw new HttpError(404, "Trip tidak ditemukan");
  assertOrgScope(user, trip.campaign.organizationId);
  if (!canIssueBagsForTripStatus(trip.status)) {
    throw new HttpError(422, ISSUE_STATUS_ERROR);
  }
  const agentBlock = await getTripTravelAgentGateBlockReason({
    travelAgentId: trip.travelAgentId,
    organizationId: trip.campaign.organizationId,
  });
  if (agentBlock) throw new HttpError(422, agentBlock);

  if (data.wasteTypeId) {
    const wasteType = await prisma.wasteType.findFirst({
      where: {
        id: data.wasteTypeId,
        active: true,
        OR: [{ organizationId: null }, { organizationId: trip.campaign.organizationId }],
      },
      select: { id: true },
    });
    if (!wasteType) {
      throw new HttpError(422, "Jenis sampah tidak aktif atau di luar organisasi trip");
    }
  }

  const maxAttempts = 5;
  let created: TrashBagAssignment[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const qrCodes = Array.from({ length: data.bagCount }, () => generateBagQrCode());
    try {
      created = await runWalletTransaction(async (tx) => {
        if (trip.userId) await lockUser(tx, trip.userId);
        await lockFundingAccountForOrganization(tx, trip.campaign.organizationId);
        await lockCampaign(tx, trip.campaignId);
        await lockTrip(tx, trip.id);
        const current = await tx.trip.findUniqueOrThrow({
          where: { id: trip.id },
          select: {
            status: true,
            userId: true,
            campaignId: true,
            campaign: { select: { campaignType: true, rewardMode: true, rewardMultiplier: true } },
          },
        });
        if (current.userId !== trip.userId || current.campaignId !== trip.campaignId) {
          throw new HttpError(409, TRIP_CHANGED);
        }
        if (!canIssueBagsForTripStatus(current.status)) throw new HttpError(422, ISSUE_STATUS_ERROR);
        const issued = await tx.trashBagAssignment.count({ where: { tripId: trip.id } });
        await reserveTripIssuance(
          tx,
          {
            id: trip.id,
            userId: current.userId,
            campaignId: trip.campaignId,
            campaign: { ...current.campaign, organizationId: trip.campaign.organizationId },
          },
          issued + data.bagCount,
        );
        await tx.trashBagAssignment.createMany({
          data: qrCodes.map((bagQrCode) => ({
            tripId: trip.id,
            assignedById: user.id,
            wasteTypeId: data.wasteTypeId ?? null,
            bagQrCode,
            bagCount: 1,
          })),
        });
        return tx.trashBagAssignment.findMany({
          where: { tripId: trip.id, bagQrCode: { in: qrCodes } },
          orderBy: { assignedAt: "asc" },
        });
      });
      break;
    } catch (err: unknown) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code !== "P2002" || attempt === maxAttempts) throw err;
    }
  }

  await afterCommitSafely("audit TRASH_BAG_ASSIGN", () =>
    logAudit({
      actorId: user.id,
      action: "TRASH_BAG_ASSIGN",
      entityType: "Trip",
      entityId: trip.id,
      metadata: { bagCount: data.bagCount, wasteTypeId: data.wasteTypeId ?? null },
    }),
  );
  return created;
}
