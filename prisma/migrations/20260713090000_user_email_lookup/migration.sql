-- Blind index for email equality; email column no longer unique (ciphertext is).
-- Default cuid is only a create-time placeholder; app middleware + backfill set the HMAC.
ALTER TABLE "User" ADD COLUMN "emailLookup" TEXT;

UPDATE "User" SET "emailLookup" = 'pending:' || "id" WHERE "emailLookup" IS NULL;

ALTER TABLE "User" ALTER COLUMN "emailLookup" SET NOT NULL;
ALTER TABLE "User" ALTER COLUMN "emailLookup" SET DEFAULT gen_random_uuid()::text;

DROP INDEX IF EXISTS "User_email_key";
CREATE UNIQUE INDEX "User_emailLookup_key" ON "User"("emailLookup");
