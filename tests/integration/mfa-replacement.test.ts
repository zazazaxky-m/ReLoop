import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { buildSessionPayload, SESSION_COOKIE, signSession, verifySessionToken } from "@/lib/auth";
import { decrypt, isEncrypted } from "@/lib/encryption";
import { createPasswordResetToken } from "@/lib/password-reset";
import type { AppRole } from "@/lib/roles";
import { generateTotpCode } from "@/lib/totp";
import { f, type FixtureActor } from "../support/audit-fixture";
import { deferred, isStillPending } from "../support/race-probe";

/**
 * SEC-04 / A02: replacing an MFA factor needs fresh proof (password, plus the
 * current TOTP when MFA is on), keeps the active factor until the new code is
 * confirmed, and a confirm/disable revokes every other session.
 */

type Json = Record<string, any>;

const SETUP = "/api/auth/mfa/setup";
const ENABLE = "/api/auth/mfa/enable";
const DISABLE = "/api/auth/mfa/disable";
const PENDING_TTL_MS = 10 * 60_000;

async function call(actor: FixtureActor | "guest", method: string, route: string, body?: unknown) {
  const response = await f.json(actor, method, route, body);
  return { response, status: response.status, body: (await response.json()) as Json };
}

/** A request with an explicit session token (another device / a fresh login). */
async function callWith(token: string, method: string, route: string, body?: unknown) {
  const base = process.env.AUDIT_BASE_URL;
  if (!base) throw new Error("AUDIT_BASE_URL missing; run through npm run test:integration");
  const headers: Record<string, string> = { accept: "application/json", cookie: `${SESSION_COOKIE}=${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(new URL(route, base), {
    method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Json };
}

/** A session for `userId` at its current tokenVersion, as another device would hold it. */
async function sessionAtCurrentVersion(userId: string) {
  const user = await f.db.user.findUniqueOrThrow({ where: { id: userId } });
  return signSession(buildSessionPayload({ ...user, role: user.role as AppRole }));
}

async function row(userId = f.ids.adminA) {
  return f.db.user.findUniqueOrThrow({ where: { id: userId } });
}

function password(actor: FixtureActor = "adminA") {
  return f.credentials(actor).password;
}

/** A six-digit code that is not the current one. */
function otherCode(code: string) {
  return String((Number(code) + 500_000) % 1_000_000).padStart(6, "0");
}

async function startReplacement() {
  const res = await call("adminA", "POST", SETUP, { currentPassword: password(), currentCode: f.totpCode("adminA") });
  expect(res.status).toBe(200);
  expect(typeof res.body.secret).toBe("string");
  return res.body as { secret: string; otpauthUrl: string; replacement: boolean; expiresAt: string };
}

/** Full login through /api/auth/login + /api/auth/mfa/verify; returns the verify status. */
async function loginWithCode(code: string) {
  const login = await call("guest", "POST", "/api/auth/login", f.credentials("adminA"));
  expect(login.status).toBe(200);
  expect(login.body.requiresMfa).toBe(true);
  const verify = await call("guest", "POST", "/api/auth/mfa/verify", { challengeToken: login.body.challengeToken, code });
  return verify.status;
}

function expectNoPending(user: Awaited<ReturnType<typeof row>>) {
  expect(user.pendingTotpSecret).toBeNull();
  expect(user.pendingTotpExpiresAt).toBeNull();
  expect(user.pendingTotpTokenVersion).toBeNull();
}

/** Another transaction holding the User row lock on its own connection. */
async function holdUserLock(userId: string) {
  const connection = await f.connection();
  const locked = deferred<number>();
  const release = deferred();
  const done = connection.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`;
    locked.resolve(pid);
    await release.promise;
  }, { maxWait: 10_000, timeout: 90_000 });
  done.catch((error) => locked.reject(error));
  const pid = await locked.promise;
  return {
    pid,
    async release() {
      release.resolve();
      await done;
    },
  };
}

/**
 * Bounded: rejects unless `count` backends queue behind `holderPid` within
 * `timeoutMs`. Row-lock waiters form a queue: the first waits on the holder,
 * later ones on the waiter ahead of them, so follow the wait chain.
 */
async function waitForLockQueue(observer: PrismaClient, holderPid: number, count: number, timeoutMs = 4_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waiting = await observer.$queryRaw<{ pid: number; blockers: number[] }[]>`
      SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND cardinality(pg_blocking_pids(pid)) > 0`;
    const queue = new Set<number>([holderPid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const { pid, blockers } of waiting) {
        if (!queue.has(pid) && blockers.some((blocker) => queue.has(blocker))) {
          queue.add(pid);
          grew = true;
        }
      }
    }
    if (queue.size - 1 >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${count} backends did not queue behind ${holderPid} within ${timeoutMs}ms`);
}

function nextLogPath() {
  const dir = process.env.AUDIT_ARTIFACT_DIR;
  if (!dir) throw new Error("AUDIT_ARTIFACT_DIR missing; run through npm run test:integration");
  return path.join(dir, "logs", "next.log");
}

describe("MFA factor replacement (SEC-04)", () => {
  it("does not disable an active factor when setup lacks fresh proof", async () => {
    const before = await f.db.user.findUniqueOrThrow({where:{id:f.ids.adminA}});
    const res = await f.json("adminA", "POST", "/api/auth/mfa/setup", {});
    expect(res.status).toBe(422);
    const after = await f.db.user.findUniqueOrThrow({where:{id:f.ids.adminA}});
    expect(after.totpSecret).toBe(before.totpSecret);
    expect(after.mfaEnabled).toBe(before.mfaEnabled);
  });

  it("refuses replacement without the current code, or with a wrong password or code, and never reveals a secret", async () => {
    const before = await row();
    const activeSecret = decrypt(before.totpSecret!);
    const code = f.totpCode("adminA");

    const noCode = await call("adminA", "POST", SETUP, { currentPassword: password() });
    const wrongPassword = await call("adminA", "POST", SETUP, { currentPassword: `${password()}x`, currentCode: code });
    const wrongCode = await call("adminA", "POST", SETUP, { currentPassword: password(), currentCode: otherCode(code) });

    expect(noCode.status).toBe(422);
    expect(wrongPassword.status).toBe(400);
    expect(wrongCode.status).toBe(400);
    // One message for either wrong factor: no password oracle behind the TOTP.
    expect(wrongPassword.body.error).toBe(wrongCode.body.error);
    for (const res of [noCode, wrongPassword, wrongCode]) {
      expect(res.body).not.toHaveProperty("secret");
      expect(res.body).not.toHaveProperty("otpauthUrl");
      expect(res.body).not.toHaveProperty("qrDataUrl");
      expect(JSON.stringify(res.body)).not.toContain(activeSecret);
    }

    const after = await row();
    expect(after.totpSecret).toBe(before.totpSecret);
    expect(after.mfaEnabled).toBe(true);
    expect(after.tokenVersion).toBe(before.tokenVersion);
    expectNoPending(after);
    const failures = await f.db.auditLog.count({ where: { action: "MFA_SETUP_PROOF_FAILED", entityId: f.ids.adminA } });
    expect(failures).toBe(2);
  });

  it("keeps the active factor while a replacement is pending and stores the new secret encrypted for ten minutes", async () => {
    const before = await row();
    const activeSecret = decrypt(before.totpSecret!);
    const startedAt = Date.now();
    const setup = await startReplacement();

    expect(setup.replacement).toBe(true);
    expect(setup.secret).not.toBe(activeSecret);
    expect(setup.otpauthUrl).toContain(`secret=${setup.secret}`);
    expect(JSON.stringify(setup)).not.toContain(activeSecret);

    const after = await row();
    expect(after.totpSecret).toBe(before.totpSecret);
    expect(after.mfaEnabled).toBe(true);
    expect(after.tokenVersion).toBe(before.tokenVersion);
    expect(isEncrypted(after.pendingTotpSecret!)).toBe(true);
    expect(decrypt(after.pendingTotpSecret!)).toBe(setup.secret);
    expect(after.pendingTotpTokenVersion).toBe(before.tokenVersion);
    const ttl = after.pendingTotpExpiresAt!.getTime() - startedAt;
    expect(ttl).toBeGreaterThan(PENDING_TTL_MS - 30_000);
    expect(ttl).toBeLessThanOrEqual(PENDING_TTL_MS + 5_000);
    expect(new Date(setup.expiresAt).getTime()).toBe(after.pendingTotpExpiresAt!.getTime());

    // Login still takes the old factor; the pending one is not active yet.
    expect(await loginWithCode(generateTotpCode(setup.secret))).toBe(401);
    expect(await loginWithCode(f.totpCode("adminA"))).toBe(200);
  });

  it("confirms a replacement atomically, revokes other sessions and re-issues the requester's session", async () => {
    const before = await row();
    const otherDevice = await sessionAtCurrentVersion(f.ids.adminA);
    expect((await callWith(otherDevice, "GET", "/api/auth/me")).status).toBe(200);
    const setup = await startReplacement();

    const wrong = await call("adminA", "POST", ENABLE, { code: otherCode(generateTotpCode(setup.secret)) });
    expect(wrong.status).toBe(400);
    expect(JSON.stringify(wrong.body)).not.toContain(setup.secret);
    expect((await row()).pendingTotpSecret).not.toBeNull(); // a wrong code does not discard the setup

    const ok = await call("adminA", "POST", ENABLE, { code: generateTotpCode(setup.secret) });
    expect(ok.status).toBe(200);
    expect(JSON.stringify(ok.body)).not.toContain(setup.secret);
    expect(ok.response.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`) && !/max-age=0/i.test(c))).toBe(true);

    const after = await row();
    expect(decrypt(after.totpSecret!)).toBe(setup.secret);
    expect(after.mfaEnabled).toBe(true);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expectNoPending(after);

    // Every other session is revoked; the requester keeps working on the new cookie.
    expect((await callWith(otherDevice, "GET", "/api/auth/me")).status).toBe(401);
    expect((await call("adminA", "GET", "/api/auth/me")).status).toBe(200);
    expect(await verifySessionToken(await f.sessionCookie("adminA"))).toMatchObject({
      sub: f.ids.adminA, tokenVersion: before.tokenVersion + 1,
    });

    // The old factor no longer signs in; the new one does.
    expect(await loginWithCode(f.totpCode("adminA"))).toBe(401);
    expect(await loginWithCode(generateTotpCode(setup.secret))).toBe(200);
    expect(await f.db.auditLog.count({ where: { action: "MFA_REPLACED", entityId: f.ids.adminA } })).toBe(1);
  });

  it("rejects an expired pending secret and keeps the old factor active", async () => {
    const before = await row();
    const setup = await startReplacement();
    await f.db.user.update({ where: { id: f.ids.adminA }, data: { pendingTotpExpiresAt: new Date(Date.now() - 1_000) } });

    const res = await call("adminA", "POST", ENABLE, { code: generateTotpCode(setup.secret) });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).not.toContain(setup.secret);

    const after = await row();
    expect(after.totpSecret).toBe(before.totpSecret);
    expect(after.mfaEnabled).toBe(true);
    expect(after.tokenVersion).toBe(before.tokenVersion);
    expectNoPending(after); // the expired secret is discarded
    expect(await loginWithCode(f.totpCode("adminA"))).toBe(200);
  });

  it("aborting a replacement only discards the pending secret", async () => {
    const before = await row();
    const setup = await startReplacement();

    const abort = await call("adminA", "DELETE", SETUP);
    expect(abort.status).toBe(200);
    const after = await row();
    expect(after.totpSecret).toBe(before.totpSecret);
    expect(after.mfaEnabled).toBe(true);
    expect(after.tokenVersion).toBe(before.tokenVersion);
    expectNoPending(after);

    // The aborted secret can no longer be confirmed, the old one still signs in.
    expect((await call("adminA", "POST", ENABLE, { code: generateTotpCode(setup.secret) })).status).toBe(409);
    expect((await row()).totpSecret).toBe(before.totpSecret);
    expect(await loginWithCode(f.totpCode("adminA"))).toBe(200);
  });

  it("lets exactly one of two parallel replacement confirms succeed (deterministic lock order)", async () => {
    const before = await row();
    const setup = await startReplacement();
    // Compile the route first so both racers reach the lock well inside lock_timeout.
    expect((await call("adminA", "POST", ENABLE, { code: otherCode(generateTotpCode(setup.secret)) })).status).toBe(400);

    const observer = await f.connection();
    const holder = await holdUserLock(f.ids.adminA);
    const code = generateTotpCode(setup.secret);
    let racers: Promise<number>[];
    try {
      racers = [0, 1].map(() => call("adminA", "POST", ENABLE, { code }).then((r) => r.status));
      await waitForLockQueue(observer, holder.pid, 2);
      expect(await isStillPending(Promise.all(racers), 100)).toBe(true);
    } finally {
      await holder.release();
    }
    const statuses = (await Promise.all(racers)).sort();
    expect(statuses).toEqual([200, 409]);

    const after = await row();
    expect(decrypt(after.totpSecret!)).toBe(setup.secret);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1); // promoted once, not twice
    expectNoPending(after);
    expect(await f.db.auditLog.count({ where: { action: "MFA_REPLACED", entityId: f.ids.adminA } })).toBe(1);
  });

  it("a password change through /api/auth/me cancels a pending setup", async () => {
    const before = await row();
    const setup = await startReplacement();

    const changed = await call("adminA", "PATCH", "/api/auth/me", {
      currentPassword: password(), newPassword: "Audit-Password-Changed-12345",
    });
    expect(changed.status).toBe(200);

    const after = await row();
    expectNoPending(after);
    expect(after.totpSecret).toBe(before.totpSecret);
    expect(after.mfaEnabled).toBe(true);
    // The requester's rotated session cannot confirm the cancelled secret.
    expect((await call("adminA", "POST", ENABLE, { code: generateTotpCode(setup.secret) })).status).toBe(409);
    expect((await row()).totpSecret).toBe(before.totpSecret);
  });

  it("a password reset cancels a pending setup", async () => {
    const before = await row();
    await startReplacement();

    const token = await createPasswordResetToken(f.ids.adminA);
    const reset = await call("guest", "POST", "/api/auth/reset-password", { token, password: "Audit-Password-Reset-12345" });
    expect(reset.status).toBe(200);

    const after = await row();
    expectNoPending(after);
    expect(after.totpSecret).toBe(before.totpSecret);
    expect(after.mfaEnabled).toBe(true);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
  });

  it("binds a pending setup to the session generation it was started in", async () => {
    const before = await row();
    const setup = await startReplacement();
    // Authorization changed elsewhere (e.g. suspension then reinstatement); the admin signs in again.
    await f.db.user.update({ where: { id: f.ids.adminA }, data: { tokenVersion: { increment: 1 } } });
    const fresh = await sessionAtCurrentVersion(f.ids.adminA);

    const res = await callWith(fresh, "POST", ENABLE, { code: generateTotpCode(setup.secret) });
    expect(res.status).toBe(409);
    const after = await row();
    expect(after.totpSecret).toBe(before.totpSecret);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expectNoPending(after);
  });

  it("first setup needs the password (no code) and leaves MFA off until confirmed", async () => {
    const before = await row(f.ids.adminB);
    expect(before.mfaEnabled).toBe(false);

    expect((await call("adminB", "POST", SETUP, {})).status).toBe(422);
    const wrong = await call("adminB", "POST", SETUP, { currentPassword: `${password("adminB")}x` });
    expect(wrong.status).toBe(400);
    expect(wrong.body).not.toHaveProperty("secret");

    const setup = await call("adminB", "POST", SETUP, { currentPassword: password("adminB") });
    expect(setup.status).toBe(200);
    expect(setup.body.replacement).toBe(false);
    const pending = await row(f.ids.adminB);
    expect(pending.mfaEnabled).toBe(false);
    expect(pending.totpSecret).toBeNull();
    expect(decrypt(pending.pendingTotpSecret!)).toBe(setup.body.secret);

    const other = await sessionAtCurrentVersion(f.ids.adminB);
    const ok = await call("adminB", "POST", ENABLE, { code: generateTotpCode(setup.body.secret) });
    expect(ok.status).toBe(200);
    const after = await row(f.ids.adminB);
    expect(after.mfaEnabled).toBe(true);
    expect(decrypt(after.totpSecret!)).toBe(setup.body.secret);
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expectNoPending(after);
    expect((await callWith(other, "GET", "/api/auth/me")).status).toBe(401);
    expect((await call("adminB", "GET", "/api/auth/me")).status).toBe(200);
    expect(await f.db.auditLog.count({ where: { action: "MFA_ENABLED", entityId: f.ids.adminB } })).toBe(1);
  });

  it("disable needs password and code, revokes other sessions and keeps the requester signed in", async () => {
    const before = await row();
    const otherDevice = await sessionAtCurrentVersion(f.ids.adminA);
    const code = f.totpCode("adminA");

    expect((await call("adminA", "POST", DISABLE, { code })).status).toBe(422);
    const wrongPassword = await call("adminA", "POST", DISABLE, { currentPassword: `${password()}x`, code });
    const wrongCode = await call("adminA", "POST", DISABLE, { currentPassword: password(), code: otherCode(code) });
    expect(wrongPassword.status).toBe(400);
    expect(wrongCode.status).toBe(400);
    expect(wrongPassword.body.error).toBe(wrongCode.body.error);
    expect((await row()).mfaEnabled).toBe(true);

    await startReplacement(); // a pending setup is dropped with the factor
    const ok = await call("adminA", "POST", DISABLE, { currentPassword: password(), code: f.totpCode("adminA") });
    expect(ok.status).toBe(200);

    const after = await row();
    expect(after.mfaEnabled).toBe(false);
    expect(after.totpSecret).toBeNull();
    expect(after.tokenVersion).toBe(before.tokenVersion + 1);
    expectNoPending(after);
    expect((await callWith(otherDevice, "GET", "/api/auth/me")).status).toBe(401);
    expect((await call("adminA", "GET", "/api/auth/me")).status).toBe(200);
  });

  it("rate-limits setup, confirm and disable per user and IP", async () => {
    const wrongProof = { currentPassword: `${password()}x`, currentCode: "000000" };
    const setupStatuses: number[] = [];
    for (let i = 0; i < 6; i += 1) setupStatuses.push((await call("adminA", "POST", SETUP, wrongProof)).status);
    expect(setupStatuses).toEqual([400, 400, 400, 400, 400, 429]);
    // Correct proof is still throttled for this user + IP ...
    expect((await call("adminA", "POST", SETUP, { currentPassword: password(), currentCode: f.totpCode("adminA") })).status).toBe(429);
    // ... but another admin from the same IP is not.
    expect((await call("adminB", "POST", SETUP, { currentPassword: password("adminB") })).status).toBe(200);

    const enableStatuses: number[] = [];
    for (let i = 0; i < 11; i += 1) enableStatuses.push((await call("adminB", "POST", ENABLE, { code: "000000" })).status);
    expect(enableStatuses.slice(0, 10).every((s) => s === 400 || s === 409)).toBe(true);
    expect(enableStatuses[10]).toBe(429);

    const disableStatuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      disableStatuses.push((await call("adminA", "POST", DISABLE, { currentPassword: `${password()}x`, code: "000000" })).status);
    }
    expect(disableStatuses).toEqual([400, 400, 400, 400, 400, 429]);
    expect((await row()).mfaEnabled).toBe(true);
  });

  it("the database keeps the three pending fields all set or all null", async () => {
    const [constraint] = await f.db.$queryRaw<{ convalidated: boolean }[]>`
      SELECT convalidated FROM pg_constraint WHERE conname = 'User_pendingTotp_all_or_none'`;
    expect(constraint).toEqual({ convalidated: true });
    await expect(f.db.user.update({ where: { id: f.ids.adminA }, data: { pendingTotpSecret: "x" } }))
      .rejects.toThrow(/User_pendingTotp_all_or_none/);
    await startReplacement();
    await expect(f.db.user.update({ where: { id: f.ids.adminA }, data: { pendingTotpExpiresAt: null } }))
      .rejects.toThrow(/User_pendingTotp_all_or_none/);
  });

  it("never writes codes, secrets or the password to the audit log or the server log", async () => {
    const logFile = nextLogPath();
    const offset = statSync(logFile).size;
    const before = await row();
    const forbidden = new Set<string>([password(), decrypt(before.totpSecret!)]);

    const failedCode = otherCode(f.totpCode("adminA"));
    forbidden.add(failedCode);
    expect((await call("adminA", "POST", SETUP, { currentPassword: password(), currentCode: failedCode })).status).toBe(400);
    const proofCode = f.totpCode("adminA");
    forbidden.add(proofCode);
    const setup = await call("adminA", "POST", SETUP, { currentPassword: password(), currentCode: proofCode });
    expect(setup.status).toBe(200);
    forbidden.add(setup.body.secret);
    const wrongNew = otherCode(generateTotpCode(setup.body.secret));
    forbidden.add(wrongNew);
    expect((await call("adminA", "POST", ENABLE, { code: wrongNew })).status).toBe(400);
    const newCode = generateTotpCode(setup.body.secret);
    forbidden.add(newCode);
    expect((await call("adminA", "POST", ENABLE, { code: newCode })).status).toBe(200);
    const disableCode = generateTotpCode(setup.body.secret);
    forbidden.add(disableCode);
    expect((await call("adminA", "POST", DISABLE, { currentPassword: password(), code: disableCode })).status).toBe(200);

    const audit = await f.db.auditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(audit.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      "MFA_SETUP_PROOF_FAILED", "MFA_SETUP_STARTED", "MFA_ENABLE_FAILED", "MFA_REPLACED", "MFA_DISABLED",
    ]));
    const auditText = JSON.stringify(audit.map((entry) => ({ action: entry.action, metadata: entry.metadataJson })));

    await new Promise((resolve) => setTimeout(resolve, 500)); // let the runner flush the Next log
    const serverLog = readFileSync(logFile).subarray(offset).toString("utf8");
    expect(serverLog).toContain(SETUP); // the window covers these requests
    for (const value of forbidden) {
      expect(auditText).not.toContain(value);
      expect(serverLog).not.toContain(value);
    }
  });
});
