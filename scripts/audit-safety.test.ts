import { describe, expect, it } from "vitest";
import {
  AUDIT_DATABASE_NAME,
  AuditSafetyError,
  assertAuditTestEnvironment,
  assertLiveDatabaseIdentity,
  redactUrl,
  validateDatabaseUrl,
  validateRedisUrl,
} from "./audit-safety.mjs";

const good = "postgresql://audit:pw-secret@127.0.0.1:55432/reloop_audit_test?schema=public";

describe("validateDatabaseUrl", () => {
  it.each([
    good,
    "postgres://audit:pw@localhost:5432/reloop_audit_test",
    "postgresql://audit:pw@[::1]:5432/reloop_audit_test",
  ])("accepts a loopback reloop_audit_test URL (%s)", (url) => {
    expect(validateDatabaseUrl(url).database).toBe(AUDIT_DATABASE_NAME);
  });

  it.each([
    ["remote production host", "postgresql://app:pw@db.reloop.id:5432/reloop_audit_test"],
    ["non-loopback IP", "postgresql://app:pw@10.0.0.5:5432/reloop_audit_test"],
    ["other loopback alias", "postgresql://app:pw@127.0.0.2:5432/reloop_audit_test"],
    ["lookalike DNS name", "postgresql://app:pw@localhost.evil.test:5432/reloop_audit_test"],
    ["operational database name", "postgresql://reloop:reloop@localhost:5432/reloop"],
    ["suffixed database name", "postgresql://app:pw@127.0.0.1:5432/reloop_audit_test_copy"],
    ["wrong protocol", "mysql://app:pw@127.0.0.1:3306/reloop_audit_test"],
    ["libpq host override", "postgresql://app:pw@127.0.0.1:5432/reloop_audit_test?host=db.reloop.id"],
    ["libpq hostaddr override", "postgresql://app:pw@127.0.0.1:5432/reloop_audit_test?hostaddr=10.0.0.5"],
    ["unix socket host", "postgresql://app:pw@%2Fvar%2Frun%2Fpostgresql/reloop_audit_test"],
    ["garbage", "not a url"],
    ["empty", ""],
  ])("rejects %s", (_label, url) => {
    expect(() => validateDatabaseUrl(url)).toThrow(AuditSafetyError);
  });

  it("rejects the caller's existing DATABASE_URL even when it looks like a test URL", () => {
    expect(() => validateDatabaseUrl(good, { inheritedDatabaseUrl: good })).toThrow(/existing DATABASE_URL/);
  });

  it("never echoes credentials in its errors", () => {
    try {
      validateDatabaseUrl("postgresql://app:Sup3rS3cret@db.reloop.id:5432/reloop");
      expect.unreachable();
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("Sup3rS3cret");
      expect(String((error as Error).message)).toContain("db.reloop.id");
    }
  });
});

describe("validateRedisUrl", () => {
  it("accepts a loopback Redis URL", () => {
    expect(validateRedisUrl("redis://:pw@127.0.0.1:6390").host).toBe("127.0.0.1");
  });

  it.each([
    "redis://:pw@cache.reloop.id:6379",
    "rediss://:pw@10.1.1.1:6380",
    "http://127.0.0.1:6379",
    "",
  ])("rejects %s", (url) => {
    expect(() => validateRedisUrl(url)).toThrow(AuditSafetyError);
  });

  it("rejects the caller's existing REDIS_URL", () => {
    expect(() => validateRedisUrl("redis://localhost:6380", { inheritedRedisUrl: "redis://localhost:6380" }))
      .toThrow(/existing REDIS_URL/);
  });
});

describe("assertAuditTestEnvironment", () => {
  const env = {
    AUDIT_TEST_RUN: "1",
    AUDIT_RUN_ID: "a1b2c3d4",
    DATABASE_URL: good,
    REDIS_URL: "redis://:pw@127.0.0.1:6390",
  };

  it("accepts the runner-built environment", () => {
    expect(assertAuditTestEnvironment(env)).toMatchObject({ runId: "a1b2c3d4" });
  });

  it.each([
    ["AUDIT_TEST_RUN missing", { AUDIT_TEST_RUN: undefined }],
    ["AUDIT_TEST_RUN not exactly 1", { AUDIT_TEST_RUN: "true" }],
    ["run id missing", { AUDIT_RUN_ID: undefined }],
    ["run id unsafe", { AUDIT_RUN_ID: "x; DROP" }],
    ["production NODE_ENV", { NODE_ENV: "production" }],
    ["remote database", { DATABASE_URL: "postgresql://app:pw@db.reloop.id:5432/reloop_audit_test" }],
    ["remote redis", { REDIS_URL: "redis://cache.reloop.id:6379" }],
    ["missing redis", { REDIS_URL: undefined }],
  ])("rejects %s before anything connects", (_label, patch) => {
    expect(() => assertAuditTestEnvironment({ ...env, ...patch })).toThrow(AuditSafetyError);
  });
});

describe("assertLiveDatabaseIdentity", () => {
  it("requires the exact database and runner cluster marker", () => {
    expect(() => assertLiveDatabaseIdentity({ database: "reloop_audit_test", cluster: "reloop-audit-a1b2c3d4" }, "a1b2c3d4"))
      .not.toThrow();
    expect(() => assertLiveDatabaseIdentity({ database: "reloop", cluster: "reloop-audit-a1b2c3d4" }, "a1b2c3d4"))
      .toThrow(/live database is "reloop"/);
    expect(() => assertLiveDatabaseIdentity({ database: "reloop_audit_test", cluster: "" }, "a1b2c3d4"))
      .toThrow(/cluster/);
  });
});

describe("redactUrl", () => {
  it("drops user info and query secrets", () => {
    expect(redactUrl("postgresql://app:pw@127.0.0.1:5432/reloop_audit_test?password=x"))
      .toBe("postgresql://***@127.0.0.1:5432/reloop_audit_test");
    expect(redactUrl("::not a url::")).toBe("<unparseable url>");
  });
});
