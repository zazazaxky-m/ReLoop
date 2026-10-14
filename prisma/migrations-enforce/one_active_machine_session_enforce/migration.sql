-- R03 enforce step (EX-04), STAGED: database backstop for one active deposit
-- session per machine.
--
-- This file is deliberately NOT under prisma/migrations, so it can never be
-- deployed in the same release as the expand step
-- (20261014120000_one_active_machine_session). docker-compose starts the web
-- service only after `prisma migrate deploy` succeeds: shipping this guard
-- together with the expand release would keep the new code (which withholds
-- the lease of an ambiguous machine and closes timed-out sessions) from ever
-- running while duplicates exist, so the reconcile window would not exist.
--
-- Release procedure:
--   1. Deploy the expand release (application code + expand migration). From
--      then on every session start/end/timeout runs under the Machine row lock
--      (lib/deposit-session-service.ts): no new duplicate can appear.
--   2. Against production, run `npm run reconcile:sessions`
--      (scripts/reconcile-active-sessions.ts, read-only dry run) and follow the
--      procedure in its header until it exits 0 (`summary.blocksEnforcement`
--      is 0). Rows are never edited, merged or deleted by hand.
--   3. In a LATER release, copy this file to
--        prisma/migrations/<YYYYMMDDHHMMSS>_one_active_machine_session_enforce/migration.sql
--      with a timestamp newer than every applied migration, and deploy.
--   4. The guard below still runs first: if duplicates reappeared it aborts
--      with counts before any DDL. Then mark it rolled back
--        npx prisma migrate resolve --rolled-back <that migration name>
--      reconcile again (step 2) and redeploy.
--
-- The application already serializes sessions on the Machine row lock; this
-- index catches a writer that skips it, and that unique violation is answered
-- as a resume (same owner) or 409 (anyone else). The integration suite applies
-- this exact SQL in the disposable harness database
-- (tests/integration/machine-session-race.test.ts).
--
-- Prisma 6 cannot express a partial index in schema.prisma; this index is
-- hand-written (see the comment on DepositSession). A generated migration that
-- proposes dropping it must be edited before it is applied.

DO $$
DECLARE
  conflicted_machines integer;
  conflicted_sessions integer;
BEGIN
  SELECT count(*), COALESCE(sum(sessions), 0) INTO conflicted_machines, conflicted_sessions FROM (
    SELECT "machineId", count(*) AS sessions FROM "DepositSession"
    WHERE "status" IN ('RESERVED', 'ACTIVE', 'PROCESSING_ITEM', 'REVIEW')
    GROUP BY "machineId" HAVING count(*) > 1
  ) duplicates;

  IF conflicted_machines > 0 THEN
    RAISE EXCEPTION 'one_active_machine_session_enforce aborted: % machine(s) with more than one active deposit session (% sessions). Nothing was changed. Run "npm run reconcile:sessions" (scripts/reconcile-active-sessions.ts) for the dry-run inventory and follow the procedure in its header before deploying again.',
      conflicted_machines, conflicted_sessions;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "DepositSession_one_active_per_machine"
ON "DepositSession" ("machineId")
WHERE "status" IN ('RESERVED','ACTIVE','PROCESSING_ITEM','REVIEW');
