-- M02 expand step: immutable payout destination snapshot and reconciliation
-- hold on Redemption. Additive only: no backfill, no rewrite of history.
--
-- Legacy rows keep payoutDestinationSource NULL. The application never guesses
-- their destination at deploy time (encryption needs the application key and
-- the request-time account state is unknown). Instead, the first operator
-- action that needs a destination (process / success / proof upload) copies
-- the account as it is then, under the user + redemption locks, and records
-- payoutDestinationSource = LEGACY_ACCOUNT_FALLBACK; a legacy row whose account
-- no longer exists is recorded as LEGACY_UNAVAILABLE without any identifier.
-- New requests always store REQUEST_SNAPSHOT inside the request transaction.
--
-- reconciliationRequired defaults to false, so existing rows are unaffected;
-- the constant default makes this a metadata-only change on PostgreSQL 11+.

-- CreateEnum
CREATE TYPE "PayoutDestinationSource" AS ENUM ('REQUEST_SNAPSHOT', 'LEGACY_ACCOUNT_FALLBACK', 'LEGACY_UNAVAILABLE');

-- AlterTable
ALTER TABLE "Redemption" ADD COLUMN     "payoutDestinationCapturedAt" TIMESTAMP(3),
ADD COLUMN     "payoutDestinationIdentifier" TEXT,
ADD COLUMN     "payoutDestinationName" TEXT,
ADD COLUMN     "payoutDestinationProvider" "PayoutProviderType",
ADD COLUMN     "payoutDestinationSource" "PayoutDestinationSource",
ADD COLUMN     "reconciliationFlaggedAt" TIMESTAMP(3),
ADD COLUMN     "reconciliationNote" TEXT,
ADD COLUMN     "reconciliationRequired" BOOLEAN NOT NULL DEFAULT false;
