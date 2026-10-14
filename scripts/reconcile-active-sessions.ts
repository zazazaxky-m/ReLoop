/**
 * Read-only dry run of machines with more than one active deposit session
 * (task R03, finding EX-04).
 *
 *   npx tsx scripts/reconcile-active-sessions.ts      # or: npm run reconcile:sessions
 *
 * Prints one JSON report on stdout. Exit code 0 = nothing blocks the enforce
 * migration, 3 = enforce-blocking findings present, 1 = the inventory itself
 * failed. It runs in a single READ ONLY, REPEATABLE
 * READ transaction, so every section describes the same snapshot, and it can
 * never write: there is no apply/close/delete mode.
 *
 * Sections:
 *   duplicateActiveSessions  machines with more than one session in RESERVED,
 *                            ACTIVE, PROCESSING_ITEM or REVIEW (blocks the enforce
 *                            migration 20261014120100_one_active_machine_session_enforce).
 *                            Per session, oldest first: owner, status, times, the
 *                            deadline the timeout policy uses and whether it has
 *                            passed, item counts by status, the undecided items
 *                            (PENDING, no acceptance point: they move to REVIEW when
 *                            the session times out), its ledger rows, and machine-event
 *                            evidence (count, first and last event).
 *   activeWithoutTimeout     active sessions without timeoutAt (legacy rows, e.g.
 *                            REVIEW sessions created before R03). Their deadline is
 *                            updatedAt + the machine's idle timeout; the timeout
 *                            policy closes them on the next machine poll or scan
 *                            after that (informational, does not block).
 *
 * Procedure before the enforce migration and for any finding:
 *   1. Run this script against the target database and keep the JSON with the case.
 *   2. Never pick the newest session and never edit rows. While a machine has
 *      several live sessions it gets no lease (the RVM stops) and every scan on
 *      it is refused, so no new item enters any of them. Each session then ends
 *      through the normal paths only:
 *        - its owner finishes or cancels it in the app (refused while the
 *          machine still decides one of its items), or
 *        - the timeout policy closes it once `deadlinePassed` is true (on the
 *          next machine poll or scan): undecided items move to REVIEW with
 *          reason SESSION_TIMEOUT. With the lease withheld, every session
 *          reaches its deadline within the machine's idle timeout.
 *      Items now in REVIEW are decided in the review queue (reject, or a
 *      superadmin legacy approval) or by a late acceptance/rejection event of
 *      the same session; the session/owner evidence below tells the reviewer
 *      which deposit each belongs to. Record each decision in the case log.
 *   3. Re-run this script until `summary.blocksEnforcement` is 0.
 *   4. If `prisma migrate deploy` already failed on the enforce migration, mark
 *      it rolled back (its guard runs before any DDL, so nothing was applied):
 *        npx prisma migrate resolve --rolled-back 20261014120100_one_active_machine_session_enforce
 *      then run `npx prisma migrate deploy` again.
 */
import type { Prisma } from "@prisma/client";

type RawReader = Pick<Prisma.TransactionClient, "$queryRaw">;

export interface ActiveSessionEvidence {
  sessionId: string;
  userId: string;
  status: string;
  campaignId: string | null;
  startedAt: Date;
  updatedAt: Date;
  timeoutAt: Date | null;
  /** timeoutAt, or updatedAt + the machine's idle timeout (lib/deposit-session-service.ts sessionDeadline). */
  deadline: Date;
  deadlinePassed: boolean;
  items: Record<string, number>;
  undecidedItemIds: string[];
  ledger: { rows: number; amount: number };
  eventCount: number;
  firstEvent: { id: string; localEventId: string; eventType: string; occurredAt: Date; receivedAt: Date } | null;
  lastEvent: { id: string; localEventId: string; eventType: string; occurredAt: Date; receivedAt: Date } | null;
}

export interface ActiveSessionInventory {
  generatedAt: string;
  snapshot: { readOnly: string; isolation: string };
  duplicateActiveSessions: {
    machineId: string;
    machineCode: string;
    organizationId: string;
    idleTimeoutMinutes: number;
    sessions: ActiveSessionEvidence[];
  }[];
  activeWithoutTimeout: {
    sessionId: string; machineId: string; userId: string; status: string; updatedAt: Date; deadline: Date; deadlinePassed: boolean;
  }[];
  summary: { machinesWithDuplicates: number; duplicateActiveSessions: number; activeWithoutTimeout: number; blocksEnforcement: number };
  clean: boolean;
}

type EventRow = { id: string; localEventId: string; eventType: string; occurredAt: Date; receivedAt: Date };

/** Collects the inventory through `db` (a read-only transaction in main()). */
export async function collectActiveSessionConflicts(db: RawReader): Promise<ActiveSessionInventory> {
  const [snapshot] = await db.$queryRaw<{ readOnly: string; isolation: string }[]>`
    SELECT current_setting('transaction_read_only') AS "readOnly",
           current_setting('transaction_isolation') AS isolation`;
  const [{ now }] = await db.$queryRaw<{ now: Date }[]>`SELECT now() AS now`;

  // Same predicate as the enforce migration's guard and partial unique index.
  const sessions = await db.$queryRaw<{
    sessionId: string; machineId: string; machineCode: string; organizationId: string; idleTimeoutMinutes: number;
    userId: string; status: string; campaignId: string | null; startedAt: Date; updatedAt: Date; timeoutAt: Date | null;
    deadline: Date;
  }[]>`
    SELECT s.id AS "sessionId", s."machineId", m."machineCode", m."organizationId",
           m."sessionIdleTimeoutMinutes" AS "idleTimeoutMinutes", s."userId", s.status::text AS status,
           s."campaignId", s."startedAt", s."updatedAt", s."timeoutAt",
           COALESCE(s."timeoutAt", s."updatedAt" + make_interval(mins => m."sessionIdleTimeoutMinutes")) AS deadline
    FROM "DepositSession" s
    JOIN "Machine" m ON m.id = s."machineId"
    WHERE s.status::text IN ('RESERVED', 'ACTIVE', 'PROCESSING_ITEM', 'REVIEW')
      AND s."machineId" IN (
        SELECT "machineId" FROM "DepositSession"
        WHERE status::text IN ('RESERVED', 'ACTIVE', 'PROCESSING_ITEM', 'REVIEW')
        GROUP BY "machineId" HAVING count(*) > 1)
    ORDER BY s."machineId", s."startedAt", s.id`;

  const groups = new Map<string, ActiveSessionInventory["duplicateActiveSessions"][number]>();
  for (const row of sessions) {
    const items = await db.$queryRaw<{ status: string; count: number }[]>`
      SELECT status::text AS status, count(*)::int AS count FROM "DepositItem"
      WHERE "sessionId" = ${row.sessionId} GROUP BY status ORDER BY status`;
    const undecided = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "DepositItem"
      WHERE "sessionId" = ${row.sessionId} AND status = 'PENDING' AND "acceptanceEventId" IS NULL ORDER BY id`;
    const [ledger] = await db.$queryRaw<{ rows: number; amount: bigint | null }[]>`
      SELECT count(*)::int AS rows, SUM(amount)::bigint AS amount FROM "RewardLedger" WHERE "sessionId" = ${row.sessionId}`;
    const [{ count: eventCount }] = await db.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM "MachineEvent" WHERE "sessionId" = ${row.sessionId}`;
    const [firstEvent] = await db.$queryRaw<EventRow[]>`
      SELECT id, "localEventId", "eventType"::text AS "eventType", "occurredAt", "receivedAt" FROM "MachineEvent"
      WHERE "sessionId" = ${row.sessionId} ORDER BY "occurredAt", id LIMIT 1`;
    const [lastEvent] = await db.$queryRaw<EventRow[]>`
      SELECT id, "localEventId", "eventType"::text AS "eventType", "occurredAt", "receivedAt" FROM "MachineEvent"
      WHERE "sessionId" = ${row.sessionId} ORDER BY "occurredAt" DESC, id DESC LIMIT 1`;

    const group = groups.get(row.machineId) ?? {
      machineId: row.machineId, machineCode: row.machineCode, organizationId: row.organizationId,
      idleTimeoutMinutes: row.idleTimeoutMinutes, sessions: [],
    };
    group.sessions.push({
      sessionId: row.sessionId,
      userId: row.userId,
      status: row.status,
      campaignId: row.campaignId,
      startedAt: row.startedAt,
      updatedAt: row.updatedAt,
      timeoutAt: row.timeoutAt,
      deadline: row.deadline,
      deadlinePassed: row.deadline.getTime() <= now.getTime(),
      items: Object.fromEntries(items.map((item) => [item.status, item.count])),
      undecidedItemIds: undecided.map((item) => item.id),
      ledger: { rows: ledger.rows, amount: Number(ledger.amount ?? 0) },
      eventCount,
      firstEvent: firstEvent ?? null,
      lastEvent: lastEvent ?? null,
    });
    groups.set(row.machineId, group);
  }
  const duplicateActiveSessions = [...groups.values()];

  const withoutTimeout = await db.$queryRaw<{
    sessionId: string; machineId: string; userId: string; status: string; updatedAt: Date; deadline: Date;
  }[]>`
    SELECT s.id AS "sessionId", s."machineId", s."userId", s.status::text AS status, s."updatedAt",
           s."updatedAt" + make_interval(mins => m."sessionIdleTimeoutMinutes") AS deadline
    FROM "DepositSession" s JOIN "Machine" m ON m.id = s."machineId"
    WHERE s.status::text IN ('RESERVED', 'ACTIVE', 'PROCESSING_ITEM', 'REVIEW') AND s."timeoutAt" IS NULL
    ORDER BY s."machineId", s."updatedAt", s.id`;
  const activeWithoutTimeout = withoutTimeout.map((row) => ({
    ...row, deadlinePassed: row.deadline.getTime() <= now.getTime(),
  }));

  const summary = {
    machinesWithDuplicates: duplicateActiveSessions.length,
    duplicateActiveSessions: duplicateActiveSessions.reduce((sum, group) => sum + group.sessions.length, 0),
    activeWithoutTimeout: activeWithoutTimeout.length,
    blocksEnforcement: duplicateActiveSessions.length,
  };
  return {
    generatedAt: new Date().toISOString(),
    snapshot,
    duplicateActiveSessions,
    activeWithoutTimeout,
    summary,
    clean: summary.blocksEnforcement === 0,
  };
}

async function main() {
  const { prisma } = await import("../lib/prisma");
  try {
    const inventory = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return collectActiveSessionConflicts(tx);
    }, { isolationLevel: "RepeatableRead", timeout: 120_000 });
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
    process.exitCode = inventory.clean ? 0 : 3;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /reconcile-active-sessions\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error("[reconcile:sessions] failed", error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
