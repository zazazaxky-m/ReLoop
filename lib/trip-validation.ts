import type { ConditionStatus, Prisma } from "@prisma/client";
import { lockCampaign, lockTrip, lockTripBags, lockUser } from "./db-locks";
import { prisma } from "./prisma";
import { HttpError } from "./rbac";
import { creditReward } from "./reward-credit";
import { closeReservation, findReservationByKey, lockFundingAccountForOrganization, tripIssuanceKey } from "./reward-funding";
import { decideReward, tripRewardMode } from "./reward-policy";
import type { ComplianceResult } from "./tourism";
import { VERIFIED_MEMBERSHIP } from "./travel-agent-access";
import { TRIP_CHANGED, evaluateTripBags, isRewardableCondition } from "./trip";
import { MAX_RUPIAH } from "./wallet-service";

/**
 * Trip aggregate (task M03, findings LOG-03 and EX-02).
 *
 * Every writer that can decide a trip outcome (bulk check-out in
 * app/api/manual-validations, progressive scan in app/api/trash-bags) runs in
 * one ReadCommitted transaction (`runWalletTransaction`) that:
 *
 *   1. reads the immutable Trip.userId, then locks the reward recipient User
 *      (if any) -> Trip -> all TrashBagAssignment rows in id order
 *      (`lockTripAggregate`);
 *   2. changes only bag rows it re-read under those locks with tripId + id
 *      (`validateTripBags`);
 *   3. recomputes the outcome from every bag row of the trip, never from a
 *      snapshot taken before the transaction (`refreshTripOutcome`), and writes
 *      the trip return EARN at most once, with business key
 *      `trip:<tripId>:return`.
 *
 * Money is computed only from verified, owned bag rows: one row is one unit
 * (a legacy `bagCount` other than 1 is reported by
 * scripts/reconcile-wallet-history.ts, never multiplied into a reward). A
 * count without bag IDs never earns money. Once a trip is COMPLETED its
 * reward is fixed: corrections update bag and compliance data only.
 */

export { TRIP_CHANGED };

export const TRIP_RETURN_REASON = "TRASH_BAG_RETURN";

export const CONDITION_STATUSES = ["GOOD", "PARTIAL", "POOR", "NOT_RETURNED"] as const satisfies readonly ConditionStatus[];

export const BAG_SCANNED_TWICE = "Kantong dipindai lebih dari sekali";
export const BAG_NOT_IN_TRIP = "Kantong tidak sesuai trip";
export const INVALID_BAG_CONDITION = "Kondisi kantong tidak valid";
export const RETURNED_COUNT_EXCEEDS_ISSUED =
  "Jumlah kantong kembali melebihi jumlah kantong yang diterbitkan untuk trip ini";
export const BAG_IDS_REQUIRED =
  "Check-out trip berhadiah wajib menyertakan ID setiap kantong. Muat ulang daftar kantong lalu ulangi.";
export const CORRECTION_REQUIRED =
  "Trip sudah selesai. Perubahan kondisi kantong setelah check-out harus dicatat sebagai koreksi beserta alasannya.";

/** Business key of the single return earning a trip may produce. */
export function tripReturnKey(tripId: string): string {
  return `trip:${tripId}:return`;
}

export interface BagStatusInput {
  id: string;
  status: ConditionStatus;
}

const LOCKED_TRIP_SELECT = {
  id: true,
  status: true,
  userId: true,
  campaignId: true,
  travelAgentId: true,
  groupName: true,
  complianceScore: true,
  complianceStatus: true,
  campaign: { select: { organizationId: true, campaignType: true, rewardMode: true, rewardMultiplier: true, name: true } },
  bagAssignments: { select: { id: true, bagQrCode: true, status: true }, orderBy: { id: "asc" } },
} satisfies Prisma.TripSelect;

export type LockedTrip = Prisma.TripGetPayload<{ select: typeof LOCKED_TRIP_SELECT }>;

/**
 * Locks the trip aggregate in the global order (reward recipient User ->
 * RewardFundingAccount of the campaign's organization -> Campaign -> Trip ->
 * bag rows by id) and re-reads it through `tx`. Re-entrant inside one
 * transaction, so `refreshTripOutcome` can call it again safely.
 */
export async function lockTripAggregate(tx: Prisma.TransactionClient, tripId: string): Promise<LockedTrip> {
  // Trip.userId and Trip.campaignId are written once at creation; reading
  // them unlocked only tells us which User, account and Campaign to lock.
  const ref = await tx.trip.findUnique({
    where: { id: tripId },
    select: { userId: true, campaignId: true, campaign: { select: { organizationId: true } } },
  });
  if (!ref) throw new HttpError(404, "Trip tidak ditemukan");
  if (ref.userId) await lockUser(tx, ref.userId);
  // B01: the trip's reward draws from its issuance reservation.
  await lockFundingAccountForOrganization(tx, ref.campaign.organizationId);
  await lockCampaign(tx, ref.campaignId);
  await lockTrip(tx, tripId);
  await lockTripBags(tx, tripId);
  const trip = await tx.trip.findUnique({ where: { id: tripId }, select: LOCKED_TRIP_SELECT });
  if (!trip) throw new HttpError(404, "Trip tidak ditemukan");
  if (trip.userId !== ref.userId || trip.campaignId !== ref.campaignId) throw new HttpError(409, TRIP_CHANGED);
  return trip;
}

/**
 * B01: once a trip is closed no further earning can draw from its issuance
 * reservation, so its residue goes back to the organization's capacity and
 * the campaign's budget (the trip's own return earning, if any, committed
 * first). Legacy trips (no reservation) are left alone.
 */
export async function closeTripReservation(
  tx: Prisma.TransactionClient,
  tripId: string,
  reason: "TRIP_COMPLETED" | "TRIP_CANCELLED",
): Promise<void> {
  const reservation = await findReservationByKey(tx, tripIssuanceKey(tripId));
  if (!reservation || reservation.status !== "ACTIVE") return;
  await closeReservation(tx, reservation.id, { reason });
}

/**
 * Applies operator-reported statuses to bags of `tripId`. Requires
 * `lockTripAggregate` on the same `tx`. Rejects (before any write) duplicate
 * IDs, unknown conditions, and IDs that are not rows of this trip, so a
 * request can never touch another trip's bags. Unchanged bags are left as
 * they are (a repeated scan keeps its original returnedAt). The counts cover
 * the submitted bags only; the trip outcome comes from `refreshTripOutcome`.
 */
export async function validateTripBags(
  tx: Prisma.TransactionClient,
  tripId: string,
  bags: BagStatusInput[],
): Promise<{ returnedCount: number; rewardableCount: number }> {
  const ids = bags.map((bag) => bag.id);
  if (new Set(ids).size !== ids.length) throw new HttpError(422, BAG_SCANNED_TWICE);
  if (bags.some((bag) => !(CONDITION_STATUSES as readonly string[]).includes(bag.status))) {
    throw new HttpError(422, INVALID_BAG_CONDITION);
  }
  if (ids.length === 0) return { returnedCount: 0, rewardableCount: 0 };

  const owned = await tx.trashBagAssignment.findMany({
    where: { tripId, id: { in: ids } },
    select: { id: true, status: true },
  });
  if (owned.length !== ids.length) throw new HttpError(422, BAG_NOT_IN_TRIP);

  const current = new Map(owned.map((bag) => [bag.id, bag.status]));
  const returnedAt = new Date();
  for (const bag of [...bags].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (current.get(bag.id) === bag.status) continue;
    const { count } = await tx.trashBagAssignment.updateMany({
      where: { id: bag.id, tripId },
      // NOT_RETURNED means the bag never came back: no return timestamp.
      data: { status: bag.status, returnedAt: bag.status === "NOT_RETURNED" ? null : returnedAt },
    });
    if (count !== 1) throw new HttpError(409, TRIP_CHANGED);
  }
  return {
    returnedCount: bags.filter((bag) => bag.status !== "NOT_RETURNED").length,
    rewardableCount: bags.filter((bag) => isRewardableCondition(bag.status)).length,
  };
}

/**
 * Bulk check-out closes the gate: bags not presented and never scanned are
 * recorded NOT_RETURNED. Bags already scanned keep their status.
 */
export async function markUnreviewedBagsNotReturned(tx: Prisma.TransactionClient, tripId: string): Promise<number> {
  const { count } = await tx.trashBagAssignment.updateMany({
    where: { tripId, status: null },
    data: { status: "NOT_RETURNED", returnedAt: null },
  });
  return count;
}

/** A count-only legacy request may never claim more bags than were issued as rows. */
export function assertCountWithinIssued(returnedBagCount: number, issuedBagCount: number): void {
  if (returnedBagCount > issuedBagCount) throw new HttpError(422, RETURNED_COUNT_EXCEEDS_ISSUED);
}

export interface TripOutcome {
  /** The trip is COMPLETED after this call. */
  completed: boolean;
  /** This call moved the trip from ACTIVE to COMPLETED. */
  completedNow: boolean;
  /** Rupiah credited by this call (0 when nothing new was earned). */
  rewardAmount: number;
  /** What the current bag states are worth under the campaign's rules. */
  computedRewardAmount: number;
  /** Live trip return earnings after this call (legacy rows included). */
  paidRewardAmount: number;
  compliance: ComplianceResult;
  assignedCount: number;
  returnedCount: number;
  rewardableCount: number;
  conditionStatus: ConditionStatus | null;
}

/**
 * Trip return earnings already recorded, in any status: keyed rows and legacy
 * rows without a key. Only the return reason counts; another EARN that
 * references the trip (e.g. a TOURISM_COMPLIANCE_BONUS) is not its return
 * earning. Same reason/reference predicate as the enforce index and guard
 * (20261013151919_trip_reward_keys_enforce) and the inventory.
 */
async function loadTripRewards(tx: Prisma.TransactionClient, tripId: string) {
  const validations = await tx.manualValidation.findMany({ where: { tripId }, select: { id: true } });
  return tx.rewardLedger.findMany({
    where: {
      entryType: "EARN",
      OR: [
        { businessKey: tripReturnKey(tripId) },
        { referenceType: "Trip", referenceId: tripId, reasonCode: TRIP_RETURN_REASON },
        ...(validations.length > 0
          ? [{ referenceType: "ManualValidation", referenceId: { in: validations.map((v) => v.id) }, reasonCode: TRIP_RETURN_REASON }]
          : []),
      ],
    },
    select: { id: true, amount: true, status: true },
  });
}

async function latestCheckoutAppCompleted(tx: Prisma.TransactionClient, tripId: string): Promise<boolean> {
  const validation = await tx.manualValidation.findFirst({
    where: { tripId, validationStage: "CHECK_OUT" },
    orderBy: { createdAt: "desc" },
    select: { appCompleted: true },
  });
  return validation?.appCompleted ?? false;
}

/**
 * Recomputes the trip outcome from all of its bag rows, under the trip locks
 * (taken again here, re-entrantly, so the earning is always written while the
 * reward recipient's User row is held).
 *
 * ACTIVE trip, every bag reviewed and `mayClose` -> COMPLETED (compare-and-set)
 * and, for a MONEY_REWARD trip program with a recipient, one EARN/AVAILABLE
 * keyed `trip:<tripId>:return` decided by lib/reward-policy.ts and written by
 * lib/reward-credit.ts, unless any trip return earning already exists.
 * ACTIVE trip otherwise -> compliance progress only, never money.
 * COMPLETED trip (correction) -> compliance only; the reward is never minted,
 * adjusted or reversed here.
 *
 * `appCompleted` defaults to what the closing CHECK_OUT validation recorded.
 * `mayClose` (default true) is false for a scan that did not review a
 * previously unreviewed bag: an ACTIVE trip whose bags were all reviewed
 * before the scan is legacy state (EX-02) and closes only through an explicit
 * bulk check-out listing every bag.
 */
export async function refreshTripOutcome(
  tx: Prisma.TransactionClient,
  tripId: string,
  options: { appCompleted?: boolean; mayClose?: boolean } = {},
): Promise<TripOutcome> {
  const trip = await lockTripAggregate(tx, tripId);
  if (trip.status !== "ACTIVE" && trip.status !== "COMPLETED") {
    throw new HttpError(422, "Kondisi kantong hanya dapat dicatat untuk trip ACTIVE atau yang sudah selesai");
  }

  const appCompleted = options.appCompleted ?? (await latestCheckoutAppCompleted(tx, tripId));
  const evaluation = evaluateTripBags({
    statuses: trip.bagAssignments.map((bag) => bag.status),
    appCompleted,
    rewardMode: trip.campaign.rewardMode,
    hasRecipient: trip.userId !== null,
    rewardMultiplier: trip.campaign.rewardMultiplier,
  });
  const { assignedCount, returnedCount, rewardableCount, conditionStatus, compliance } = evaluation;
  if (!Number.isSafeInteger(evaluation.rewardAmount) || evaluation.rewardAmount < 0 || evaluation.rewardAmount > MAX_RUPIAH) {
    throw new HttpError(422, "Nilai reward trip melebihi batas yang diizinkan");
  }
  // M04: the central policy has the last word (COMPLIANCE_ONLY, or a campaign
  // that is not a trip program, never pays).
  const decision = decideReward({
    mode: tripRewardMode(trip.campaign),
    baseAmount: evaluation.rewardAmount,
    weightValid: true,
    typeMatch: true,
    hasAnomaly: false,
  });
  const computedRewardAmount = decision.amount;

  const completedNow =
    trip.status === "ACTIVE" && (options.mayClose ?? true) && evaluation.reviewedCount === assignedCount;
  const { count } = await tx.trip.updateMany({
    where: { id: tripId, status: trip.status },
    data: {
      complianceStatus: compliance.status,
      complianceScore: compliance.score,
      ...(completedNow ? { status: "COMPLETED" as const, checkOutAt: new Date() } : {}),
    },
  });
  if (count !== 1) throw new HttpError(409, TRIP_CHANGED);

  const rewards = await loadTripRewards(tx, tripId);
  let rewardAmount = 0;
  if (completedNow && trip.userId && computedRewardAmount > 0 && rewards.length === 0) {
    // Same key, reason and reference as M03 (the enforce index filters on
    // reasonCode TRASH_BAG_RETURN); lockUser inside creditReward is the lock
    // this transaction already holds (lockTripAggregate).
    const entry = await creditReward(tx, {
      businessKey: tripReturnKey(tripId),
      userId: trip.userId,
      organizationId: trip.campaign.organizationId,
      campaignId: trip.campaignId,
      amount: computedRewardAmount,
      status: decision.ledgerStatus,
      reasonCode: TRIP_RETURN_REASON,
      referenceType: "Trip",
      referenceId: tripId,
    });
    rewardAmount = entry?.amount ?? 0;
  }
  if (completedNow) await closeTripReservation(tx, tripId, "TRIP_COMPLETED");
  const paidRewardAmount =
    rewardAmount +
    rewards
      .filter((row) => row.status === "AVAILABLE" || row.status === "PENDING")
      .reduce((sum, row) => sum + row.amount, 0);

  return {
    completed: completedNow || trip.status === "COMPLETED",
    completedNow,
    rewardAmount,
    computedRewardAmount,
    paidRewardAmount,
    compliance,
    assignedCount,
    returnedCount,
    rewardableCount,
    conditionStatus,
  };
}

/**
 * Who hears about a trip status change (read after COMMIT): the reward
 * recipient, plus the travel agent's users while the agent is still INVITED
 * by the campaign organization. Never throws; on a read failure only the
 * recipient is notified.
 */
export async function tripNotificationRecipients(trip: {
  userId: string | null;
  travelAgentId: string | null;
  campaign: { organizationId: string };
}): Promise<string[]> {
  const recipients = new Set<string>();
  if (trip.userId) recipients.add(trip.userId);
  if (!trip.travelAgentId) return [...recipients];
  try {
    const [agentUsers, invited] = await Promise.all([
      // A03: unverified members (not accepted from the invited mailbox) hear nothing.
      prisma.travelAgentUser.findMany({
        where: { travelAgentId: trip.travelAgentId, ...VERIFIED_MEMBERSHIP },
        select: { userId: true },
      }),
      prisma.travelAgentOrganization.findMany({
        where: { travelAgentId: trip.travelAgentId, organizationId: trip.campaign.organizationId, status: "INVITED" },
        select: { id: true },
      }),
    ]);
    if (invited.length > 0) for (const link of agentUsers) recipients.add(link.userId);
  } catch (error) {
    console.error("[trip] notification recipients unavailable", error instanceof Error ? error.message : error);
  }
  return [...recipients];
}
