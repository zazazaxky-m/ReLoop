import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import {
  AuditSafetyError,
  assertAuditTestEnvironment,
  assertLiveDatabaseIdentity,
  redactUrl,
  validateDatabaseUrl,
} from "../../scripts/audit-safety.mjs";

/** Marker the runner writes into its own password-protected Redis. */
export const REDIS_OWNER_KEY = "reloop-audit:owner";

type RawClient = Pick<PrismaClient, "$queryRawUnsafe" | "$executeRawUnsafe">;

/** Validates the runner-built environment before any client is created. */
export function auditEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const checked = assertAuditTestEnvironment(env);
  return { ...checked, databaseUrl: env.DATABASE_URL as string, redisUrl: env.REDIS_URL as string };
}

function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n").map((line) => line.trim()).filter(Boolean).pop() ?? "unknown error";
}

/** Fails loudly (never mocks) when the test PostgreSQL cannot be reached. */
export async function assertPostgresReachable(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  url.searchParams.set("connect_timeout", "3");
  const client = new PrismaClient({ datasourceUrl: url.toString() });
  try {
    await client.$queryRawUnsafe("SELECT 1");
  } catch (error) {
    throw new Error(
      `PostgreSQL test database unreachable at ${redactUrl(databaseUrl)} (${firstLine(error)}); ` +
        "the audit harness never falls back to mocks",
    );
  } finally {
    await client.$disconnect();
  }
}

/** Fails loudly (never mocks) when the test Redis cannot be reached. */
export async function assertRedisReachable(redisUrl: string): Promise<void> {
  const client = new Redis(redisUrl, {
    lazyConnect: true, connectTimeout: 2_000, maxRetriesPerRequest: 0,
    enableOfflineQueue: false, retryStrategy: () => null,
  });
  client.on("error", () => {});
  try {
    await client.connect();
    await client.ping();
  } catch (error) {
    throw new Error(
      `Redis test instance unreachable at ${redactUrl(redisUrl)} (${firstLine(error)}); ` +
        "the audit harness never falls back to mocks",
    );
  } finally {
    client.disconnect();
  }
}

/**
 * Truncates every application table, but only after the URL passes the
 * loopback/reloop_audit_test guard AND the live server reports the exact
 * database plus this run's cluster_name. Never used on any other database.
 */
export async function resetDisposableDatabase(
  client: RawClient,
  databaseUrl: string,
  runId: string = process.env.AUDIT_RUN_ID ?? "",
): Promise<void> {
  validateDatabaseUrl(databaseUrl);
  const [identity] = await client.$queryRawUnsafe<{ database: string; cluster: string }[]>(
    "SELECT current_database() AS database, current_setting('cluster_name') AS cluster",
  );
  assertLiveDatabaseIdentity(identity, runId);
  const tables = await client.$queryRawUnsafe<{ name: string }[]>(
    "SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'",
  );
  if (tables.length === 0) return;
  const list = tables.map(({ name }) => `"${name.replace(/"/g, '""')}"`).join(", ");
  await client.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** Deletes keys (never FLUSHALL) only in the Redis this run claimed. */
export async function resetRedisNamespace(redis: Redis, runId: string): Promise<void> {
  const owner = await redis.get(REDIS_OWNER_KEY);
  if (owner !== runId) {
    throw new AuditSafetyError(`Redis is not owned by audit run ${runId}; refusing to delete keys`);
  }
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "COUNT", 500);
    cursor = next;
    const doomed = keys.filter((key) => key !== REDIS_OWNER_KEY);
    if (doomed.length) await redis.del(...doomed);
  } while (cursor !== "0");
}
