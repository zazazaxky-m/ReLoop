-- AlterTable
CREATE INDEX IF NOT EXISTS "Trip_userId_idx" ON "Trip"("userId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Trip_userId_fkey'
  ) THEN
    ALTER TABLE "Trip" ADD CONSTRAINT "Trip_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
