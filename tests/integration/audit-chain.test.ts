import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AuditLog, Prisma, PrismaClient } from "@prisma/client";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AuditChainResult } from "@/components/security/AuditChainVerifier";
import {
  AUDIT_CHAIN_LOCK,
  AUDIT_CHECKPOINT_ACTION,
  buildAuditRow,
  canonicalAuditPayload,
  logAudit,
  logAuditInTransaction,
  verifyAuditChain,
} from "@/lib/audit";
import { f } from "../support/audit-fixture";
import { InjectedFault, backendsBlockedBy, deferred, isStillPending } from "../support/race-probe";

const ROOT = path.resolve(__dirname, "../..");
const MIGRATION = path.join(ROOT, "prisma/migrations/20261014200000_audit_chain_v2/migration.sql");

/**
 * Holds the audit chain lock from an independent connection, optionally
 * appending through `work` first, until release(). With `rollback` the holder
 * transaction is aborted after release instead of committed.
 */
async function holdChainLock(options: { work?: (tx: Prisma.TransactionClient) => Promise<void>; rollback?: boolean } = {}) {
  const holder = await f.connection();
  const locked = deferred<number>();
  const release = deferred();
  const done = holder.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`;
    await options.work?.(tx);
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    locked.resolve(pid);
    await release.promise;
    if (options.rollback) throw new InjectedFault("INJECTED_AUDIT_ROLLBACK");
  }, { timeout: 60_000, maxWait: 10_000 });
  done.catch((error) => locked.reject(error));
  return { pid: await locked.promise, release: () => release.resolve(), done };
}

/** Waits until `count` backends are blocked by `holderPid` (proved via pg_blocking_pids). */
async function waitForWaiters(observer: PrismaClient, holderPid: number, count: number) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if ((await backendsBlockedBy(observer, holderPid)).length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${count} audit writers were not blocked by ${holderPid} within 15s`);
}

/** The v2 chain in sequence order, with the structural invariants every test relies on. */
async function chain(): Promise<AuditLog[]> {
  const rows = await f.db.auditLog.findMany({ where: { chainVersion: 2 }, orderBy: { chainSequence: "asc" } });
  rows.forEach((row, index) => {
    expect(row.chainSequence, row.action).toBe(BigInt(index + 1));
    expect(row.previousHash, row.action).toBe(index === 0 ? null : rows[index - 1].checksum);
  });
  return rows;
}

/** The runner's random per-run secret (never the insecure default). */
function secret(): string {
  const value = process.env.AUDIT_CHECKSUM_SECRET ?? "";
  expect(value.length).toBeGreaterThanOrEqual(32);
  return value;
}

/** Independent oracle of the pre-A05 (v1) writer/verifier formula. */
function v1Checksum(previous: string | null, payload: Record<string, unknown>): string {
  return createHash("sha256").update(`${previous ?? ""}${JSON.stringify(payload)}${secret()}`).digest("hex");
}

type LegacyRow = { createdAt: Date; actorId: string | null; action: string; entityType: string; entityId: string | null; metadata: Record<string, unknown> | null };

/**
 * Stores legacy (version 1) rows as the pre-A05 code left them. `provable`
 * rows carry the checksum the old verifier recomputes from the stored row;
 * otherwise the checksum covers a timestamp that was never stored and an
 * omitted actor, as the old logAudit wrote.
 */
async function insertLegacy(rows: LegacyRow[], { provable }: { provable: boolean }) {
  let previous: string | null = null;
  for (const row of rows) {
    const payload = provable
      ? { ts: row.createdAt.toISOString(), actor: row.actorId, action: row.action,
          entity: `${row.entityType}:${row.entityId}`, meta: row.metadata }
      : { ts: new Date(row.createdAt.getTime() - 3).toISOString(), action: row.action,
          entity: `${row.entityType}:${row.entityId}`, meta: row.metadata ?? undefined };
    const checksum = v1Checksum(previous, payload);
    await f.db.auditLog.create({ data: {
      chainVersion: 1, createdAt: row.createdAt, actorId: row.actorId, action: row.action, entityType: row.entityType,
      entityId: row.entityId, metadataJson: (row.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
      previousHash: previous, checksum,
    } });
    previous = checksum;
  }
}

const LEGACY: LegacyRow[] = [
  { createdAt: new Date("2026-07-01T08:00:00.000Z"), actorId: null, action: "LEGACY_LOGIN", entityType: "User", entityId: "u-legacy", metadata: { ip: "10.0.0.1" } },
  { createdAt: new Date("2026-07-02T09:30:00.000Z"), actorId: "admin-legacy", action: "LEGACY_EDIT", entityType: "Machine", entityId: "m-legacy", metadata: null },
];

/** Runs scripts/checkpoint-audit-chain.ts for real against the runner-owned database. */
function checkpointCli(args: string[]) {
  const run = spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), ["scripts/checkpoint-audit-chain.ts", ...args], {
    cwd: ROOT, env: process.env, encoding: "utf8", timeout: 120_000,
  });
  expect(`${run.stdout}${run.stderr}`).not.toContain(secret());
  let report: Record<string, any> | null = null;
  try { report = JSON.parse(run.stdout); } catch { report = null; }
  return { status: run.status, report, stderr: run.stderr };
}

/** Changes a legacy row behind the immutability trigger, as a table owner could. */
async function tamperLegacy(id: string, action: string) {
  await f.db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE "AuditLog" DISABLE TRIGGER "AuditLog_legacy_immutable"`);
    await tx.$executeRaw`UPDATE "AuditLog" SET action = ${action} WHERE id = ${id}`;
    await tx.$executeRawUnsafe(`ALTER TABLE "AuditLog" ENABLE TRIGGER "AuditLog_legacy_immutable"`);
  });
}

describe("audit chain v2 (A05 / SEC-08)", () => {
  it("verifies a stored row even when insert is delayed and fields are null", async () => {
    await logAudit({action:"AUDIT_TEST",entityType:"Test",actorId:null,metadata:null});
    expect((await verifyAuditChain()).valid).toBe(true);
    const row = await f.db.auditLog.findFirstOrThrow({where:{action:"AUDIT_TEST"}});
    await f.db.auditLog.update({where:{id:row.id},data:{action:"ALTERED"}});
    expect((await verifyAuditChain()).valid).toBe(false);
  });

  it("omitted and explicit-null optional fields give the same canonical form and both verify", async () => {
    const at = new Date("2026-10-14T03:00:00.000Z");
    expect(canonicalAuditPayload(buildAuditRow({ action: "AUDIT_X", entityType: "Test" }, at)))
      .toBe(canonicalAuditPayload(buildAuditRow({ action: "AUDIT_X", entityType: "Test", actorId: null, entityId: null, metadata: null }, at)));

    await logAudit({ action: "AUDIT_OMITTED", entityType: "Test" });
    await logAudit({ action: "AUDIT_NULLS", entityType: "Test", actorId: null, entityId: null, metadata: null });
    const [omitted, nulls] = await chain();
    for (const row of [omitted, nulls]) {
      expect(row).toMatchObject({ actorId: null, entityId: null, metadataJson: null, chainVersion: 2 });
    }
    // The stored rows differ only by action and timestamp.
    expect(canonicalAuditPayload({ ...omitted, action: "SAME", createdAt: at }))
      .toBe(canonicalAuditPayload({ ...nulls, action: "SAME", createdAt: at }));
    expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedCount: 2 });
  });

  it("nested metadata keys in any order verify after the JSONB round trip", async () => {
    const metadata = { zeta: 1, alpha: { delta: [{ b: 1, a: 2 }], charlie: "x" }, beta: null, longerKey: true, k: "v", gone: undefined };
    await logAudit({ actorId: f.ids.superadmin, action: "AUDIT_NESTED", entityType: "Test", entityId: "n-1", metadata });
    const [row] = await chain();
    // PostgreSQL returned the keys in its own order, and dropped the undefined member.
    expect(Object.keys(row.metadataJson as object)).not.toEqual(Object.keys(metadata).filter((key) => key !== "gone"));
    expect(row.metadataJson).toEqual({ zeta: 1, alpha: { delta: [{ b: 1, a: 2 }], charlie: "x" }, beta: null, longerKey: true, k: "v" });
    const reordered = { k: "v", longerKey: true, beta: null, alpha: { charlie: "x", delta: [{ a: 2, b: 1 }] }, zeta: 1 };
    expect(canonicalAuditPayload({ ...row, metadataJson: reordered })).toBe(canonicalAuditPayload(row));
    // Array order is data, not formatting: it still counts.
    expect(canonicalAuditPayload({ ...row, metadataJson: { ...reordered, alpha: { charlie: "x", delta: [{ a: 2, b: 1 }, 0] } } }))
      .not.toBe(canonicalAuditPayload(row));
    expect(await verifyAuditChain()).toMatchObject({ valid: true });
  });

  it("rows sharing one timestamp still form one chain", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-10-14T03:00:00.000Z"));
      for (const n of [1, 2, 3]) {
        await logAudit({ actorId: f.ids.superadmin, action: `AUDIT_TIE_${n}`, entityType: "Test", entityId: `tie-${n}`, metadata: { n } });
      }
    } finally {
      vi.useRealTimers();
    }
    // Move the first row to the end of the heap: an order by timestamp alone is now ambiguous.
    const first = await f.db.auditLog.findFirstOrThrow({ where: { action: "AUDIT_TIE_1" } });
    await f.db.$executeRaw`UPDATE "AuditLog" SET "createdAt" = "createdAt" WHERE id = ${first.id}`;
    const rows = await chain();
    expect(rows.map((row) => row.action)).toEqual(["AUDIT_TIE_1", "AUDIT_TIE_2", "AUDIT_TIE_3"]);
    expect(new Set(rows.map((row) => row.createdAt.toISOString()))).toEqual(new Set(["2026-10-14T03:00:00.000Z"]));
    expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedCount: 3 });
  });

  it("an insert delayed behind the chain lock verifies, stamped once and stored as hashed", async () => {
    const observer = await f.connection();
    const lock = await holdChainLock();
    let writing: Promise<void> | undefined;
    let releasedAt = 0;
    try {
      writing = logAudit({ actorId: f.ids.superadmin, action: "AUDIT_DELAYED", entityType: "Test", entityId: "d-1" });
      await waitForWaiters(observer, lock.pid, 1);
      expect(await isStillPending(writing, 150)).toBe(true);
    } finally {
      releasedAt = Date.now();
      lock.release();
    }
    await lock.done;
    await writing;
    const [row] = await chain();
    expect(row.action).toBe("AUDIT_DELAYED");
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(releasedAt);
    expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedCount: 1 });
  });

  it("concurrent writers queued on the lock append one linear chain", async () => {
    const observer = await f.connection();
    const lock = await holdChainLock({
      work: (tx) => logAuditInTransaction(tx, { actorId: f.ids.superadmin, action: "AUDIT_HOLDER", entityType: "Test", entityId: "c-0" }),
    });
    const writers: Promise<unknown>[] = [];
    try {
      writers.push(logAudit({ actorId: f.ids.userA, action: "AUDIT_WRITER_A", entityType: "Test", entityId: "c-1", metadata: { w: "a" } }));
      writers.push(f.db.$transaction((tx) =>
        logAuditInTransaction(tx, { actorId: f.ids.userB, action: "AUDIT_WRITER_B", entityType: "Test", entityId: "c-2", metadata: { w: "b" } })));
      for (const writer of writers) writer.catch(() => {});
      await waitForWaiters(observer, lock.pid, 2);
    } finally {
      lock.release();
    }
    await lock.done;
    await Promise.all(writers);
    const rows = await chain();
    expect(rows).toHaveLength(3);
    expect(rows[0].action).toBe("AUDIT_HOLDER");
    expect(new Set(rows.slice(1).map((row) => row.action))).toEqual(new Set(["AUDIT_WRITER_A", "AUDIT_WRITER_B"]));
    // No fork: every row has a distinct predecessor and exactly one row starts the chain.
    expect(new Set(rows.map((row) => row.previousHash)).size).toBe(3);
    expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedCount: 3 });
  });

  it("writers in the Next server and in this process extend the same chain", async () => {
    await f.pickup();
    await logAudit({ actorId: f.ids.superadmin, action: "AUDIT_IN_PROCESS", entityType: "Test" });
    const rows = await chain();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.at(-1)!.action).toBe("AUDIT_IN_PROCESS");
    expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedCount: rows.length });
  });

  it("a rolled-back append leaves no phantom link for the writer queued behind it", async () => {
    await logAudit({ actorId: f.ids.superadmin, action: "AUDIT_BEFORE", entityType: "Test", entityId: "r-0" });
    const before = await f.db.auditLog.findFirstOrThrow({ where: { action: "AUDIT_BEFORE" } });

    const observer = await f.connection();
    const lock = await holdChainLock({
      rollback: true,
      work: (tx) => logAuditInTransaction(tx, { actorId: f.ids.superadmin, action: "AUDIT_PHANTOM", entityType: "Test", entityId: "r-1" }),
    });
    let writing: Promise<void> | undefined;
    try {
      writing = logAudit({ actorId: f.ids.superadmin, action: "AUDIT_AFTER", entityType: "Test", entityId: "r-2" });
      await waitForWaiters(observer, lock.pid, 1);
    } finally {
      lock.release();
    }
    await expect(lock.done).rejects.toThrow("INJECTED_AUDIT_ROLLBACK");
    await writing;

    expect(await f.db.auditLog.count({ where: { action: "AUDIT_PHANTOM" } })).toBe(0);
    const after = await f.db.auditLog.findFirstOrThrow({ where: { action: "AUDIT_AFTER" } });
    expect(after.previousHash).toBe(before.checksum);
    expect(after.chainSequence).toBe(2n); // the rolled-back sequence number was reused, no gap
    expect(await verifyAuditChain()).toMatchObject({ valid: true });

    // An in-transaction append rolled back with its caller also leaves nothing behind.
    await expect(f.db.$transaction(async (tx) => {
      await logAuditInTransaction(tx, { action: "AUDIT_PHANTOM", entityType: "Test" });
      throw new InjectedFault("INJECTED_CALLER_ROLLBACK");
    })).rejects.toThrow("INJECTED_CALLER_ROLLBACK");
    await logAudit({ action: "AUDIT_LAST", entityType: "Test" });
    const last = await f.db.auditLog.findFirstOrThrow({ where: { action: "AUDIT_LAST" } });
    expect(last.previousHash).toBe(after.checksum);
    expect((await chain()).map((row) => row.action)).toEqual(["AUDIT_BEFORE", "AUDIT_AFTER", "AUDIT_LAST"]);
    expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedCount: 3 });
  });

  it("detects changed payload, checksum, link and order, and recovers when the row is restored", async () => {
    for (const n of [1, 2, 3, 4]) {
      await logAudit({ actorId: f.ids.superadmin, action: `AUDIT_ROW_${n}`, entityType: "Test", entityId: `t-${n}`,
        metadata: { n, nested: { list: [n, "x"] } } });
    }
    const rows = await chain();
    const [r1, r2, r3, r4] = rows;
    expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedCount: 4 });

    const cases: Array<{ name: string; brokenAt: string; reason: string; tamper: () => Promise<unknown> }> = [
      { name: "action", brokenAt: r2.id, reason: "checksum",
        tamper: () => f.db.auditLog.update({ where: { id: r2.id }, data: { action: "ALTERED" } }) },
      { name: "nested metadata", brokenAt: r2.id, reason: "checksum",
        tamper: () => f.db.auditLog.update({ where: { id: r2.id }, data: { metadataJson: { n: 2, nested: { list: [2, "y"] } } } }) },
      { name: "actor", brokenAt: r3.id, reason: "checksum",
        tamper: () => f.db.auditLog.update({ where: { id: r3.id }, data: { actorId: f.ids.userA } }) },
      { name: "entity id to null", brokenAt: r3.id, reason: "checksum",
        tamper: () => f.db.auditLog.update({ where: { id: r3.id }, data: { entityId: null } }) },
      { name: "timestamp", brokenAt: r1.id, reason: "checksum",
        tamper: () => f.db.auditLog.update({ where: { id: r1.id }, data: { createdAt: new Date(r1.createdAt.getTime() + 1) } }) },
      { name: "checksum", brokenAt: r3.id, reason: "checksum",
        tamper: () => f.db.auditLog.update({ where: { id: r3.id }, data: { checksum: "0".repeat(64) } }) },
      { name: "stored link", brokenAt: r4.id, reason: "previous-hash",
        tamper: () => f.db.auditLog.update({ where: { id: r4.id }, data: { previousHash: r2.checksum } }) },
      { name: "swapped order", brokenAt: r3.id, reason: "previous-hash",
        tamper: async () => {
          await f.db.auditLog.update({ where: { id: r2.id }, data: { chainSequence: 1_000n } });
          await f.db.auditLog.update({ where: { id: r3.id }, data: { chainSequence: 2n } });
          await f.db.auditLog.update({ where: { id: r2.id }, data: { chainSequence: 3n } });
        } },
      { name: "deleted middle row", brokenAt: r3.id, reason: "sequence",
        tamper: () => f.db.auditLog.delete({ where: { id: r2.id } }) },
      { name: "renumbered head", brokenAt: r4.id, reason: "sequence",
        tamper: () => f.db.auditLog.update({ where: { id: r4.id }, data: { chainSequence: 9n } }) },
    ];
    for (const tamper of cases) {
      await tamper.tamper();
      expect(await verifyAuditChain(), tamper.name).toMatchObject({ valid: false, brokenAt: tamper.brokenAt, reason: tamper.reason });
      // Put the original rows back exactly (delete + re-create for the removed row).
      await f.db.auditLog.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
      for (const row of rows) {
        await f.db.auditLog.create({ data: { ...row, metadataJson: row.metadataJson as Prisma.InputJsonValue } });
      }
      expect(await verifyAuditChain(), `${tamper.name} restored`).toMatchObject({ valid: true, checkedCount: 4 });
    }

    // A forged row appended without the secret is rejected.
    await f.db.auditLog.create({ data: { action: "FORGED", entityType: "Test", chainVersion: 2, chainSequence: 5n,
      previousHash: r4.checksum, checksum: createHash("sha256").update("forged").digest("hex") } });
    const forged = await f.db.auditLog.findFirstOrThrow({ where: { action: "FORGED" } });
    expect(await verifyAuditChain()).toMatchObject({ valid: false, brokenAt: forged.id, reason: "checksum" });
  });

  it("the database pairs version and sequence, files unsequenced inserts as legacy and keeps legacy rows immutable", async () => {
    await logAudit({ actorId: f.ids.superadmin, action: "AUDIT_V2", entityType: "Test" });
    const [v2] = await chain();
    // A v2 row cannot be relabelled legacy while it keeps its position, nor lose its position.
    await expect(f.db.$executeRaw`UPDATE "AuditLog" SET "chainVersion" = 1 WHERE id = ${v2.id}`).rejects.toThrow(/AuditLog_chain_version_sequence/);
    await expect(f.db.$executeRaw`UPDATE "AuditLog" SET "chainSequence" = NULL WHERE id = ${v2.id}`).rejects.toThrow(/AuditLog_chain_version_sequence/);

    // Code from before A05 (no version, no sequence) still writes, as a legacy row outside the chain.
    const old = await f.db.auditLog.create({ data: { action: "PRE_A05_WRITER", entityType: "Test", checksum: "c".repeat(64) } });
    expect(old).toMatchObject({ chainVersion: 1, chainSequence: null });
    await expect(f.db.auditLog.update({ where: { id: old.id }, data: { action: "REWRITTEN" } })).rejects.toThrow(/legacy \(version 1\) archive/);
    await expect(f.db.auditLog.delete({ where: { id: old.id } })).rejects.toThrow(/legacy \(version 1\) archive/);
    expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedCount: 1, legacyStatus: "unverifiable", legacyCount: 1 });
  });

  it("reports the legacy archive apart from the chain: not present, provable, or honestly unverifiable", async () => {
    await logAudit({ actorId: f.ids.superadmin, action: "AUDIT_V2", entityType: "Test" });
    expect(await verifyAuditChain()).toEqual({
      valid: true, checkedVersion: 2, checkedCount: 1, legacyStatus: "not-present", legacyCount: 0, legacyCheckpoint: "not-required",
    });

    await insertLegacy(LEGACY, { provable: true });
    expect(await verifyAuditChain()).toEqual({
      valid: true, checkedVersion: 2, checkedCount: 1, legacyStatus: "valid", legacyCount: 2, legacyCheckpoint: "missing",
    });

    // Rows as the pre-A05 logAudit wrote them (hashed timestamp never stored) cannot be proven.
    await f.db.$executeRaw`TRUNCATE "AuditLog"`;
    await logAudit({ actorId: f.ids.superadmin, action: "AUDIT_V2", entityType: "Test" });
    await insertLegacy(LEGACY, { provable: false });
    const before = await f.db.auditLog.findMany({ where: { chainVersion: 1 }, orderBy: { createdAt: "asc" } });
    const result = await verifyAuditChain();
    expect(result).toEqual({
      valid: true, checkedVersion: 2, checkedCount: 1, legacyStatus: "unverifiable", legacyCount: 2, legacyCheckpoint: "missing",
    });
    // Verification never re-signs or rewrites legacy rows.
    expect(await f.db.auditLog.findMany({ where: { chainVersion: 1 }, orderBy: { createdAt: "asc" } })).toEqual(before);

    // API: separate fields, SUPERADMIN only, no secret.
    const forbidden = await f.json("adminB", "POST", "/api/audit/verify");
    expect(forbidden.status).toBe(403);
    const response = await f.json("superadmin", "POST", "/api/audit/verify");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual(result);
    expect(JSON.stringify(body)).not.toContain(secret());

    // UI: the legacy line is separate from the chain line and never claims validity.
    const html = renderToStaticMarkup(createElement(AuditChainResult, { result: body }));
    expect(html).toContain("Rantai audit baru");
    expect(html).toContain("Valid. 1 entri diperiksa");
    expect(html).toContain("Arsip audit lama");
    expect(html).toContain("2 entri lama tidak dapat diverifikasi");
    expect(html).toContain("Checkpoint arsip lama belum dicatat");
    expect(html).not.toContain("cocok dengan checksum yang tersimpan");
  });

  it("checkpoint script: dry run by default, writes only the reviewed digest, never touches legacy rows", async () => {
    await insertLegacy(LEGACY, { provable: false });
    await logAudit({ actorId: f.ids.superadmin, action: "AUDIT_V2", entityType: "Test" });
    const legacyBefore = await f.db.auditLog.findMany({ where: { chainVersion: 1 }, orderBy: { id: "asc" } });

    const dry = checkpointCli([]);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.report).toMatchObject({ outcome: "dry-run", legacyVersion: 1, legacyCount: 2, legacyStatus: "unverifiable", checkpoint: null });
    const digest = dry.report!.legacyDigest as string;
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(await f.db.auditLog.count({ where: { action: AUDIT_CHECKPOINT_ACTION } })).toBe(0);

    expect(checkpointCli(["--apply"]).status).toBe(2);
    expect(checkpointCli(["--expected-digest", digest]).status).toBe(2);
    const wrong = checkpointCli(["--apply", "--expected-digest", "f".repeat(64)]);
    expect(wrong.status).toBe(3);
    expect(wrong.report).toMatchObject({ outcome: "digest-mismatch" });
    expect(await f.db.auditLog.count({ where: { action: AUDIT_CHECKPOINT_ACTION } })).toBe(0);

    const applied = checkpointCli(["--apply", "--expected-digest", digest]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.report).toMatchObject({ outcome: "written", legacyCount: 2, legacyDigest: digest });
    const rows = await chain();
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ action: AUDIT_CHECKPOINT_ACTION, entityType: "AuditChain", chainVersion: 2,
      metadataJson: { boundary: "v1->v2", legacyVersion: 1, legacyCount: 2, legacyDigest: digest, legacyStatus: "unverifiable" } });
    expect(await f.db.auditLog.findMany({ where: { chainVersion: 1 }, orderBy: { id: "asc" } })).toEqual(legacyBefore);
    expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedCount: 2, legacyStatus: "unverifiable", legacyCheckpoint: "matches" });

    const again = checkpointCli(["--apply", "--expected-digest", digest]);
    expect(again.report).toMatchObject({ outcome: "already-recorded" });
    expect(again.status).toBe(0);
    expect(await f.db.auditLog.count({ where: { action: AUDIT_CHECKPOINT_ACTION } })).toBe(1);

    // A legacy row changed after the checkpoint (even by a table owner bypassing the trigger) is reported.
    await tamperLegacy(legacyBefore[0].id, "LEGACY_REWRITTEN");
    const after = await verifyAuditChain();
    expect(after).toMatchObject({ valid: true, legacyStatus: "unverifiable", legacyCheckpoint: "mismatch" });
    const html = renderToStaticMarkup(createElement(AuditChainResult, { result: after }));
    expect(html).toContain("Arsip lama berubah sejak checkpoint dicatat");
    const conflict = checkpointCli(["--apply", "--expected-digest", checkpointCli([]).report!.legacyDigest]);
    expect(conflict.status).toBe(3);
    expect(conflict.report).toMatchObject({ outcome: "checkpoint-conflict" });
    expect(await f.db.auditLog.count({ where: { action: AUDIT_CHECKPOINT_ACTION } })).toBe(1);
  });

  it("migration: rows that exist are set to version 1 before the default becomes 2, checksums untouched", async () => {
    const schema = `a05_migration_${randomBytes(4).toString("hex")}`;
    const dir = mkdtempSync(path.join(tmpdir(), "a05-migration-"));
    try {
      // The pre-A05 table shape, derived from the live table.
      await f.db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await f.db.$executeRawUnsafe(`CREATE TABLE "${schema}"."AuditLog" (LIKE public."AuditLog" INCLUDING DEFAULTS)`);
      await f.db.$executeRawUnsafe(`ALTER TABLE "${schema}"."AuditLog" DROP COLUMN "chainVersion", DROP COLUMN "chainSequence"`);
      await f.db.$executeRawUnsafe(
        `INSERT INTO "${schema}"."AuditLog" (id, action, "entityType", "previousHash", checksum, "createdAt") VALUES
         ('legacy-1', 'OLD_ONE', 'Test', NULL, 'aaa', '2026-07-01T00:00:00Z'),
         ('legacy-2', 'OLD_TWO', 'Test', 'aaa', 'bbb', '2026-07-02T00:00:00Z')`);

      const script = path.join(dir, "migration.sql");
      writeFileSync(script, `SET search_path TO "${schema}";\n${readFileSync(MIGRATION, "utf8")}`);
      const run = spawnSync(path.join(ROOT, "node_modules/.bin/prisma"), ["db", "execute", "--file", script, "--url", process.env.DATABASE_URL ?? ""], {
        cwd: ROOT, env: process.env, encoding: "utf8", timeout: 120_000,
      });
      expect(run.status, run.stderr).toBe(0);

      const rows = await f.db.$queryRawUnsafe<{ id: string; chainVersion: number; chainSequence: bigint | null; previousHash: string | null; checksum: string }[]>(
        `SELECT id, "chainVersion", "chainSequence", "previousHash", checksum FROM "${schema}"."AuditLog" ORDER BY id`);
      expect(rows).toEqual([
        { id: "legacy-1", chainVersion: 1, chainSequence: null, previousHash: null, checksum: "aaa" },
        { id: "legacy-2", chainVersion: 1, chainSequence: null, previousHash: "aaa", checksum: "bbb" },
      ]);
      const [column] = await f.db.$queryRawUnsafe<{ column_default: string; is_nullable: string }[]>(
        `SELECT column_default, is_nullable FROM information_schema.columns
         WHERE table_schema = '${schema}' AND table_name = 'AuditLog' AND column_name = 'chainVersion'`);
      expect(column).toEqual({ column_default: "2", is_nullable: "NO" });
      // A sequenced insert takes the new default; an unsequenced one is legacy.
      await f.db.$executeRawUnsafe(`INSERT INTO "${schema}"."AuditLog" (id, action, "entityType", "chainSequence") VALUES ('new-1', 'NEW', 'Test', 1)`);
      await f.db.$executeRawUnsafe(`INSERT INTO "${schema}"."AuditLog" (id, action, "entityType") VALUES ('old-code', 'OLD', 'Test')`);
      expect(await f.db.$queryRawUnsafe(`SELECT id, "chainVersion" FROM "${schema}"."AuditLog" WHERE id IN ('new-1', 'old-code') ORDER BY id`))
        .toEqual([{ id: "new-1", chainVersion: 2 }, { id: "old-code", chainVersion: 1 }]);
      await expect(f.db.$executeRawUnsafe(`UPDATE "${schema}"."AuditLog" SET checksum = 'zzz' WHERE id = 'legacy-1'`))
        .rejects.toThrow(/legacy \(version 1\) archive/);
    } finally {
      await f.db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
