-- M01 enforce step: database backstops for one EARN per deposit item and one
-- reserve per redemption.
--
-- Legacy duplicates are never deleted or deduplicated here. If any exist this
-- migration aborts before creating anything, with counts. Procedure (also in
-- the header of scripts/reconcile-wallet-history.ts):
--   1. npx tsx scripts/reconcile-wallet-history.ts   (read-only inventory)
--   2. Resolve each duplicate through a tracked case: keep the earliest row;
--      neutralize every extra row with a status-only transition that has no
--      balance effect (extra EARN -> REVERSED, extra reserve -> REJECTED),
--      recorded in the audit log. Amounts and references are never edited and
--      rows are never deleted. Money already paid out from a duplicate is a
--      recovery case, not a forced debit.
--   3. npx prisma migrate resolve --rolled-back 20261013122400_wallet_keys_enforce
--      (nothing was applied: the check runs before any DDL), then
--      npx prisma migrate deploy.
--
-- The index predicates exclude exactly those neutralized states. No current
-- writer produces them: EARN rows end PENDING/AVAILABLE/REJECTED and reserves
-- end PENDING/REDEEMED/REVERSED.

DO $$
DECLARE
  duplicate_earn_items integer;
  duplicate_reserves integer;
BEGIN
  SELECT count(*) INTO duplicate_earn_items FROM (
    SELECT "depositItemId" FROM "RewardLedger"
    WHERE "entryType" = 'EARN' AND "depositItemId" IS NOT NULL AND "status" <> 'REVERSED'
    GROUP BY "depositItemId" HAVING count(*) > 1
  ) duplicates;

  SELECT count(*) INTO duplicate_reserves FROM (
    SELECT "referenceId" FROM "RewardLedger"
    WHERE "entryType" = 'REDEEM' AND "referenceType" = 'Redemption'
      AND "referenceId" IS NOT NULL AND "status" <> 'REJECTED'
    GROUP BY "referenceId" HAVING count(*) > 1
  ) duplicates;

  IF duplicate_earn_items > 0 OR duplicate_reserves > 0 THEN
    RAISE EXCEPTION 'wallet_keys_enforce aborted: % deposit item(s) with more than one EARN row, % redemption(s) with more than one reserve row. Nothing was changed. Run "npx tsx scripts/reconcile-wallet-history.ts" for the inventory and follow the resolution procedure in its header before deploying again.',
      duplicate_earn_items, duplicate_reserves;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedger_one_earn_per_deposit_item"
  ON "RewardLedger"("depositItemId")
  WHERE "entryType" = 'EARN' AND "depositItemId" IS NOT NULL AND "status" <> 'REVERSED';

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedger_one_reserve_per_redemption"
  ON "RewardLedger"("referenceId")
  WHERE "entryType" = 'REDEEM' AND "referenceType" = 'Redemption'
    AND "referenceId" IS NOT NULL AND "status" <> 'REJECTED';
