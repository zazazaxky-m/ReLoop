-- M01 expand step: wallet business keys and per-user redemption idempotency.
-- Additive only. Legacy rows keep businessKey/requestHash NULL; no financial
-- history is rewritten. Enforcement lives in 20261013122400_wallet_keys_enforce.

-- AlterTable
ALTER TABLE "RewardLedger" ADD COLUMN "businessKey" TEXT;

-- AlterTable
ALTER TABLE "Redemption" ADD COLUMN "requestHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RewardLedger_businessKey_key" ON "RewardLedger"("businessKey");

-- Idempotency keys are scoped per user. The old global unique index implies
-- per-user uniqueness, so this index always builds; it is created before the
-- global one is dropped so uniqueness is never absent.
CREATE UNIQUE INDEX "Redemption_userId_idempotencyKey_key" ON "Redemption"("userId", "idempotencyKey");

-- DropIndex
DROP INDEX "Redemption_idempotencyKey_key";
