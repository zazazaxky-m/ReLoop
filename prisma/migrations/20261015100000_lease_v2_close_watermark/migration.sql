-- B01b (BIZ-02): lease protocol v2, admission snapshot and close watermark.
--
-- Expand only: nullable columns on DepositSession, one enum value, one new
-- table with its own unique key. No existing row is rewritten; the RewardLedger
-- and every B01a counter are untouched. Sessions admitted before this release
-- have no snapshot (null): a v2 worker's first poll gives them one from the
-- live configuration (lib/deposit-session-service.ts ensureSessionPolicy) and
-- they are priced live until then; they are watermarked like any other session.
-- Generated with `prisma migrate diff --from-migrations prisma/migrations
-- --to-schema-datamodel prisma/schema.prisma --script`; it contains no DROP
-- INDEX for the hand-written partial unique indexes.
--
-- Rollout (rvm/README.md "Lease v2"): deploy this backend first (v1 workers
-- keep their contract: compliance sessions always, money sessions while
-- REWARD_FUNDING_ENFORCED is not true), then the RVM workers, then enable
-- enforcement once every money machine runs a v2 worker.

-- AlterEnum
-- PostgreSQL 12+ accepts ALTER TYPE ... ADD VALUE inside the migration transaction
-- as long as the new value is not used in the same transaction (it is not).
ALTER TYPE "MachineEventType" ADD VALUE 'SESSION_CLOSE_WATERMARK';

-- AlterTable
ALTER TABLE "DepositSession" ADD COLUMN     "closeWatermarkAt" TIMESTAMP(3),
ADD COLUMN     "closeWatermarkEventCount" INTEGER,
ADD COLUMN     "policySnapshotJson" JSONB,
ADD COLUMN     "policyVersion" TEXT;

-- CreateTable
CREATE TABLE "RewardBudgetRelease" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT,
    "businessKey" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT,
    "releasedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardBudgetRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RewardBudgetRelease_businessKey_key" ON "RewardBudgetRelease"("businessKey");

-- CreateIndex
CREATE INDEX "RewardBudgetRelease_reservationId_idx" ON "RewardBudgetRelease"("reservationId");

-- AddForeignKey
ALTER TABLE "RewardBudgetRelease" ADD CONSTRAINT "RewardBudgetRelease_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "RewardBudgetReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
