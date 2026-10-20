-- A04 expand step: resumable, verified account erasure (SEC-05).
-- Additive only. No backfill and no rewrite of any existing row:
--
-- * DeletionRequestStatus gains PENDING_RECONCILIATION (verified, held until
--   the owner's balances/payouts settle; nothing erased yet) and
--   RETRYABLE_FAILED (a required step failed and is retried).
-- * DeletionRequest gains owner-verification columns. Existing rows keep
--   verificationMethod NULL = never verified, so lib/erasure-jobs.ts never
--   executes them: legacy public requests (all PENDING, never processed by
--   code) must be re-confirmed by the owner or verified by an operator
--   (docs/privacy-erasure.md). `email` becomes nullable because requests made
--   from a signed-in session do not copy the address, and a completed erasure
--   blanks it.
-- * ErasureJobStep holds the durable steps of one request, unique per
--   (requestId, step), with attempts / nextAttemptAt / completedAt. A request
--   is COMPLETED only when all of its steps are complete.
--
-- No enforce step is needed: new columns are nullable/defaulted and only new
-- rows use them. The User row lock (lib/db-locks.ts) serializes erasure with
-- every wallet writer, so no partial unique index is added here.
--
-- PostgreSQL 12+ accepts ALTER TYPE ... ADD VALUE inside the migration
-- transaction; the new values are not used until a later transaction.

-- CreateEnum
CREATE TYPE "DeletionVerificationMethod" AS ENUM ('SESSION', 'EMAIL_TOKEN', 'OPERATOR');

-- CreateEnum
CREATE TYPE "ErasureStepName" AS ENUM ('ANONYMIZE_ACCOUNT', 'DELETE_PROOF_FILES');

-- AlterEnum


ALTER TYPE "DeletionRequestStatus" ADD VALUE 'PENDING_RECONCILIATION';
ALTER TYPE "DeletionRequestStatus" ADD VALUE 'RETRYABLE_FAILED';

-- AlterTable
ALTER TABLE "DeletionRequest" ADD COLUMN     "reconciliationJson" JSONB,
ADD COLUMN     "verificationExpiresAt" TIMESTAMP(3),
ADD COLUMN     "verificationMethod" "DeletionVerificationMethod",
ADD COLUMN     "verificationTokenHash" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ErasureJobStep" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "step" "ErasureStepName" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "payloadJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErasureJobStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErasureJobStep_completedAt_nextAttemptAt_idx" ON "ErasureJobStep"("completedAt", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "ErasureJobStep_requestId_step_key" ON "ErasureJobStep"("requestId", "step");

-- CreateIndex
CREATE UNIQUE INDEX "DeletionRequest_verificationTokenHash_key" ON "DeletionRequest"("verificationTokenHash");

-- CreateIndex
CREATE INDEX "DeletionRequest_userId_status_idx" ON "DeletionRequest"("userId", "status");

-- AddForeignKey
ALTER TABLE "ErasureJobStep" ADD CONSTRAINT "ErasureJobStep_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "DeletionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

