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

/**
 * Deterministic cutover of one migration (the pattern above, reused by the
 * B01a funding cutover in lib/reward-funding.ts). An unparsable `envName`
 * value always fails closed (none). `combine`:
 * - `"env-wins"` (default, M04's semantics): the explicit value, when set,
 *   replaces the migration time;
 * - `"earliest"` (funding, C3): the earlier of the explicit value and the
 *   applied `finished_at` when both exist, so a setting later than the
 *   migration can never widen the legacy window.
 */
export async function resolveMigrationCutover(
  db: RawReader,
  options: {
    migration: string;
    envName: string;
    env?: Record<string, string | undefined>;
    combine?: "env-wins" | "earliest";
  },
): Promise<LegacyCutover> {
  const env = options.env ?? process.env;
  const configured = env[options.envName]?.trim();
  let fromEnv: Date | null = null;
  if (configured) {
    const at = new Date(configured);
    if (Number.isNaN(at.getTime())) return { at: null, source: "env-invalid" };
    if ((options.combine ?? "env-wins") === "env-wins") return { at, source: "env" };
    fromEnv = at;
  }
  // Probe first: a query against a missing table would abort the enclosing transaction.
  const [{ present }] = await db.$queryRaw<{ present: boolean }[]>`
    SELECT to_regclass('"_prisma_migrations"') IS NOT NULL AS present`;
  const fromMigration = present
    ? ((await db.$queryRaw<{ finishedAt: Date | null }[]>`
        SELECT finished_at AS "finishedAt" FROM "_prisma_migrations"
        WHERE migration_name = ${options.migration} AND rolled_back_at IS NULL AND finished_at IS NOT NULL
        ORDER BY finished_at ASC LIMIT 1`)[0]?.finishedAt ?? null)
    : null;
  if (fromEnv && fromMigration) {
    return fromEnv.getTime() <= fromMigration.getTime() ? { at: fromEnv, source: "env" } : { at: fromMigration, source: "migration" };
  }
  if (fromEnv) return { at: fromEnv, source: "env" };
  return fromMigration ? { at: fromMigration, source: "migration" } : { at: null, source: "migration-missing" };
}

export async function resolveLegacyCutover(
  db: RawReader,
  env: Record<string, string | undefined> = process.env,
): Promise<LegacyCutover> {
  return resolveMigrationCutover(db, { migration: REWARD_POLICY_MIGRATION, envName: LEGACY_CUTOVER_ENV, env });
}
