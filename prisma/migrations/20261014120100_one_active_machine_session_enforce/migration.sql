-- R03 enforce step (EX-04): database backstop for one active deposit session
-- per machine. The application already serializes every session start/end on
-- the Machine row lock (lib/deposit-session-service.ts); this index catches a
-- writer that skips it, and that unique violation is answered as a resume (same
-- owner) or 409 (anyone else).
--
-- Legacy duplicates are never closed, merged or removed here. If any exist this
-- migration aborts before creating anything, with counts. Procedure (also in the
-- header of scripts/reconcile-active-sessions.ts):
--   1. npx tsx scripts/reconcile-active-sessions.ts   (read-only dry run: each
--      machine's live sessions with owner, items and machine-event evidence)
--   2. Do not pick the newest session. A machine with several live sessions
--      gets no lease (it stops). Each session ends through the normal paths
--      only: its owner finishes/cancels it, or the timeout policy closes it
--      after its deadline and moves its undecided items to REVIEW, where the
--      review queue decides them. Rows are never edited by hand.
--   3. Re-run step 1 until `summary.blocksEnforcement` is 0.
--   4. If `prisma migrate deploy` already failed here, mark it rolled back (the
--      check runs before any DDL, so nothing was applied):
--        npx prisma migrate resolve --rolled-back 20261014120100_one_active_machine_session_enforce
--      then run `npx prisma migrate deploy` again.
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
    RAISE EXCEPTION 'one_active_machine_session_enforce aborted: % machine(s) with more than one active deposit session (% sessions). Nothing was changed. Run "npx tsx scripts/reconcile-active-sessions.ts" for the dry-run inventory and follow the procedure in its header before deploying again.',
      conflicted_machines, conflicted_sessions;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "DepositSession_one_active_per_machine"
ON "DepositSession" ("machineId")
WHERE "status" IN ('RESERVED','ACTIVE','PROCESSING_ITEM','REVIEW');
