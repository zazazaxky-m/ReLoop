/**
 * Email outbox runner (task A03, finding SEC-03).
 *
 * Invitation and email-verification mail is queued in the database together
 * with the change that needs it, and tried once right after the request
 * (lib/email-outbox.ts). This runner delivers whatever is still due: a failed
 * attempt after its backoff, or a row whose sender died mid-send. This
 * repository does not schedule it: operations runs it every few minutes (cron,
 * a CI schedule, or by hand); see docs/mobile-api.md.
 *
 *   npx tsx scripts/process-email-outbox.ts              # one pass over due rows
 *   npx tsx scripts/process-email-outbox.ts --limit 20   # at most 20 rows this pass
 *   npx tsx scripts/process-email-outbox.ts --id <id>    # one row now, if it is due
 *
 * Output: one JSON document on stdout with outbox ids, kinds and outcomes
 * only (no address, no link, no token). Exit code 0 = nothing failing,
 * 3 = at least one row failed this pass (RETRY or FAILED: alert on it),
 * 2 = bad arguments, 1 = the runner failed.
 */

export type OutboxRunnerCommand = { kind: "pass"; limit: number } | { kind: "one"; id: string };

const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Parses argv (without node and script path). Throws on anything unexpected. */
export function parseOutboxArgs(argv: readonly string[]): OutboxRunnerCommand {
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!["--limit", "--id"].includes(key) || value === undefined) {
      throw new Error(`unexpected argument ${JSON.stringify(key)}`);
    }
    if (options.has(key)) throw new Error(`duplicate argument ${key}`);
    options.set(key, value);
  }
  const id = options.get("--id");
  if (id !== undefined) {
    if (!ID.test(id) || options.has("--limit")) throw new Error("--id <outboxId> takes no other option");
    return { kind: "one", id };
  }
  const limit = Number(options.get("--limit") ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit must be an integer from 1 to 1000");
  return { kind: "pass", limit };
}

async function main() {
  let command: OutboxRunnerCommand;
  try {
    command = parseOutboxArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[email-outbox] ${(error as Error).message}`);
    process.exitCode = 2;
    return;
  }

  const { prisma } = await import("../lib/prisma");
  const outbox = await import("../lib/email-outbox");
  try {
    const results =
      command.kind === "pass"
        ? await outbox.processDueEmailOutbox({ limit: command.limit })
        : [await outbox.deliverEmailOutbox(command.id)];
    const failing = results.filter((result) => result.outcome === "RETRY" || result.outcome === "FAILED").length;
    const deadLetters = await prisma.emailOutbox.count({ where: { status: "FAILED" } });
    process.stdout.write(`${JSON.stringify({ ranAt: new Date().toISOString(), results, failing, deadLetters }, null, 2)}\n`);
    process.exitCode = failing > 0 ? 3 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /process-email-outbox\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error("[email-outbox] failed", error instanceof Error ? error.name : "unknown");
    process.exit(1);
  });
}
