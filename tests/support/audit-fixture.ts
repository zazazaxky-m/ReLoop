/**
 * Vitest setup file for the real-service suites (vitest.integration.config.ts,
 * vitest.realtime.config.ts). Each test gets a fresh `f` on the runner-owned
 * disposable PostgreSQL/Redis; afterEach disposes it.
 *
 *   import { f } from "../support/audit-fixture";
 *   it("...", async () => { await f.seedBalance(50_000); ... });
 */
import { afterEach, beforeEach } from "vitest";
import { createAuditFixture, type AuditFixture } from "./fixture-core";

export type { ActorKey, AuditFixture, FixtureActor, TestIds } from "./fixture-core";
export { FixtureContractUnavailable } from "./fixture-core";
export type { RealtimeHarness } from "./realtime-harness";

export let f: AuditFixture;

beforeEach(async () => {
  f = await createAuditFixture();
});

afterEach(async () => {
  const current = f;
  f = undefined as unknown as AuditFixture;
  await current?.dispose();
});
