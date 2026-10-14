import type { Prisma } from "@prisma/client";

/**
 * M04 cutover (fix round 5, L1): the instant from which every deposit item
 * follows the acceptance contract (lib/machine-events/acceptance.ts). A REVIEW
 * row without a usable acceptance record is a *legacy* row, approvable by a
 * superadmin as "setoran lama", only when it was created before this instant.
 * A later row of an ended session is never approved by a human: the machine's
 * outbox may still decide it (a queued acceptance or rejection), or a reviewer
 * rejects it.
 *
 * Resolution is deterministic and fails closed:
 *   1. `REWARD_LEGACY_CUTOVER_AT` (ISO-8601) when set: an explicit operator
 *      choice, e.g. for a database restored from a snapshot whose migration
 *      time is not the real cutover. An unparsable value resolves to "none";
 *      it never falls back to the migration time.
 *   2. Otherwise the applied time (`finished_at`) of the M04 migration in
 *      `_prisma_migrations` (not rolled back).
 *   3. Otherwise none: no legacy approval is possible.
 *
 * The cutover is immutable configuration (migration history or an explicit
 * setting), not row state, so reading it needs no row lock; the review reads
 * it through the same transaction client as everything else.
 */
export const REWARD_POLICY_MIGRATION = "20261014013000_reward_policy";
export const LEGACY_CUTOVER_ENV = "REWARD_LEGACY_CUTOVER_AT";

export type LegacyCutover =
  | { at: Date; source: "env" | "migration" }
  | { at: null; source: "env-invalid" | "migration-missing" };

type RawReader = Pick<Prisma.TransactionClient, "$queryRaw">;

export async function resolveLegacyCutover(
  db: RawReader,
  env: Record<string, string | undefined> = process.env,
): Promise<LegacyCutover> {
  const configured = env[LEGACY_CUTOVER_ENV]?.trim();
  if (configured) {
    const at = new Date(configured);
    return Number.isNaN(at.getTime()) ? { at: null, source: "env-invalid" } : { at, source: "env" };
  }
  // Probe first: a query against a missing table would abort the enclosing transaction.
  const [{ present }] = await db.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('"_prisma_migrations"') IS NOT NULL AS present`;
  if (!present) return { at: null, source: "migration-missing" };
  const rows = await db.$queryRaw<{ finishedAt: Date | null }[]>`
    SELECT finished_at AS "finishedAt" FROM "_prisma_migrations"
    WHERE migration_name = ${REWARD_POLICY_MIGRATION} AND rolled_back_at IS NULL AND finished_at IS NOT NULL
    ORDER BY finished_at ASC LIMIT 1`;
  const at = rows[0]?.finishedAt ?? null;
  return at ? { at, source: "migration" } : { at: null, source: "migration-missing" };
}
