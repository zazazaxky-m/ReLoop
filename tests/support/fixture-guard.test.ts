import { createServer, type Server } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditSafetyError } from "../../scripts/audit-safety.mjs";
import { createAuditFixture } from "./fixture-core";

// Docker-free: a loopback TCP sentinel stands in for "some database server" and
// counts connection attempts. The guard must reject before anything connects.
describe("audit fixture guard", () => {
  let sentinel: Server;
  let port = 0;
  let connections = 0;

  beforeEach(async () => {
    connections = 0;
    sentinel = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => sentinel.listen(0, "127.0.0.1", resolve));
    port = (sentinel.address() as { port: number }).port;
    vi.stubEnv("AUDIT_TEST_RUN", "1");
    vi.stubEnv("AUDIT_RUN_ID", "abcdef1234");
    vi.stubEnv("AUDIT_FIXTURE_PASSWORD", "unused-in-this-test");
    vi.stubEnv("AUDIT_TRANSPORT_SINK", "/nonexistent/sink.jsonl");
    vi.stubEnv("DATABASE_URL", `postgresql://app:pw@127.0.0.1:${port}/reloop_audit_test`);
    vi.stubEnv("REDIS_URL", `redis://127.0.0.1:${port}`);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await new Promise<void>((resolve) => sentinel.close(() => resolve()));
  });

  it.each([
    ["the operational database name", { DATABASE_URL: () => `postgresql://reloop:reloop@127.0.0.1:${port}/reloop` }],
    ["a remote production host", { DATABASE_URL: () => "postgresql://app:pw@db.reloop.id:5432/reloop_audit_test" }],
    ["a remote Redis", { REDIS_URL: () => "redis://cache.reloop.id:6379" }],
    ["a missing AUDIT_TEST_RUN flag", { AUDIT_TEST_RUN: () => "" }],
  ])("rejects %s before opening any connection", async (_label, patch) => {
    for (const [name, value] of Object.entries(patch)) vi.stubEnv(name, value());
    await expect(createAuditFixture()).rejects.toBeInstanceOf(AuditSafetyError);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(connections).toBe(0);
  });

  it("positive control: a guard-approved target is actually contacted (and fails loudly, no mock)", async () => {
    await expect(createAuditFixture()).rejects.toThrow(/PostgreSQL test database unreachable/);
    expect(connections).toBeGreaterThan(0);
  });
});
