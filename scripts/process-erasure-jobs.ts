/**
 * Account-erasure job runner (task A04, finding SEC-05).
 *
 * This repository does not schedule it: operations decides where and how often
 * it runs (cron, a CI schedule, or by hand); see docs/privacy-erasure.md.
 *
 *   npx tsx scripts/process-erasure-jobs.ts                  # one pass over due requests
 *   npx tsx scripts/process-erasure-jobs.ts --limit 20       # at most 20 requests this pass
 *   npx tsx scripts/process-erasure-jobs.ts --request <id>   # run one request now (ignores backoff)
 *   npx tsx scripts/process-erasure-jobs.ts --operator-verify <id> --reference <ticket>
 *                                                            # owner verified out of band, then run it
 *
 * A pass picks every verified, unfinished FULL request whose next step is due:
 * held requests (PENDING_RECONCILIATION) after their re-check interval, failed
 * steps (RETRYABLE_FAILED) after their backoff. Unverified public requests are
 * never picked. Each run is idempotent; running two passes at once is safe.
 *
 * Output: one JSON document on stdout with request ids and statuses only (no
 * personal data). Exit code 0 = nothing failing, 3 = at least one request is
 * RETRYABLE_FAILED (alert on it), 2 = bad arguments, 1 = the runner failed.
 */

export type RunnerCommand =
  | { kind: "pass"; limit: number }
  | { kind: "request"; requestId: string }
  | { kind: "operator-verify"; requestId: string; reference: string };

const ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Parses argv (without node and script path). Throws on anything unexpected. */
export function parseRunnerArgs(argv: readonly string[]): RunnerCommand {
  const options = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!["--limit", "--request", "--operator-verify", "--reference"].includes(key) || value === undefined) {
      throw new Error(`unexpected argument ${JSON.stringify(key)}`);
    }
    if (options.has(key)) throw new Error(`duplicate argument ${key}`);
    options.set(key, value);
  }

  const verify = options.get("--operator-verify");
  const request = options.get("--request");
  if (verify !== undefined) {
    const reference = options.get("--reference");
    if (!ID.test(verify) || !reference || request !== undefined || options.has("--limit")) {
      throw new Error("--operator-verify <requestId> needs --reference <ticket> and no other option");
    }
    return { kind: "operator-verify", requestId: verify, reference };
  }
  if (options.has("--reference")) throw new Error("--reference is only valid with --operator-verify");
  if (request !== undefined) {
    if (!ID.test(request) || options.has("--limit")) throw new Error("--request <requestId> takes no other option");
    return { kind: "request", requestId: request };
  }
  const rawLimit = options.get("--limit") ?? "50";
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit must be an integer from 1 to 1000");
  return { kind: "pass", limit };
}

async function main() {
  let command: RunnerCommand;
  try {
    command = parseRunnerArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[erasure-jobs] ${(error as Error).message}`);
    process.exitCode = 2;
    return;
  }

  const { prisma } = await import("../lib/prisma");
  const jobs = await import("../lib/erasure-jobs");
  try {
    let results: { requestId: string; status: string; completed: boolean; error?: string }[];
    if (command.kind === "pass") {
      results = await jobs.processDueErasureJobs({ limit: command.limit });
    } else {
      if (command.kind === "operator-verify") {
        await jobs.verifyDeletionRequestByOperator(command.requestId, { reference: command.reference });
      }
      await jobs.runErasureJob(command.requestId);
      const view = await jobs.getErasureStatus(command.requestId);
      results = [{ requestId: view.requestId, status: view.status, completed: view.completed }];
    }
    const failing = results.filter((result) => result.status === "RETRYABLE_FAILED").length;
    process.stdout.write(`${JSON.stringify({ ranAt: new Date().toISOString(), results, failing }, null, 2)}\n`);
    process.exitCode = failing > 0 ? 3 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /process-erasure-jobs\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error("[erasure-jobs] failed", error instanceof Error ? error.name : "unknown");
    process.exit(1);
  });
}
