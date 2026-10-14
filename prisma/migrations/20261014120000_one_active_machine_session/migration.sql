-- R03 expand step (EX-04): one active deposit session per machine.
--
-- No column, table or index is added and no row is written. The expand phase
-- of this change is the application release that ships with it:
--   * every start, finish, cancel and timeout of a deposit session runs under
--     User -> Machine row locks and re-reads the machine's sessions
--     (lib/deposit-session-service.ts), so no new duplicate can appear;
--   * the machine lease is withheld while a machine has several live sessions
--     (app/api/machine-session/[code]/route.ts), so the machine stops instead
--     of the server picking the newest one;
--   * the timeout policy closes a session only after its deadline (every lease
--     issued for it has expired) and moves its undecided items to REVIEW.
-- This step only reports, during deploy, how many machines the enforce step
-- (20261014120100_one_active_machine_session_enforce) would refuse, so the
-- operator can reconcile before it runs:
--   npx tsx scripts/reconcile-active-sessions.ts   (read-only dry run)

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
    RAISE NOTICE 'one_active_machine_session: % machine(s) with more than one active deposit session (% sessions). These machines get no lease until reconciled; the enforce migration will refuse to run. See "npx tsx scripts/reconcile-active-sessions.ts".',
      conflicted_machines, conflicted_sessions;
  END IF;
END $$;
