-- A02 (SEC-04): MFA setup/replacement waits in separate pending columns, so a
-- new setup never touches the active factor (User.totpSecret / mfaEnabled).
--
-- Expand: three nullable columns. pendingTotpSecret is AES-GCM ciphertext
-- (lib/encryption.ts, the same helper as totpSecret); pendingTotpExpiresAt is
-- the 10-minute deadline; pendingTotpTokenVersion is the User.tokenVersion the
-- setup started in (any later bump voids it).
--
-- Enforce: the three columns are all set or all null. Every existing row has
-- them all null and code before A02 never writes them, so the constraint holds
-- without any backfill and old and new code can run side by side during the
-- rollout. Prisma 6 does not model CHECK constraints; it is kept by hand like
-- the partial unique indexes of M01/M03 (no DROP of those indexes here).
-- No backfill, no rewrite of existing rows.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "pendingTotpExpiresAt" TIMESTAMP(3),
ADD COLUMN     "pendingTotpSecret" TEXT,
ADD COLUMN     "pendingTotpTokenVersion" INTEGER;

-- Enforce: all-or-none pending setup.
ALTER TABLE "User" ADD CONSTRAINT "User_pendingTotp_all_or_none" CHECK (
  ("pendingTotpSecret" IS NULL AND "pendingTotpExpiresAt" IS NULL AND "pendingTotpTokenVersion" IS NULL)
  OR ("pendingTotpSecret" IS NOT NULL AND "pendingTotpExpiresAt" IS NOT NULL AND "pendingTotpTokenVersion" IS NOT NULL)
);
