-- M03 enforce step: at most one live trip return earning per trip.
--
-- Legacy duplicates are never deleted or deduplicated here. Before any DDL the
-- guard below counts trips with more than one live (status <> 'REVERSED') trip
-- return earning, resolving legacy rows that reference a ManualValidation
-- (reasonCode 'TRASH_BAG_RETURN') to that validation's trip, and aborts with
-- the count. Procedure (also in the header of scripts/reconcile-wallet-history.ts):
--   1. npx tsx scripts/reconcile-wallet-history.ts   (read-only inventory,
--      section duplicateTripEarn; ledgerIds are ordered, keep the first)
--   2. Resolve each trip through a tracked case: keep the earliest row and
--      neutralize every extra row with the status-only transition EARN ->
--      REVERSED, recorded in the audit log. Amounts and references are never
--      edited and rows are never deleted. Money already paid out from a
--      duplicate is a recovery case, not a forced debit.
--   3. npx prisma migrate resolve --rolled-back 20261013151919_trip_reward_keys_enforce
--      (nothing was applied: the check runs before any DDL), then
--      npx prisma migrate deploy.
--
-- The index excludes exactly the neutralized state (EARN/REVERSED), which no
-- application writer produces. Legacy ManualValidation-referenced rows cannot
-- be covered by a single-column index; the guard checks them and the
-- application treats any of them as "already rewarded".

DO $$
DECLARE
  duplicate_trip_earnings integer;
BEGIN
  SELECT count(*) INTO duplicate_trip_earnings FROM (
    SELECT COALESCE(CASE WHEN l."referenceType" = 'Trip' THEN l."referenceId" END, v."tripId") AS trip_id
    FROM "RewardLedger" l
    LEFT JOIN "ManualValidation" v
      ON l."referenceType" = 'ManualValidation' AND v."id" = l."referenceId"
    WHERE l."entryType" = 'EARN' AND l."status" <> 'REVERSED'
      AND ((l."referenceType" = 'Trip' AND l."referenceId" IS NOT NULL)
        OR (l."referenceType" = 'ManualValidation' AND l."reasonCode" = 'TRASH_BAG_RETURN' AND v."tripId" IS NOT NULL))
    GROUP BY 1 HAVING count(*) > 1
  ) duplicates;

  IF duplicate_trip_earnings > 0 THEN
    RAISE EXCEPTION 'trip_reward_keys_enforce aborted: % trip(s) with more than one trip return earning. Nothing was changed. Run "npx tsx scripts/reconcile-wallet-history.ts" for the inventory (section duplicateTripEarn) and follow the resolution procedure in its header before deploying again.',
      duplicate_trip_earnings;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedger_one_earn_per_trip"
  ON "RewardLedger"("referenceId")
  WHERE "entryType" = 'EARN' AND "referenceType" = 'Trip'
    AND "referenceId" IS NOT NULL AND "status" <> 'REVERSED';
