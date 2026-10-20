/**
 * Pickup overdue escalation runner (task B05, finding BIZ-04).
 *
 * An ASSIGNED pickup whose start deadline (`expectedStartAt`, chosen by the
 * operator at dispatch; there is no default SLA) has passed without a start
 * alerts the organization's active admins once per (pickup, version). Admin
 * pickup reads run the same check lazily; this runner covers organizations
 * where nobody is looking. It never reassigns. This repository does not
 * schedule it: operations runs it every few minutes (cron, a CI schedule, or
 * by hand); see docs/mobile-api.md "Pickup dispatch (B05)".
 *
 *   npx tsx scripts/process-pickup-escalations.ts              # one pass, at most 200 tasks
 *   npx tsx scripts/process-pickup-escalations.ts --limit 50   # at most 50 tasks this pass
 *
 * Output: one JSON document on stdout with pickup ids, versions and
 * organization ids only (no names, no contact data). Exit code 0 = pass done
 * (whether or not anything was due), 2 = bad arguments, 1 = the runner failed.
 */

export type EscalationRunnerCommand = { limit: number };

/** Parses argv (without node and script path). Throws on anything unexpected. */
export function parseEscalationArgs(argv: readonly string[]): EscalationRunnerCommand {
  if (argv.length === 0) return { limit: 200 };
  if (argv.length !== 2 || argv[0] !== "--limit") throw new Error(`unexpected arguments ${JSON.stringify(argv)}`);
  const limit = Number(argv[1]);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit must be an integer from 1 to 1000");
  return { limit };
}

async function main() {
  let command: EscalationRunnerCommand;
  try {
    command = parseEscalationArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[pickup-escalations] ${(error as Error).message}`);
    process.exitCode = 2;
    return;
  }

  const { prisma } = await import("../lib/prisma");
  const { escalateOverduePickups } = await import("../lib/pickup-dispatch");
  try {
    const escalated = await escalateOverduePickups({ limit: command.limit });
    process.stdout.write(`${JSON.stringify({ ranAt: new Date().toISOString(), escalated }, null, 2)}\n`);
    process.exitCode = 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /process-pickup-escalations\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error("[pickup-escalations] failed", error instanceof Error ? error.name : "unknown");
    process.exit(1);
  });
}
