// Safety validation for the audit test harness. Pure functions only: nothing in
// this module opens a connection, so every check runs before any mutation.

export const AUDIT_DATABASE_NAME = "reloop_audit_test";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const RUN_ID_PATTERN = /^[a-z0-9]{6,32}$/;

export class AuditSafetyError extends Error {
  constructor(message) {
    super(`[audit-safety] ${message}`);
    this.name = "AuditSafetyError";
  }
}

/**
 * Host/port/path only: never user info or query parameters.
 * @param {string} raw
 */
export function redactUrl(raw) {
  try {
    const url = new URL(raw);
    const auth = url.username || url.password ? "***@" : "";
    return `${url.protocol}//${auth}${url.host}${url.pathname}`;
  } catch {
    return "<unparseable url>";
  }
}

function parse(raw, label) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new AuditSafetyError(`${label} is not set`);
  }
  try {
    return new URL(raw);
  } catch {
    throw new AuditSafetyError(`${label} is not a valid URL`);
  }
}

function sameTarget(a, b) {
  if (!a || !b) return false;
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.hostname === y.hostname && x.port === y.port && x.pathname === y.pathname;
  } catch {
    return a.trim() === b.trim();
  }
}

/**
 * Accepts only a loopback PostgreSQL URL whose database is exactly
 * reloop_audit_test and which is not the caller's own DATABASE_URL.
 * @param {string | undefined} raw
 * @param {{ inheritedDatabaseUrl?: string }} [options]
 */
export function validateDatabaseUrl(raw, { inheritedDatabaseUrl } = {}) {
  const url = parse(raw, "Test DATABASE_URL");
  const shown = redactUrl(raw);
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new AuditSafetyError(`refusing ${shown}: protocol must be postgresql:`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new AuditSafetyError(
      `refusing ${shown}: host "${url.hostname}" is not loopback (allowed: ${[...LOOPBACK_HOSTS].join(", ")})`,
    );
  }
  for (const key of ["host", "hostaddr"]) {
    if (url.searchParams.has(key)) {
      throw new AuditSafetyError(`refusing ${shown}: query parameter "${key}" would override the host`);
    }
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database !== AUDIT_DATABASE_NAME) {
    throw new AuditSafetyError(
      `refusing ${shown}: database must be exactly "${AUDIT_DATABASE_NAME}", got "${database}"`,
    );
  }
  if (sameTarget(raw, inheritedDatabaseUrl)) {
    throw new AuditSafetyError(`refusing ${shown}: it is the caller's existing DATABASE_URL`);
  }
  return { host: url.hostname, port: url.port, database };
}

/**
 * Accepts only a loopback redis:// URL that is not the caller's REDIS_URL.
 * @param {string | undefined} raw
 * @param {{ inheritedRedisUrl?: string }} [options]
 */
export function validateRedisUrl(raw, { inheritedRedisUrl } = {}) {
  const url = parse(raw, "Test REDIS_URL");
  const shown = redactUrl(raw);
  if (url.protocol !== "redis:") {
    throw new AuditSafetyError(`refusing ${shown}: protocol must be redis:`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname)) {
    throw new AuditSafetyError(`refusing ${shown}: host "${url.hostname}" is not loopback`);
  }
  if (sameTarget(raw, inheritedRedisUrl)) {
    throw new AuditSafetyError(`refusing ${shown}: it is the caller's existing REDIS_URL`);
  }
  return { host: url.hostname, port: url.port };
}

/**
 * Guard used by every process that may mutate test data (runner, Vitest
 * fixture, Playwright fixture). Throws before any client is created.
 * @param {Record<string, string | undefined>} env
 */
export function assertAuditTestEnvironment(env) {
  if (env.AUDIT_TEST_RUN !== "1") {
    throw new AuditSafetyError(
      "AUDIT_TEST_RUN must be exactly \"1\"; run integration/browser/realtime suites through npm run test:<suite>",
    );
  }
  if (env.NODE_ENV === "production") {
    throw new AuditSafetyError("refusing to run the audit harness with NODE_ENV=production");
  }
  const runId = env.AUDIT_RUN_ID ?? "";
  if (!RUN_ID_PATTERN.test(runId)) {
    throw new AuditSafetyError("AUDIT_RUN_ID is missing or malformed (expected 6-32 lowercase alphanumerics)");
  }
  const database = validateDatabaseUrl(env.DATABASE_URL);
  const redis = validateRedisUrl(env.REDIS_URL);
  return { runId, database, redis };
}

/** Compose-generated cluster_name proves the reachable server is this run's container. */
/** @param {string} runId */
export function expectedClusterName(runId) {
  return `reloop-audit-${runId}`;
}

/**
 * @param {{ database: string, cluster: string }} identity
 * @param {string} runId
 */
export function assertLiveDatabaseIdentity({ database, cluster }, runId) {
  if (database !== AUDIT_DATABASE_NAME) {
    throw new AuditSafetyError(
      `live database is "${database}", expected "${AUDIT_DATABASE_NAME}"; refusing to touch it`,
    );
  }
  if (cluster !== expectedClusterName(runId)) {
    throw new AuditSafetyError(
      `live PostgreSQL cluster "${cluster}" was not started by audit run ${runId}; refusing to touch it`,
    );
  }
}
