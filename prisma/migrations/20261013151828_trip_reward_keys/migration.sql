-- M03 expand step: trip return earnings.
--
-- New trip return earnings carry RewardLedger.businessKey = 'trip:<tripId>:return'
-- (unique since 20261013122300_wallet_keys) and are written only under the
-- User -> Trip -> bag row locks (lib/trip-validation.ts). Legacy rows keep a
-- NULL key and are recognised by reference instead (referenceType 'Trip', or
-- 'ManualValidation' + reasonCode 'TRASH_BAG_RETURN' from the earliest code);
-- this lookup index serves that check and the read-only inventory. No row is
-- backfilled or rewritten.

-- CreateIndex
CREATE INDEX "RewardLedger_referenceType_referenceId_idx" ON "RewardLedger"("referenceType", "referenceId");
