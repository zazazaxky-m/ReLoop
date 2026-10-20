-- A03 (SEC-03): prove the mailbox before travel-agent access.
--
-- Expand only. Every column is nullable or has a default and no existing row
-- is rewritten:
--   * User."emailVerifiedAt" stays NULL for every existing account (nobody
--     has proven a mailbox yet).
--   * TravelAgentUser."verifiedAt" stays NULL for every existing membership.
--     Memberships are NOT auto-verified: the legacy ones were created by
--     matching an unverified registration email to an invitation (SEC-03).
--   * TravelAgentInvite gets token columns; legacy invites have no token, so
--     they cannot be accepted until an admin re-sends them.
--
-- Enforcement is in code (lib/invitations.ts VERIFIED_MEMBERSHIP): from this
-- release, trip access through a travel agent needs a verified membership and
-- a verified account email. Before deploying, run the read-only impact report
--   npm run report:travel-agent-access
-- to list the memberships that lose trip access, and communicate the rollout
-- (re-sent invitations) to those agents (Z01).
--
-- Generated with `prisma migrate diff --from-schema-datamodel <bc0838d schema>
-- --to-schema-datamodel prisma/schema.prisma --script`; it drops nothing.

-- CreateEnum
CREATE TYPE "EmailTokenPurpose" AS ENUM ('VERIFY_EMAIL');

-- CreateEnum
CREATE TYPE "EmailOutboxKind" AS ENUM ('TRAVEL_AGENT_INVITE', 'EMAIL_VERIFICATION');

-- CreateEnum
CREATE TYPE "EmailOutboxStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'CANCELLED', 'FAILED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TravelAgentInvite" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedById" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "tokenHash" TEXT;

-- AlterTable
ALTER TABLE "TravelAgentUser" ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "EmailTokenPurpose" NOT NULL DEFAULT 'VERIFY_EMAIL',
    "emailLookup" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "kind" "EmailOutboxKind" NOT NULL,
    "inviteId" TEXT,
    "userId" TEXT,
    "emailLookup" TEXT,
    "status" "EmailOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_userId_idx" ON "EmailVerificationToken"("userId");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_expiresAt_idx" ON "EmailVerificationToken"("expiresAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_inviteId_idx" ON "EmailOutbox"("inviteId");

-- CreateIndex
CREATE INDEX "EmailOutbox_userId_idx" ON "EmailOutbox"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TravelAgentInvite_tokenHash_key" ON "TravelAgentInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "TravelAgentInvite_acceptedById_idx" ON "TravelAgentInvite"("acceptedById");

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "TravelAgentInvite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

