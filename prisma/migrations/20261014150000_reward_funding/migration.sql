-- B01a (BIZ-02): reward funding domain, expand step.
--
-- Adds the organization funding account, immutable funding entries, the
-- admission reservations and the per-earning commits of lib/reward-funding.ts,
-- plus the nullable budget/ceiling configuration on Campaign and Machine.
-- Expand only: new enums, new tables, nullable or defaulted columns. Nothing
-- here constrains or rewrites existing rows (RewardLedger is untouched); the
-- new uniques are on new tables only, so no reconcile/enforce step is needed.
-- Generated with `prisma migrate diff --from-schema-datamodel <e1dcd7e schema>
-- --to-schema-datamodel prisma/schema.prisma --script`; it contains no DROP
-- INDEX for the hand-written partial unique indexes.
--
-- Rollout (docs/database-ledger-guide.md section 7): this release runs in
-- shadow mode (REWARD_FUNDING_ENFORCED unset/false): every reservation, commit,
-- release and payout entry is recorded but no admission is refused. Enforcement
-- is switched on only after B02 backfilled opening obligations and operators
-- confirmed real funding with evidence.

-- CreateEnum
CREATE TYPE "FundingEntryKind" AS ENUM ('CONFIRMED_TOPUP', 'PAYOUT', 'CORRECTION');

-- CreateEnum
CREATE TYPE "RewardReservationSource" AS ENUM ('SESSION', 'TRIP');

-- CreateEnum
CREATE TYPE "RewardReservationStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "maxItemsPerSession" INTEGER,
ADD COLUMN     "maxRewardPerSessionRupiah" INTEGER;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "heldRupiah" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "maxRewardPerSessionRupiah" INTEGER,
ADD COLUMN     "rewardBudgetRupiah" INTEGER,
ADD COLUMN     "spentRupiah" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RewardFundingAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "confirmedRupiah" INTEGER NOT NULL DEFAULT 0,
    "heldRupiah" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardFundingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FundingEntry" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "kind" "FundingEntryKind" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "note" TEXT,
    "verifiedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardBudgetReservation" (
    "id" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT,
    "userId" TEXT NOT NULL,
    "sourceType" "RewardReservationSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ceilingRupiah" INTEGER NOT NULL,
    "remainingRupiah" INTEGER NOT NULL,
    "shortfallRupiah" INTEGER NOT NULL DEFAULT 0,
    "campaignShortfallRupiah" INTEGER NOT NULL DEFAULT 0,
    "status" "RewardReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardBudgetReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardBudgetCommit" (
    "id" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "campaignId" TEXT,
    "userId" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "heldRupiah" INTEGER NOT NULL,
    "paidRupiah" INTEGER NOT NULL DEFAULT 0,
    "uncoveredRupiah" INTEGER NOT NULL DEFAULT 0,
    "reviewPending" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardBudgetCommit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RewardFundingAccount_organizationId_key" ON "RewardFundingAccount"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "FundingEntry_businessKey_key" ON "FundingEntry"("businessKey");

-- CreateIndex
CREATE INDEX "FundingEntry_accountId_createdAt_idx" ON "FundingEntry"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "FundingEntry_kind_reference_idx" ON "FundingEntry"("kind", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "RewardBudgetReservation_businessKey_key" ON "RewardBudgetReservation"("businessKey");

-- CreateIndex
CREATE INDEX "RewardBudgetReservation_accountId_status_idx" ON "RewardBudgetReservation"("accountId", "status");

-- CreateIndex
CREATE INDEX "RewardBudgetReservation_sourceType_sourceId_idx" ON "RewardBudgetReservation"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "RewardBudgetReservation_userId_idx" ON "RewardBudgetReservation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardBudgetCommit_businessKey_key" ON "RewardBudgetCommit"("businessKey");

-- CreateIndex
CREATE INDEX "RewardBudgetCommit_reservationId_idx" ON "RewardBudgetCommit"("reservationId");

-- CreateIndex
CREATE INDEX "RewardBudgetCommit_accountId_idx" ON "RewardBudgetCommit"("accountId");

-- CreateIndex
CREATE INDEX "RewardBudgetCommit_userId_reviewPending_idx" ON "RewardBudgetCommit"("userId", "reviewPending");

-- AddForeignKey
ALTER TABLE "RewardFundingAccount" ADD CONSTRAINT "RewardFundingAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundingEntry" ADD CONSTRAINT "FundingEntry_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RewardFundingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardBudgetReservation" ADD CONSTRAINT "RewardBudgetReservation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RewardFundingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardBudgetReservation" ADD CONSTRAINT "RewardBudgetReservation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardBudgetCommit" ADD CONSTRAINT "RewardBudgetCommit_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "RewardBudgetReservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardBudgetCommit" ADD CONSTRAINT "RewardBudgetCommit_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "RewardFundingAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardBudgetCommit" ADD CONSTRAINT "RewardBudgetCommit_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

