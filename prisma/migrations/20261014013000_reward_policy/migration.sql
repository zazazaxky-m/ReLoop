-- M04 (LOG-04, LOG-05, EX-01, EX-03): centralized reward policy.
--
-- Expand only: new enums, nullable/defaulted columns and a new table. Every
-- default keeps the behaviour before M04 (machines verify by weight only,
-- sessions without a campaign earn money, EVENT/SCHOOL_PROGRAM campaigns stay
-- off machines unless already used there, see the reconcile step below).
-- Financial history (RewardLedger) is not touched. No enforce step: nothing
-- here constrains existing rows. Generated with
-- `prisma migrate diff --from-schema-datamodel <6f0e384> --to-schema-datamodel prisma/schema.prisma --script`;
-- it contains no DROP INDEX for the hand-written partial unique indexes.

-- CreateEnum
CREATE TYPE "MaterialVerification" AS ENUM ('AI_REQUIRED', 'BARCODE_WEIGHT', 'WEIGHT_ONLY');

-- CreateEnum
CREATE TYPE "RewardReconciliationStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "machineRewardMode" "CampaignRewardMode" NOT NULL DEFAULT 'MONEY_REWARD';

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "materialVerification" "MaterialVerification" NOT NULL DEFAULT 'WEIGHT_ONLY';

-- AlterTable
ALTER TABLE "WasteType" ADD COLUMN     "aiAcceptedLabels" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "supportsMachine" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "RewardReconciliationCase" (
    "id" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "depositItemId" TEXT,
    "amount" INTEGER NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "status" "RewardReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardReconciliationCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RewardReconciliationCase_businessKey_key" ON "RewardReconciliationCase"("businessKey");

-- CreateIndex
CREATE INDEX "RewardReconciliationCase_status_createdAt_idx" ON "RewardReconciliationCase"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RewardReconciliationCase_userId_idx" ON "RewardReconciliationCase"("userId");

-- AddForeignKey
ALTER TABLE "RewardReconciliationCase" ADD CONSTRAINT "RewardReconciliationCase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reconcile (configuration only, idempotent; only rows whose taxonomy is still empty).
-- Accepted classifier labels for PET and can waste types, using the labels the
-- edge classifier emits (rvm/config.py camera_classifier_labels): `PET` as a
-- word or a plastic bottle ("Botol Plastik"; a glass "Botol Kaca" is not PET),
-- and `kaleng`/`can`/`aluminium` as a word. "Anorganik"
-- is the type migration 20260701113000 renamed "Kaleng Aluminium" into and it
-- covers both materials; "Organik" gets no label (the classifier has none for
-- organic waste), so it keeps being verified by weight until an admin
-- configures it.
UPDATE "WasteType" SET "aiAcceptedLabels" = ARRAY['bottle_pet']
WHERE COALESCE(cardinality("aiAcceptedLabels"), 0) = 0
  AND ("name" ~* '(^|[^a-z])pet([^a-z]|$)' OR ("name" ~* 'botol' AND "name" ~* 'plasti'));

UPDATE "WasteType" SET "aiAcceptedLabels" = ARRAY['can_aluminium']
WHERE COALESCE(cardinality("aiAcceptedLabels"), 0) = 0
  AND "name" ~* '(^|[^a-z])(kaleng|can|alum[iu]nium)([^a-z]|$)';

UPDATE "WasteType" SET "aiAcceptedLabels" = ARRAY['bottle_pet', 'can_aluminium']
WHERE COALESCE(cardinality("aiAcceptedLabels"), 0) = 0
  AND lower("name") = 'anorganik';

-- EVENT / SCHOOL_PROGRAM campaigns that already ran at machines keep doing so.
UPDATE "Campaign" c SET "supportsMachine" = true
WHERE c."campaignType" IN ('EVENT', 'SCHOOL_PROGRAM')
  AND EXISTS (SELECT 1 FROM "DepositSession" s WHERE s."campaignId" = c."id");
