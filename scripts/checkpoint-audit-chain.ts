/**
 * Legacy audit chain checkpoint (task A05, finding SEC-08).
 *
 *   npx tsx scripts/checkpoint-audit-chain.ts                     # dry run (default): prints count and digest
 *   npx tsx scripts/checkpoint-audit-chain.ts --apply --expected-digest <sha256-hex>
 *
 * Rows written before A05 (AuditLog.chainVersion = 1) are an archived legacy
 * chain. This script never modifies, deletes or re-signs them. The dry run
 * reads the archive in one read-only snapshot and prints its row count, its
 * sha256 digest (over the stored columns, no secret involved) and whether its
 * stored checksums can be verified. After an operator has reviewed that
 * digest, --apply appends ONE v2 audit event (AUDIT_CHAIN_CHECKPOINT) holding
 * the count and digest, but only if the digest recomputed under the chain lock
 * still equals --expected-digest and no checkpoint exists yet. From then on
 * POST /api/audit/verify reports whether the archive still matches it.
 *
 * Output: one JSON document on stdout (counts, digests, status; never the
 * secret). Exit code 0 = dry run printed, checkpoint written, already recorded
 * with the same digest, or nothing to checkpoint; 3 = refused (digest differs
 * from --expected-digest, or an existing checkpoint no longer matches the
 * archive); 2 = bad arguments; 1 = the script failed.
 * Procedure: docs/security/audit-chain.md.
 */

export type CheckpointCommand = { kind: "dry-run" } | { kind: "apply"; expectedDigest: string };

const DIGEST = /^[0-9a-f]{64}$/;

/** Parses argv (without node and script path). Throws on anything unexpected. */
export function parseCheckpointArgs(argv: readonly string[]): CheckpointCommand {
  let apply = false;
  let expectedDigest: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply" && !apply) {
      apply = true;
    } else if (arg === "--expected-digest" && expectedDigest === undefined && argv[i + 1] !== undefined) {
      expectedDigest = argv[i + 1];
      i += 1;
    } else {
      throw new Error(`unexpected argument ${JSON.stringify(arg)}`);
    }
  }
  if (!apply) {
    if (expectedDigest !== undefined) throw new Error("--expected-digest is only valid with --apply");
    return { kind: "dry-run" };
  }
  if (expectedDigest === undefined || !DIGEST.test(expectedDigest)) {
    throw new Error("--apply needs --expected-digest <64 lowercase hex characters> from a reviewed dry run");
  }
  return { kind: "apply", expectedDigest };
}

const REFUSED = new Set(["digest-mismatch", "checkpoint-conflict"]);

const NEXT_STEP: Record<string, string> = {
  "dry-run": "Review legacyCount/legacyDigest, then run with --apply --expected-digest <legacyDigest>.",
  written: "Checkpoint recorded in the v2 chain. Verify with POST /api/audit/verify (legacyCheckpoint: matches).",
  "already-recorded": "A checkpoint with this digest already exists; nothing was written.",
  "nothing-to-checkpoint": "There are no legacy (version 1) rows; nothing was written.",
  "digest-mismatch": "The legacy archive changed since the reviewed dry run; nothing was written. Run the dry run again and review.",
  "checkpoint-conflict":
    "The legacy archive no longer matches the recorded checkpoint; nothing was written. Treat as a security incident (docs/security/audit-chain.md).",
};

async function main() {
  let command: CheckpointCommand;
  try {
    command = parseCheckpointArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`[audit-checkpoint] ${(error as Error).message}`);
    process.exitCode = 2;
    return;
  }

  const { prisma } = await import("../lib/prisma");
  const { checkpointLegacyAuditChain } = await import("../lib/audit");
  try {
    const startedAt = Date.now();
    const result = await checkpointLegacyAuditChain(
      command.kind === "apply" ? { apply: true, expectedDigest: command.expectedDigest } : {},
    );
    // elapsedMs of a dry run approximates how long --apply holds audit writes.
    const elapsedMs = Date.now() - startedAt;
    process.stdout.write(`${JSON.stringify({ ranAt: new Date().toISOString(), elapsedMs, ...result, next: NEXT_STEP[result.outcome] }, null, 2)}\n`);
    process.exitCode = REFUSED.has(result.outcome) ? 3 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && /checkpoint-audit-chain\.ts$/.test(process.argv[1])) {
  main().catch((error) => {
    console.error("[audit-checkpoint] failed", error instanceof Error ? error.name : "unknown");
    process.exit(1);
  });
}
