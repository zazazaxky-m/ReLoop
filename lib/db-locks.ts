import type { Prisma } from "@prisma/client";
import { HttpError } from "./rbac";

/**
 * Row locks shared by every transaction that moves money.
 *
 * Global lock order (take a prefix-ordered subset, never go back to an earlier
 * class; several IDs of one class are locked in lexicographic order):
 *
 *   User -> RewardFundingAccount -> Campaign -> Machine -> Trip ->
 *   DepositSession -> DepositItem -> Redemption -> RewardLedger
 *
 * Read immutable relations first to learn which IDs to lock, take the locks,
 * then re-read every status, ownership and amount the decision depends on
 * through the same TransactionClient.
 *
 * A payout request also holds its destination PayoutAccount row FOR SHARE
 * right after User (the account belongs to the user's own aggregate), so the
 * account cannot be disabled between the check and COMMIT.
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
