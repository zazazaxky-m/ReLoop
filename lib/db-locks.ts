import type { Prisma } from "@prisma/client";
import { HttpError } from "./rbac";

/**
 * Row locks shared by every transaction that moves money.
 *
 * Global lock order (take a prefix-ordered subset, never go back to an earlier
 * class; several IDs of one class are locked in lexicographic order):
 *
 *   User -> PayoutAccount -> RewardFundingAccount -> Campaign -> Machine ->
 *   Trip -> DepositSession -> DepositItem -> Redemption -> RewardLedger
 *
 * Read immutable relations first to learn which IDs to lock, take the locks,
 * then re-read every status, ownership and amount the decision depends on
 * through the same TransactionClient.
 *
 * A payout request holds its destination PayoutAccount row FOR SHARE right
 * after User, so the account cannot be disabled between the check and COMMIT.
 * A payout transition (lib/wallet-service.ts) locks the owner User (learned
 * from the immutable Redemption.userId) and then the Redemption row; its
 * reserve RewardLedger row is changed last, by a conditional update.
 * A trip check-out or bag scan (lib/trip-validation.ts) locks the reward
 * recipient User (immutable Trip.userId, if any), then the Trip, then all of
 * its TrashBagAssignment rows in id order, and writes the trip return EARN
 * (business key `trip:<id>:return`) last.
 * An account erasure (lib/erasure-jobs.ts) locks the User, then every
 * PayoutAccount and every Redemption of that user (each class in id order),
 * and re-reads balances and open activity before anonymizing.
 */

/**
 * Serializes balance mutations for one user. Every EARN/ADJUST/REVERSE/REDEEM
 * writer for `userId` must call this first inside its transaction, and read the
 * balance through the same `tx` afterwards.
 *
 * FOR NO KEY UPDATE conflicts with other wallet transactions on the same user
 * but not with the KEY SHARE locks taken by foreign-key inserts that only
 * reference the user (sessions, notifications, audit), so unrelated writes are
 * not blocked.
 */
export async function lockUser(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new HttpError(404, "Pengguna tidak ditemukan");
}

/**
 * Locks one payout request for a status transition. Callers must already hold
 * `lockUser(tx, redemption.userId)` (User before Redemption) and must re-read
 * the row through the same `tx` afterwards. FOR NO KEY UPDATE: status changes
 * never touch the key, so foreign-key readers are not blocked.
 */
export async function lockRedemption(tx: Prisma.TransactionClient, redemptionId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Redemption" WHERE id = ${redemptionId} FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new HttpError(404, "Pengajuan pencairan tidak ditemukan");
}

/**
 * Locks one trip aggregate root. Money-moving callers (check-out, bag scan)
 * must already hold `lockUser(tx, trip.userId)` when the trip has a reward
 * recipient (User before Trip); non-money writers (bag issuance, check-in)
 * may lock the Trip alone. FOR NO KEY UPDATE: foreign-key inserts that only
 * reference the trip (bags, validations) are not blocked by it.
 */
export async function lockTrip(tx: Prisma.TransactionClient, tripId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Trip" WHERE id = ${tripId} FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new HttpError(404, "Trip tidak ditemukan");
}

/**
 * Locks every bag row of a trip in id order (after `lockTrip`). Returns the
 * locked ids; an empty list is valid (a trip without issued bags).
 */
export async function lockTripBags(tx: Prisma.TransactionClient, tripId: string): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "TrashBagAssignment" WHERE "tripId" = ${tripId} ORDER BY id FOR NO KEY UPDATE`;
  return rows.map((row) => row.id);
}
