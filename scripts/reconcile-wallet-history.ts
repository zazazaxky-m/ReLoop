/**
 * Read-only wallet history inventory (tasks M01/M03, findings LOG-01, LOG-03, EX-02).
 *
 *   npx tsx scripts/reconcile-wallet-history.ts      # or: npm run reconcile:wallet
 *
 * Prints one JSON report on stdout. Exit code 0 = clean, 3 = findings present,
 * 1 = the inventory itself failed. It runs in a single READ ONLY, REPEATABLE
 * READ transaction, so every section describes the same snapshot, and it can
 * never write: there is no apply/dedupe/delete mode.
 *
 * Sections:
 *   negativeBalances               users whose spendable or pending balance is below 0
 *   duplicateEarnPerDepositItem    more than one EARN row for one deposit item   (blocks enforce)
 *   duplicateReservePerRedemption  more than one reserve row for one redemption  (blocks enforce)
 *   duplicateTripEarn              more than one live trip return earning for one trip
 *                                  (EARN with reasonCode TRASH_BAG_RETURN referencing the
 *                                  trip, or a legacy ManualValidation of it; other EARN
 *                                  rows referencing a trip are not return earnings)
 *                                                                                 (blocks enforce)
 *   legacyBagUnits                 trash-bag rows whose bagCount is not 1, per trip. Rewards
 *                                  count one unit per verified bag row and never multiply
 *                                  by bagCount; review each trip before any bagCount
 *                                  constraint (informational, does not block)
 *   unclosedReviewedTrips          ACTIVE MONEY_REWARD trips with a recipient whose bags all
 *                                  have a status but that have no trip return earning: the
 *                                  EX-02 legacy state (old scans decided on stale aggregates).
 *                                  Statuses may predate bag ownership checks (LOG-03), so no
 *                                  scan closes or pays them; recomputedRewardAmount sizes the
 *                                  exposure with and without the app score (informational)
 *   reservesWithoutRequest         REDEEM rows not backed by a matching request
 *                                  (no/unknown reference, other owner, other amount)
 *   requestsWithoutMatchingReserve in-flight/paid requests whose reserve is missing
 *                                  or in the wrong state (input for M02/M05)
 * (userId+idempotencyKey and businessKey duplicates cannot exist: unique indexes.)
 *
 * Procedure before the enforce migrations (20261013122400_wallet_keys_enforce,
 * 20261013151919_trip_reward_keys_enforce) and for any finding:
 *   1. Run this script against the target database and keep the JSON with the case.
 *   2. Open a tracked case per finding. Never delete ledger rows and never edit
 *      amounts or references. For duplicates keep the earliest row (first id in
 *      `ledgerIds`) and neutralize each extra row with a status-only transition
 *      that has no balance effect, recorded in the audit log:
 *        extra EARN for a deposit item  -> status REVERSED
 *        extra trip return earning      -> status REVERSED
 *        extra reserve for a redemption -> status REJECTED
 *      These two states are produced by no application writer, and the enforce
 *      indexes exclude exactly them. If money from a duplicate was already paid
 *      out the balance goes negative: that is a recovery case with the user, not
 *      a forced debit.
 *   3. Re-run this script until every enforce-blocking section is empty
 *      (`summary.blocksEnforcement` is 0).
 *   4. If `prisma migrate deploy` already failed on an enforce migration, mark
 *      it rolled back (its guard runs before any DDL, so nothing was applied):
 *        npx prisma migrate resolve --rolled-back <migration name>
 *      then run `npx prisma migrate deploy` again.
 *
 * legacyBagUnits needs a decision, not a status change: a legacy row with
 * bagCount N is one QR, not automatically N units. Record per trip whether it
 * stays one unit (the current rule) or is reissued as separate rows by an
 * operator, in the case log; this script never normalizes it.
 *
 * unclosedReviewedTrips also needs an operator decision per trip, recorded in
 * the case log: verify the bags physically/with the group, then close the trip
 * with an explicit bulk check-out listing every bag ID (POST
 * /api/manual-validations, CHECK_OUT), which pays at most once; or cancel it.
 */
import type { ConditionStatus, Prisma } from "@prisma/client";
import { computeBalance, type LedgerGroup } from "../lib/ledger";
import { evaluateTripBags } from "../lib/trip";

type RawReader = Pick<Prisma.TransactionClient, "$queryRaw">;

export interface DuplicateGroup {
  key: string;
  rows: number;
  /** Ordered by (createdAt, id): the first one is the row to keep. */
  ledgerIds: string[];
  userIds: string[];
  amount: number;
}

export interface WalletInventory {
  generatedAt: string;
  snapshot: { readOnly: boolean; isolation: string };
  negativeBalances: { userId: string; available: number; pending: number; reserved: number; redeemed: number }[];
  duplicateEarnPerDepositItem: DuplicateGroup[];
  duplicateReservePerRedemption: DuplicateGroup[];
  duplicateTripEarn: DuplicateGroup[];
  legacyBagUnits: {
    tripId: string; tripStatus: string; bagIds: string[]; bagRows: number; bagCountTotal: number;
    tripReturnEarnings: number;
  }[];
  unclosedReviewedTrips: {
    tripId: string; userId: string; campaignId: string; bagRows: number; returnedCount: number;
    rewardableCount: number; conditionStatus: ConditionStatus | null;
    recomputedRewardAmount: { appCompleted: number; appNotCompleted: number };
  }[];
  reservesWithoutRequest: {
    ledgerId: string; userId: string; amount: number; status: string;
    referenceType: string | null; referenceId: string | null; problem: string;
  }[];
  requestsWithoutMatchingReserve: {
    redemptionId: string; userId: string; amount: number; status: string; reserveStatuses: string[]; problem: string;
  }[];
  summary: Record<string, number> & { blocksEnforcement: number };
  clean: boolean;
}

const toNumber = (value: bigint | number | null) => Number(value ?? 0);

type DuplicateRow = { key: string; rows: number; ledgerIds: string[]; userIds: string[]; amount: bigint | number | null };
const duplicates = (rows: DuplicateRow[]): DuplicateGroup[] =>
  rows.map((row) => ({ ...row, amount: toNumber(row.amount) }));

/** Collects the inventory through `db` (a read-only transaction in main()). */
export async function collectWalletInventory(db: RawReader): Promise<WalletInventory> {
  const [snapshot] = await db.$queryRaw<{ readOnly: string; isolation: string }[]>`
    SELECT current_setting('transaction_read_only') AS "readOnly",
           current_setting('transaction_isolation') AS isolation`;

  const groups = await db.$queryRaw<{ userId: string; entryType: LedgerGroup["entryType"]; status: LedgerGroup["status"]; amount: bigint | null }[]>`
    SELECT "userId", "entryType"::text AS "entryType", status::text AS status, SUM(amount)::bigint AS amount
    FROM "RewardLedger" GROUP BY "userId", "entryType", status`;
  const byUser = new Map<string, LedgerGroup[]>();
  for (const group of groups) {
    const list = byUser.get(group.userId) ?? [];
    list.push({ entryType: group.entryType, status: group.status, amount: toNumber(group.amount) });
    byUser.set(group.userId, list);
  }
  const negativeBalances = [...byUser.entries()]
    .map(([userId, rows]) => {
      const { available, pending, reserved, redeemed } = computeBalance(rows);
      return { userId, available, pending, reserved, redeemed };
    })
    .filter((balance) => balance.available < 0 || balance.pending < 0)
    .sort((a, b) => a.available - b.available || a.userId.localeCompare(b.userId));

  // Predicates match the enforce migration's partial unique indexes.
  const duplicateEarnPerDepositItem = duplicates(await db.$queryRaw<DuplicateRow[]>`
    SELECT "depositItemId" AS key, count(*)::int AS rows,
           array_agg(id ORDER BY "createdAt", id) AS "ledgerIds",
           array_agg(DISTINCT "userId") AS "userIds", SUM(amount)::bigint AS amount
    FROM "RewardLedger"
    WHERE "entryType" = 'EARN' AND "depositItemId" IS NOT NULL AND status <> 'REVERSED'
    GROUP BY "depositItemId" HAVING count(*) > 1 ORDER BY "depositItemId"`);

  const duplicateReservePerRedemption = duplicates(await db.$queryRaw<DuplicateRow[]>`
    SELECT "referenceId" AS key, count(*)::int AS rows,
           array_agg(id ORDER BY "createdAt", id) AS "ledgerIds",
           array_agg(DISTINCT "userId") AS "userIds", SUM(amount)::bigint AS amount
    FROM "RewardLedger"
    WHERE "entryType" = 'REDEEM' AND "referenceType" = 'Redemption'
      AND "referenceId" IS NOT NULL AND status <> 'REJECTED'
    GROUP BY "referenceId" HAVING count(*) > 1 ORDER BY "referenceId"`);

  // Same predicate as the 20261013151919_trip_reward_keys_enforce guard.
  const duplicateTripEarn = duplicates(await db.$queryRaw<DuplicateRow[]>`
    SELECT e.trip_id AS key, count(*)::int AS rows,
           array_agg(e.id ORDER BY e."createdAt", e.id) AS "ledgerIds",
           array_agg(DISTINCT e."userId") AS "userIds", SUM(e.amount)::bigint AS amount
    FROM (
      SELECT l.id, l."createdAt", l."userId", l.amount,
             COALESCE(CASE WHEN l."referenceType" = 'Trip' THEN l."referenceId" END, v."tripId") AS trip_id
      FROM "RewardLedger" l
      LEFT JOIN "ManualValidation" v ON l."referenceType" = 'ManualValidation' AND v.id = l."referenceId"
      WHERE l."entryType" = 'EARN' AND l.status <> 'REVERSED' AND l."reasonCode" = 'TRASH_BAG_RETURN'
        AND ((l."referenceType" = 'Trip' AND l."referenceId" IS NOT NULL)
          OR (l."referenceType" = 'ManualValidation' AND v."tripId" IS NOT NULL))
    ) e
    GROUP BY e.trip_id HAVING count(*) > 1 ORDER BY e.trip_id`);

  const legacyBagUnits = (await db.$queryRaw<{
    tripId: string; tripStatus: string; bagIds: string[]; bagRows: number; bagCountTotal: bigint | number;
    tripReturnEarnings: number;
  }[]>`
    SELECT b."tripId", t.status::text AS "tripStatus", array_agg(b.id ORDER BY b.id) AS "bagIds",
           count(*)::int AS "bagRows", SUM(b."bagCount")::bigint AS "bagCountTotal",
           -- Live trip return earnings, duplicateTripEarn's predicate.
           (SELECT count(*)::int FROM "RewardLedger" l
             LEFT JOIN "ManualValidation" v ON l."referenceType" = 'ManualValidation' AND v.id = l."referenceId"
             WHERE l."entryType" = 'EARN' AND l.status <> 'REVERSED' AND l."reasonCode" = 'TRASH_BAG_RETURN'
               AND ((l."referenceType" = 'Trip' AND l."referenceId" = b."tripId")
                 OR (l."referenceType" = 'ManualValidation' AND v."tripId" = b."tripId"))) AS "tripReturnEarnings"
    FROM "TrashBagAssignment" b
    JOIN "Trip" t ON t.id = b."tripId"
    WHERE b."bagCount" <> 1
    GROUP BY b."tripId", t.status ORDER BY b."tripId"`).map((row) => ({ ...row, bagCountTotal: toNumber(row.bagCountTotal) }));

  // "No trip return earning" in any status, as lib/trip-validation.ts decides
  // whether a check-out would pay (keyed row, or legacy Trip/ManualValidation row).
  const unclosedReviewedTrips = (await db.$queryRaw<{
    tripId: string; userId: string; campaignId: string; rewardMultiplier: number | null; statuses: ConditionStatus[];
  }[]>`
    SELECT t.id AS "tripId", t."userId", t."campaignId", c."rewardMultiplier",
           array_agg(b.status::text ORDER BY b.id) AS statuses
    FROM "Trip" t
    JOIN "Campaign" c ON c.id = t."campaignId"
    JOIN "TrashBagAssignment" b ON b."tripId" = t.id
    WHERE t.status = 'ACTIVE' AND t."userId" IS NOT NULL AND c."rewardMode" = 'MONEY_REWARD'
      AND NOT EXISTS (
        SELECT 1 FROM "RewardLedger" l
        LEFT JOIN "ManualValidation" v ON l."referenceType" = 'ManualValidation' AND v.id = l."referenceId"
        WHERE l."entryType" = 'EARN'
          AND (l."businessKey" = 'trip:' || t.id || ':return'
            OR (l."reasonCode" = 'TRASH_BAG_RETURN'
              AND ((l."referenceType" = 'Trip' AND l."referenceId" = t.id)
                OR (l."referenceType" = 'ManualValidation' AND v."tripId" = t.id)))))
    GROUP BY t.id, t."userId", t."campaignId", c."rewardMultiplier"
    HAVING bool_and(b.status IS NOT NULL)
    ORDER BY t.id`).map(({ statuses, rewardMultiplier, ...trip }) => {
    const price = (appCompleted: boolean) => evaluateTripBags({
      statuses, appCompleted, rewardMode: "MONEY_REWARD", hasRecipient: true, rewardMultiplier });
    const withApp = price(true);
    return {
      ...trip,
      bagRows: withApp.assignedCount,
      returnedCount: withApp.returnedCount,
      rewardableCount: withApp.rewardableCount,
      conditionStatus: withApp.conditionStatus,
      recomputedRewardAmount: { appCompleted: withApp.rewardAmount, appNotCompleted: price(false).rewardAmount },
    };
  });

  const reservesWithoutRequest = (await db.$queryRaw<{
    ledgerId: string; userId: string; amount: number; status: string;
    referenceType: string | null; referenceId: string | null; problem: string;
  }[]>`
    SELECT l.id AS "ledgerId", l."userId", l.amount, l.status::text AS status,
           l."referenceType", l."referenceId",
           CASE
             WHEN l."referenceType" IS DISTINCT FROM 'Redemption' THEN 'NOT_LINKED_TO_REDEMPTION'
             WHEN l."referenceId" IS NULL THEN 'MISSING_REFERENCE'
             WHEN r.id IS NULL THEN 'REQUEST_NOT_FOUND'
             WHEN r."userId" <> l."userId" THEN 'OWNER_MISMATCH'
             ELSE 'AMOUNT_MISMATCH'
           END AS problem
    FROM "RewardLedger" l
    LEFT JOIN "Redemption" r ON l."referenceType" = 'Redemption' AND r.id = l."referenceId"
    WHERE l."entryType" = 'REDEEM'
      AND (l."referenceType" IS DISTINCT FROM 'Redemption' OR l."referenceId" IS NULL OR r.id IS NULL
           OR r."userId" <> l."userId" OR -l.amount <> r.amount)
    ORDER BY l."createdAt", l.id`);

  const requestsWithoutMatchingReserve = (await db.$queryRaw<{
    redemptionId: string; userId: string; amount: number; status: string; reserveStatuses: string[]; problem: string;
  }[]>`
    SELECT r.id AS "redemptionId", r."userId", r.amount, r.status::text AS status,
           COALESCE(array_agg(l.status::text ORDER BY l.status::text) FILTER (WHERE l.id IS NOT NULL), '{}') AS "reserveStatuses",
           CASE WHEN count(l.id) = 0 THEN 'RESERVE_MISSING' ELSE 'RESERVE_STATE_MISMATCH' END AS problem
    FROM "Redemption" r
    LEFT JOIN "RewardLedger" l
      ON l."entryType" = 'REDEEM' AND l."referenceType" = 'Redemption' AND l."referenceId" = r.id
    WHERE r.status IN ('REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCESS')
    GROUP BY r.id
    HAVING count(l.id) FILTER (WHERE
      (r.status = 'SUCCESS' AND l.status = 'REDEEMED') OR
      (r.status <> 'SUCCESS' AND l.status = 'PENDING')) = 0
    ORDER BY r."createdAt", r.id`);

  const summary = {
    negativeBalances: negativeBalances.length,
    duplicateEarnPerDepositItem: duplicateEarnPerDepositItem.length,
    duplicateReservePerRedemption: duplicateReservePerRedemption.length,
    duplicateTripEarn: duplicateTripEarn.length,
    legacyBagUnits: legacyBagUnits.length,
    unclosedReviewedTrips: unclosedReviewedTrips.length,
    reservesWithoutRequest: reservesWithoutRequest.length,
    requestsWithoutMatchingReserve: requestsWithoutMatchingReserve.length,
    blocksEnforcement:
      duplicateEarnPerDepositItem.length + duplicateReservePerRedemption.length + duplicateTripEarn.length,
  };
  return {
    generatedAt: new Date().toISOString(),
    snapshot: { readOnly: snapshot.readOnly === "on", isolation: snapshot.isolation },
    negativeBalances,
    duplicateEarnPerDepositItem,
    duplicateReservePerRedemption,
    duplicateTripEarn,
    legacyBagUnits,
    unclosedReviewedTrips,
    reservesWithoutRequest,
    requestsWithoutMatchingReserve,
    summary,
    clean: Object.entries(summary).every(([, count]) => count === 0),
  };
}

async function main() {
  const { prisma } = await import("../lib/prisma");
  try {
    const inventory = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return collectWalletInventory(tx);
    }, { isolationLevel: "RepeatableRead", timeout: 120_000 });
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    process.exitCode = inventory.clean ? 0 : 3;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /reconcile-wallet-history\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error("[reconcile:wallet] failed", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
