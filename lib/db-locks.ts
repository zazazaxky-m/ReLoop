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
 * Deposit rewards (M04) lock the reward recipient User (immutable
 * DepositSession.userId) first: a deposit review then takes Machine ->
 * DepositSession -> DepositItem; machine acceptance and the fraud hold take
 * DepositSession -> DepositItem; all money is written by lib/reward-credit.ts
 * last. Their machine-event transaction only inserts the MachineEvent row
 * before that (a foreign-key KEY SHARE, which none of these locks conflicts with).
 * A deposit session start, owner finish/cancel and the timeout policy (R03,
 * lib/deposit-session-service.ts) lock the User (the scanning user, the owner,
 * or for a machine poll the session owner), then the Machine, then the
 * DepositSession and its undecided DepositItems in id order; the Machine lock
 * is what keeps one active session per machine. ITEM_DETECTED locks its
 * DepositSession before re-reading it (no User or Machine lock).
 * An invitation accept (A03, lib/invitations.ts) locks the accepting User,
 * then the TravelAgentOrganization link row; no transaction locks a link
 * before a User. Email verification, an email change and minting a
 * verification token (lib/email-outbox.ts) lock only the User.
 * Reward funding (B01, lib/reward-funding.ts): every money path takes the
 * organization's RewardFundingAccount (created on first use) and the
 * session/trip Campaign right after the User and before any Machine/Trip/
 * DepositSession/DepositItem/Redemption lock: session admission (User ->
 * account -> Campaign -> Machine), machine acceptance and the deposit review
 * (User -> account -> Campaign -> [Machine ->] DepositSession -> DepositItem),
 * bag issuance and trip outcome (User -> account -> Campaign -> Trip -> bags),
 * and a payout success (User -> every account the owner's funded earnings
 * draw from, in id order -> Redemption). The account counters, reservations
 * and commit amounts change only under the account lock; a commit's
 * `reviewPending` flag follows the item and changes under its owner's User
 * lock. An operator topup/correction or residual release locks the account
 * alone (a prefix-free suffix of the order is allowed: nothing earlier is
 * taken afterwards).
 * Pickup dispatch (B05, lib/pickup-dispatch.ts) moves no money: a transition
 * that writes the machine (complete) locks the Machine first (immutable
 * PickupRequest.machineId), then the PickupRequest; every other dispatch or
 * field transition locks the PickupRequest alone. Under the pickup lock it
 * holds the collector's OrganizationCollectorPartner row FOR SHARE, so a
 * partnership cannot be suspended between the check and COMMIT. No
 * transaction locks a PickupRequest before a Machine, and partnership
 * mutations lock no pickup. The overdue escalation is one conditional UPDATE
 * per (pickup, version) and takes no other lock.
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
 * Locks one organization's reward funding account (B01). Taken right after
 * the User lock(s) and before any Campaign/Machine/Trip/DepositSession lock;
 * lib/reward-funding.ts creates the row on first use. FOR NO KEY UPDATE:
 * foreign-key inserts referencing the account (entries, reservations,
 * commits) are not blocked by it.
 */
export async function lockFundingAccount(tx: Prisma.TransactionClient, accountId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "RewardFundingAccount" WHERE id = ${accountId} FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new HttpError(404, "Akun pendanaan reward tidak ditemukan");
}

/**
 * Locks one campaign for its budget counters (B01), after the funding
 * account and before any Machine/Trip/DepositSession lock. FOR NO KEY UPDATE:
 * sessions, trips and rates that reference the campaign are not blocked.
 */
export async function lockCampaign(tx: Prisma.TransactionClient, campaignId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Campaign" WHERE id = ${campaignId} FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new HttpError(404, "Campaign tidak ditemukan");
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

/**
 * Locks one machine row (a deposit review takes User -> Machine ->
 * DepositSession -> DepositItem). FOR NO KEY UPDATE: foreign-key inserts that
 * only reference the machine (events, sessions) are not blocked by it.
 */
export async function lockMachine(tx: Prisma.TransactionClient, machineId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Machine" WHERE id = ${machineId} FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new HttpError(404, "Mesin tidak ditemukan");
}

/**
 * Locks one deposit session. Money-moving callers (machine acceptance, fraud
 * hold, deposit review) already hold `lockUser(tx, session.userId)` (the
 * immutable DepositSession.userId tells them which User).
 */
export async function lockDepositSession(tx: Prisma.TransactionClient, sessionId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "DepositSession" WHERE id = ${sessionId} FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new HttpError(404, "Sesi setoran tidak ditemukan");
}

/** Locks one deposit item, after its session (DepositSession -> DepositItem). */
export async function lockDepositItem(tx: Prisma.TransactionClient, depositItemId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "DepositItem" WHERE id = ${depositItemId} FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new HttpError(404, "Item setoran tidak ditemukan");
}

/**
 * Locks one pickup request for a dispatch or field transition (B05). A
 * transition that also writes the machine (complete) must already hold
 * `lockMachine(tx, pickup.machineId)` (Machine before PickupRequest). Re-read
 * status, version, assignee and partnership through the same `tx` afterwards.
 * FOR NO KEY UPDATE: foreign-key inserts that only reference the pickup
 * (PickupItem rows, a replacement task) are not blocked by it.
 */
export async function lockPickupRequest(tx: Prisma.TransactionClient, pickupId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "PickupRequest" WHERE id = ${pickupId} FOR NO KEY UPDATE`;
  if (rows.length !== 1) throw new HttpError(404, "Pickup tidak ditemukan");
}
