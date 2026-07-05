-- AlterTable
ALTER TABLE "DepositItem" ADD COLUMN     "baseRewardAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "complianceMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.0;
