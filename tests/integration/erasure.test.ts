import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth";
import { decrypt, emailLookupHash, encrypt, isEncrypted, userWhereEmail } from "@/lib/encryption";
import {
  erasedEmailFor,
  getErasureStatus,
  processDueErasureJobs,
  requestErasure,
  runErasureJob,
  verifyDeletionRequestByOperator,
} from "@/lib/erasure-jobs";
import { exportUserData } from "@/lib/gdpr";
import type { CurrentUser } from "@/lib/rbac";
import type { AppRole } from "@/lib/roles";
import { generateTotpSecret } from "@/lib/totp";
import { transitionRedemption } from "@/lib/wallet-service";
import { f, type ActorKey, type FixtureActor } from "../support/audit-fixture";
import { InjectedFault, deferred, isStillPending, waitForBlockedBy } from "../support/race-probe";

type Json = Record<string, any>;

const HOUR_MS = 3_600_000;
const later = (ms: number) => new Date(Date.now() + ms);

async function patch(actor: ActorKey, id: string, body: Record<string, unknown>) {
  const response = await f.json(actor, "PATCH", `/api/redemptions/${id}`, body);
  return { status: response.status, body: (await response.json()) as Json };
}

async function eraseViaApi() {
  const response = await f.json("userA", "DELETE", "/api/user/data");
  return { response, body: (await response.json()) as Json };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

async function uploadProof(actor: FixtureActor, id: string) {
  const form = new FormData();
  form.append("file", new File([JPEG], "bukti.jpg", { type: "image/jpeg" }));
  const response = await fetch(new URL(`/api/redemptions/${id}/proof`, process.env.AUDIT_BASE_URL), {
    method: "POST", body: form, redirect: "manual",
    headers: { accept: "application/json", cookie: `${SESSION_COOKIE}=${await f.sessionCookie(actor)}` },
  });
  return response.status;
}

const proofDir = (id: string) => path.join(process.env.REDEMPTION_PROOF_STORAGE_DIR ?? "", id);
const storedProofs = (id: string) => (existsSync(proofDir(id)) ? readdirSync(proofDir(id)) : []);

async function actorFor(id: string): Promise<CurrentUser> {
  const user = await f.db.user.findUniqueOrThrow({ where: { id } });
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role as AppRole,
    organizationId: user.organizationId, organizationName: null, payoutEligible: user.payoutEligible, status: user.status };
}

/** Rows owned by `userId`, read raw (no decryption extension) so ciphertext changes are visible. */
async function ownedRows(plain: PrismaClient, userId: string) {
  const byId = { orderBy: { id: "asc" as const } };
  return {
    user: await plain.user.findUniqueOrThrow({ where: { id: userId } }),
    payoutAccounts: await plain.payoutAccount.findMany({ where: { userId }, ...byId }),
    redemptions: await plain.redemption.findMany({ where: { userId }, ...byId }),
    ledger: await plain.rewardLedger.findMany({ where: { userId }, ...byId }),
    sessions: await plain.depositSession.findMany({ where: { userId }, ...byId }),
    trips: await plain.trip.findMany({ where: { userId }, ...byId }),
    deviceTokens: await plain.deviceToken.findMany({ where: { userId }, ...byId }),
    resetTokens: await plain.passwordResetToken.findMany({ where: { userId }, ...byId }),
    notifications: await plain.notification.findMany({ where: { userId }, ...byId }),
    consents: await plain.consentRecord.findMany({ where: { userId }, ...byId }),
  };
}

/** Every row the erasure could conceivably touch, for "nothing else changed" checks. */
async function wholeDatabase(plain: PrismaClient) {
  const byId = { orderBy: { id: "asc" as const } };
  return {
    users: await plain.user.findMany(byId),
    payoutAccounts: await plain.payoutAccount.findMany(byId),
    redemptions: await plain.redemption.findMany(byId),
    ledger: await plain.rewardLedger.findMany(byId),
    sessions: await plain.depositSession.findMany(byId),
    trips: await plain.trip.findMany(byId),
    deviceTokens: await plain.deviceToken.findMany(byId),
    resetTokens: await plain.passwordResetToken.findMany(byId),
    notifications: await plain.notification.findMany(byId),
    consents: await plain.consentRecord.findMany(byId),
    deletionRequests: await plain.deletionRequest.findMany(byId),
    erasureSteps: await plain.erasureJobStep.findMany(byId),
    audit: await plain.auditLog.findMany(byId),
  };
}

async function erasureSteps(requestId: string) {
  return f.db.erasureJobStep.findMany({ where: { requestId }, orderBy: { step: "asc" } });
}

/** Rows that every erasure-related audit entry could carry (never the old identity). */
async function erasureAudits() {
  return f.db.auditLog.findMany({
    where: { OR: [{ action: { startsWith: "DATA_ERASURE" } }, { action: { startsWith: "ACCOUNT_DELETION" } },
      { action: { startsWith: "REDEMPTION_" } }] },
  });
}

describe("account erasure (real PostgreSQL foreign keys)", () => {
  it("keeps real foreign keys after erasing a user with deposit history", async () => {
    await f.depositHistory();
    const response = await f.json("userA","DELETE","/api/user/data");
    expect(response.status).toBe(202);
    const body = await response.json();
    await runErasureJob(body.requestId);
    const session = await f.db.depositSession.findFirstOrThrow({where:{userId:f.ids.userA}});
    const user = await f.db.user.findUniqueOrThrow({where:{id:session.userId}});
    expect(user.status).toBe("INACTIVE");
    expect(user.passwordHash).toBeNull();
  });

  it("keeps session, ledger, redemption and trip rows on the same pseudonymous user and removes the account's personal data", async () => {
    const userId = f.ids.userA;
    const plain = await f.connection();
    const oldEmail = f.credentials("userA").email;
    const account = await f.db.payoutAccount.findUniqueOrThrow({ where: { id: f.ids.payoutAccountA } });
    const digits = account.accountIdentifier;

    await f.depositHistory();
    await f.seedBalance(30_000);
    const paid = await f.redeemAndSettle(30_000);
    const proofed = await f.processingRedemption(20_000);
    expect(await uploadProof("superadmin", proofed)).toBe(201);
    expect((await patch("superadmin", proofed, { action: "success" })).status).toBe(200);
    const flagged = await f.processingRedemption(10_000);
    expect((await patch("superadmin", flagged, { action: "flag_reconciliation", note: `cek rekening ${digits}` })).status).toBe(200);
    expect((await patch("superadmin", flagged, { action: "success", providerReference: `TRF-${digits}`,
      note: `dibayar ke ${digits}` })).status).toBe(200);
    const trip = await f.trip({ bagCount: 1 });
    await f.db.trip.update({ where: { id: trip.id }, data: { status: "COMPLETED" } });
    await f.db.user.update({ where: { id: userId }, data: { totpSecret: encrypt(generateTotpSecret()), phone: "081234567890",
      // A02: a pending MFA setup must not survive the erasure either.
      pendingTotpSecret: encrypt(generateTotpSecret()), pendingTotpExpiresAt: later(10 * 60_000), pendingTotpTokenVersion: 0 } });
    await f.db.deviceToken.create({ data: { userId, token: `device-${randomUUID()}`, platform: "android" } });
    await f.db.passwordResetToken.create({ data: { userId, tokenHash: randomBytes(32).toString("hex"), expiresAt: later(HOUR_MS) } });
    await f.db.notification.create({ data: { userId, type: "REDEMPTION_STATUS", title: "Status", body: "Pencairan berhasil" } });
    await f.db.consentRecord.create({ data: { userId, consentType: "marketing_emails", granted: true, ipAddress: "203.0.113.9", userAgent: "audit" } });

    const before = await ownedRows(plain, userId);
    expect((await f.json("userA", "GET", "/api/auth/me")).status).toBe(200);

    // A pre-A04 row marked COMPLETED by hand (never run by the job) must not
    // stand in for this erasure or make it look finished.
    await f.db.deletionRequest.create({ data: { email: oldEmail, userId, scope: "FULL", status: "COMPLETED" } });

    const { response, body } = await eraseViaApi();
    expect(response.status).toBe(202);
    await runErasureJob(body.requestId);
    const view = await getErasureStatus(body.requestId);
    expect(view).toMatchObject({ status: "COMPLETED", completed: true, accountErased: true });
    // The response never claims that every piece of data is gone.
    expect(JSON.stringify(view)).not.toMatch(/(semua|seluruh) data/i);
    expect(view.retained.length).toBeGreaterThan(0);
    expect(response.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=;`) || /max-age=0/i.test(c))).toBe(true);

    // Same user id everywhere; every foreign key still resolves in PostgreSQL.
    const after = await ownedRows(plain, userId);
    expect(after.sessions.map((s) => s.id)).toEqual(before.sessions.map((s) => s.id));
    expect(after.ledger).toEqual(before.ledger); // financial history is not rewritten
    expect(after.redemptions.map(({ id, userId: owner, amount, status }) => ({ id, owner, amount, status })))
      .toEqual(before.redemptions.map(({ id, userId: owner, amount, status }) => ({ id, owner, amount, status })));
    expect(after.trips.map((t) => t.userId)).toEqual([userId]);
    const orphans = await plain.$queryRaw<{ table: string; n: number }[]>`
      SELECT 'DepositSession' AS table, count(*)::int AS n FROM "DepositSession" s LEFT JOIN "User" u ON u.id = s."userId" WHERE u.id IS NULL
      UNION ALL SELECT 'RewardLedger', count(*)::int FROM "RewardLedger" l LEFT JOIN "User" u ON u.id = l."userId" WHERE u.id IS NULL
      UNION ALL SELECT 'Redemption', count(*)::int FROM "Redemption" r LEFT JOIN "User" u ON u.id = r."userId" WHERE u.id IS NULL
      UNION ALL SELECT 'Trip', count(*)::int FROM "Trip" t LEFT JOIN "User" u ON u.id = t."userId" WHERE t."userId" IS NOT NULL AND u.id IS NULL`;
    expect(orphans.every((row) => row.n === 0)).toBe(true);
    const constraints = await plain.$queryRaw<{ conname: string; convalidated: boolean }[]>`
      SELECT conname, convalidated FROM pg_constraint
      WHERE conname IN ('DepositSession_userId_fkey', 'RewardLedger_userId_fkey', 'Redemption_userId_fkey', 'Trip_userId_fkey')
      ORDER BY conname`;
    expect(constraints).toEqual([
      { conname: "DepositSession_userId_fkey", convalidated: true },
      { conname: "Redemption_userId_fkey", convalidated: true },
      { conname: "RewardLedger_userId_fkey", convalidated: true },
      { conname: "Trip_userId_fkey", convalidated: true },
    ]);
    const joined = await f.db.depositSession.findFirstOrThrow({ where: { userId }, include: { user: true } });
    expect(joined.user.name).toBe("Pengguna dihapus");

    // Profile redacted through the encryption extension; secrets cleared; sessions revoked.
    expect(before.user.pendingTotpSecret).not.toBeNull();
    expect(after.user).toMatchObject({ phone: null, passwordHash: null, totpSecret: null, mfaEnabled: false,
      pendingTotpSecret: null, pendingTotpExpiresAt: null, pendingTotpTokenVersion: null,
      status: "INACTIVE", tokenVersion: before.user.tokenVersion + 1, emailLookup: emailLookupHash(`erased-${userId}@invalid.reloop`) });
    expect(isEncrypted(after.user.name) && decrypt(after.user.name)).toBe("Pengguna dihapus");
    expect(isEncrypted(after.user.email) && decrypt(after.user.email)).toBe(`erased-${userId}@invalid.reloop`);
    expect(await f.db.user.findUnique({ where: userWhereEmail(oldEmail) })).toBeNull();
    expect([after.deviceTokens, after.resetTokens, after.notifications]).toEqual([[], [], []]);
    expect(after.consents.map((c) => [c.ipAddress, c.userAgent])).toEqual([[null, null]]);
    expect((await f.json("userA", "GET", "/api/auth/me")).status).toBe(401);

    // Payout account disabled and its number/name erased; destination copies, notes and proofs removed.
    expect(after.payoutAccounts).toHaveLength(1);
    expect(after.payoutAccounts[0]).toMatchObject({ id: f.ids.payoutAccountA, status: "DISABLED", accountIdentifier: "", accountName: null });
    for (const row of after.redemptions) {
      expect(row).toMatchObject({ payoutDestinationIdentifier: null, payoutDestinationName: null, note: null,
        reconciliationNote: null, manualTransferProofUrl: null });
      expect(row.providerReference === null || row.providerReference.startsWith("erased-ref:")).toBe(true);
      expect(JSON.stringify(row)).not.toContain(digits);
    }
    expect(after.redemptions.find((r) => r.id === paid)?.providerReference).toMatch(/^erased-ref:[0-9a-f]{16}$/);
    expect(storedProofs(proofed)).toEqual([]);
    expect((await f.json("superadmin", "GET", `/api/redemptions/${proofed}/proof`)).status).toBe(404);
    const queue = (await (await f.json("superadmin", "GET", "/api/redemptions")).json()) as Json;
    for (const row of queue.redemptions.filter((r: Json) => r.userId === userId)) {
      expect(row.payoutDestination).toMatchObject({ erased: true, accountIdentifier: null, accountName: null });
      expect(JSON.stringify(row)).not.toContain(digits);
    }

    // The audit trail records the erasure but never the old identity or account data.
    const audits = await erasureAudits();
    expect(audits.some((a) => a.action === "DATA_ERASURE" && a.entityId === userId)).toBe(true);
    const auditText = JSON.stringify(audits);
    for (const secret of [oldEmail, "Pengguna Audit A", digits, "081234567890"]) {
      expect(auditText).not.toContain(secret);
    }

    // Logging in with the old credentials no longer works.
    const login = await f.json("guest", "POST", "/api/auth/login", f.credentials("userA"));
    expect(login.status).not.toBe(200);
  });

  it("rolls back every change when the erasure transaction fails midway, then completes on retry", async () => {
    const userId = f.ids.userA;
    const plain = await f.connection();
    await f.depositHistory();
    await f.db.deviceToken.create({ data: { userId, token: `device-${randomUUID()}`, platform: "ios" } });
    const { requestId, status } = await requestErasure(userId);
    expect(status).toBe("PROCESSING");
    const before = await ownedRows(plain, userId);
    const auditsBefore = await plain.auditLog.count();

    let sawWrites = false;
    await runErasureJob(requestId, {
      async afterAnonymizeWrites(tx) {
        const inside = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        sawWrites = inside.status === "INACTIVE" && inside.passwordHash === null;
        throw new InjectedFault("INJECTED_ERASURE_FAULT");
      },
    });
    expect(sawWrites).toBe(true);

    expect(await ownedRows(plain, userId)).toEqual(before);
    expect(await plain.auditLog.count({ where: { action: "DATA_ERASURE" } })).toBe(0);
    expect(await plain.auditLog.count()).toBe(auditsBefore);
    const failed = await getErasureStatus(requestId);
    expect(failed).toMatchObject({ status: "RETRYABLE_FAILED", completed: false, accountErased: false });
    expect(failed.message).not.toMatch(/berhasil/i);
    const [anonymize] = (await erasureSteps(requestId)).filter((s) => s.step === "ANONYMIZE_ACCOUNT");
    expect(anonymize).toMatchObject({ attempts: 1, completedAt: null, lastError: "InjectedFault" });
    expect(anonymize.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    // A failed attempt never locks the owner out.
    expect((await f.json("userA", "GET", "/api/auth/me")).status).toBe(200);

    await runErasureJob(requestId);
    expect(await getErasureStatus(requestId)).toMatchObject({ status: "COMPLETED", completed: true });
    expect((await f.db.user.findUniqueOrThrow({ where: { id: userId } })).status).toBe("INACTIVE");
  });

  it("a repeated job changes nothing and never touches another user's data", async () => {
    const plain = await f.connection();
    await f.depositHistory();
    await f.db.depositSession.create({ data: { userId: f.ids.userB, machineId: f.ids.machineA, status: "COMPLETED", completedAt: new Date() } });
    await f.db.payoutAccount.create({ data: { userId: f.ids.userB, provider: "OVO", accountIdentifier: "089900001111", accountName: "Pengguna Audit B" } });
    await f.db.deviceToken.create({ data: { userId: f.ids.userB, token: `device-${randomUUID()}`, platform: "android" } });
    await f.db.rewardLedger.create({ data: { userId: f.ids.userB, entryType: "EARN", amount: 5_000, status: "AVAILABLE",
      reasonCode: "AUDIT_FIXTURE", referenceType: "AuditFixture", referenceId: `audit-b-${randomUUID()}` } });
    const otherBefore = await ownedRows(plain, f.ids.userB);

    const { response, body } = await eraseViaApi();
    expect(response.status).toBe(202);
    await runErasureJob(body.requestId);
    expect((await getErasureStatus(body.requestId)).status).toBe("COMPLETED");
    const afterFirst = await wholeDatabase(plain);

    await runErasureJob(body.requestId);
    await runErasureJob(body.requestId);
    await processDueErasureJobs({ now: later(48 * HOUR_MS) });
    expect(await wholeDatabase(plain)).toEqual(afterFirst);
    expect(await ownedRows(plain, f.ids.userB)).toEqual(otherBefore);
    await expect(requestErasure(f.ids.userA)).rejects.toMatchObject({ status: 409 });
  });
});

describe("reserved placeholder address", () => {
  it("nobody can register or switch to an erased-account address, so erasure cannot be blocked by squatting", async () => {
    const placeholder = erasedEmailFor(f.ids.userA);
    const { password } = f.credentials("userB");
    const register = await f.json("guest", "POST", "/api/auth/register",
      { name: "Penyerobot", email: placeholder, password, phone: "081234567890" });
    expect(register.status).toBe(422);
    const change = await f.json("userB", "PATCH", "/api/auth/me", { email: placeholder.toUpperCase(), currentPassword: password });
    expect(change.status).toBe(422);
    expect(await f.db.user.findUnique({ where: userWhereEmail(placeholder) })).toBeNull();

    const { body } = await eraseViaApi();
    expect(body).toMatchObject({ status: "COMPLETED", completed: true });
  });
});

describe("open obligations hold erasure (pending reconciliation)", () => {
  it("a pending payout holds anonymization with a clear status and the job continues after settlement", async () => {
    const userId = f.ids.userA;
    const account = await f.db.payoutAccount.findUniqueOrThrow({ where: { id: f.ids.payoutAccountA } });
    const open = await f.processingRedemption(20_000);
    const ledgerBefore = await f.db.rewardLedger.findMany({ where: { userId }, orderBy: { id: "asc" } });

    const { response, body } = await eraseViaApi();
    expect(response.status).toBe(202);
    expect(body).toMatchObject({ status: "PENDING_RECONCILIATION", completed: false, accountErased: false });
    expect(body.resolutionSteps.join(" ")).toMatch(/pencairan/i);
    expect(body.message).toMatch(/belum ada data yang dihapus/i);

    // Nothing is anonymized yet and the owner keeps full access to settle the balance.
    const held = await f.db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(held.status).toBe("ACTIVE");
    expect(held.passwordHash).not.toBeNull();
    expect((await f.json("userA", "GET", "/api/auth/me")).status).toBe(200);
    expect((await f.json("guest", "POST", "/api/auth/login", f.credentials("userA"))).status).toBe(200);
    const snapshot = await f.db.redemption.findUniqueOrThrow({ where: { id: open } });
    expect(decrypt(snapshot.payoutDestinationIdentifier!)).toBe(account.accountIdentifier);
    expect((await f.db.payoutAccount.findUniqueOrThrow({ where: { id: account.id } })).status).toBe("VERIFIED");

    // Re-running or re-submitting while the payout is open changes nothing.
    await runErasureJob(body.requestId);
    expect((await getErasureStatus(body.requestId)).status).toBe("PENDING_RECONCILIATION");
    const again = await eraseViaApi();
    expect(again.body).toMatchObject({ requestId: body.requestId, status: "PENDING_RECONCILIATION" });
    expect((await f.db.user.findUniqueOrThrow({ where: { id: userId } })).status).toBe("ACTIVE");

    expect((await patch("superadmin", open, { action: "success", providerReference: "SETTLE-REF-1" })).status).toBe(200);
    // Not due yet: the periodic runner re-checks a held request later, not immediately.
    expect(await processDueErasureJobs({ now: new Date() })).toEqual([]);
    const ran = await processDueErasureJobs({ now: later(2 * HOUR_MS) });
    expect(ran).toEqual([expect.objectContaining({ requestId: body.requestId, status: "COMPLETED" })]);

    const erased = await f.db.redemption.findUniqueOrThrow({ where: { id: open } });
    expect(erased).toMatchObject({ status: "SUCCESS", payoutDestinationIdentifier: null, payoutDestinationName: null });
    expect((await f.db.user.findUniqueOrThrow({ where: { id: userId } })).status).toBe("INACTIVE");
    // The balance was settled, never forfeited: no new ledger row, only the reserve's status moved.
    const ledgerAfter = await f.db.rewardLedger.findMany({ where: { userId }, orderBy: { id: "asc" } });
    expect(ledgerAfter.map((l) => [l.id, l.amount])).toEqual(ledgerBefore.map((l) => [l.id, l.amount]));
  });

  it("an available balance holds erasure with a withdrawal step and is not forfeited", async () => {
    await f.seedBalance(15_000);
    const { body } = await eraseViaApi();
    expect(body.status).toBe("PENDING_RECONCILIATION");
    expect(body.resolutionSteps.join(" ")).toMatch(/Rp\s?15\.000/);
    expect((await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } })).status).toBe("ACTIVE");

    await f.redeemAndSettle(15_000);
    await runErasureJob(body.requestId);
    expect(await getErasureStatus(body.requestId)).toMatchObject({ status: "COMPLETED" });
  });

  it("an open deposit session or trip that can still mint a reward holds erasure", async () => {
    const session = await f.db.depositSession.create({ data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE" } });
    const trip = await f.trip({ bagCount: 1 });
    const { body } = await eraseViaApi();
    expect(body.status).toBe("PENDING_RECONCILIATION");
    const steps = body.resolutionSteps.join(" ");
    expect(steps).toMatch(/sesi setoran/i);
    expect(steps).toMatch(/trip/i);

    await f.db.depositSession.update({ where: { id: session.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    await runErasureJob(body.requestId);
    expect((await getErasureStatus(body.requestId)).status).toBe("PENDING_RECONCILIATION");
    await f.db.trip.update({ where: { id: trip.id }, data: { status: "COMPLETED" } });
    await runErasureJob(body.requestId);
    expect((await getErasureStatus(body.requestId)).status).toBe("COMPLETED");
  });

  it("settlement and erasure serialize on the user lock, so the erasure log counts what it erased", async () => {
    const open = await f.processingRedemption(20_000);
    const { body } = await eraseViaApi();
    expect(body.status).toBe("PENDING_RECONCILIATION");
    const superadmin = await actorFor(f.ids.superadmin);
    const observer = await f.connection();

    const locked = deferred<number>();
    const release = deferred();
    const settling = transitionRedemption(superadmin, open, { action: "success", providerReference: "RACE-REF" }, {
      async afterLock(tx) {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        locked.resolve(pid);
        await release.promise;
      },
    });
    settling.catch(() => {});
    const holderPid = await locked.promise;
    let erasing: Promise<void> | undefined;
    try {
      erasing = runErasureJob(body.requestId);
      erasing.catch(() => {});
      await waitForBlockedBy(observer, { holderPid, timeoutMs: 15_000 });
      expect(await isStillPending(erasing, 100)).toBe(true);
    } finally {
      release.resolve();
    }
    await settling;
    await erasing;

    // The job re-read the request after the settlement committed: it erased the
    // now-settled destination and its log counts exactly that row.
    expect(await getErasureStatus(body.requestId)).toMatchObject({ status: "COMPLETED" });
    expect(await f.db.redemption.findUniqueOrThrow({ where: { id: open } })).toMatchObject({
      status: "SUCCESS", payoutDestinationIdentifier: null });
    const audit = await f.db.auditLog.findFirstOrThrow({ where: { action: "DATA_ERASURE", entityId: f.ids.userA } });
    expect(audit.metadataJson).toMatchObject({ redemptionDestinationsErased: 1, openRedemptions: 0 });
  });
});

describe("external file cleanup", () => {
  it("a failed proof cleanup ends RETRYABLE_FAILED without leaking identity or claiming success", async () => {
    const id = await f.processingRedemption(20_000);
    expect(await uploadProof("superadmin", id)).toBe(201);
    expect((await patch("superadmin", id, { action: "success" })).status).toBe(200);
    expect(storedProofs(id)).toHaveLength(1);
    const oldEmail = f.credentials("userA").email;

    chmodSync(proofDir(id), 0o500); // the cleanup can no longer unlink the screenshot
    let body: Json;
    try {
      const erased = await eraseViaApi();
      expect(erased.response.status).toBe(202);
      body = erased.body;
      expect(body).toMatchObject({ status: "RETRYABLE_FAILED", completed: false, accountErased: true });
      expect(body.message).not.toMatch(/berhasil/i);
      expect(body.message).toMatch(/belum selesai/i);
      expect(storedProofs(id)).toHaveLength(1); // still on disk: nothing claims it is gone

      // Identity is already gone from the database and the file is no longer reachable.
      const user = await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } });
      expect(user).toMatchObject({ name: "Pengguna dihapus", status: "INACTIVE" });
      expect((await f.db.redemption.findUniqueOrThrow({ where: { id } })).manualTransferProofUrl).toBeNull();
      expect((await f.json("superadmin", "GET", `/api/redemptions/${id}/proof`)).status).toBe(404);
      expect(JSON.stringify(await erasureAudits())).not.toContain(oldEmail);
      const [cleanup] = (await erasureSteps(body.requestId)).filter((s) => s.step === "DELETE_PROOF_FILES");
      expect(cleanup).toMatchObject({ attempts: 1, completedAt: null, lastError: "EACCES" });
      expect(await getErasureStatus(body.requestId)).toMatchObject({ status: "RETRYABLE_FAILED", completed: false });
      // Backoff: the runner does not hammer the failing step immediately.
      expect(await processDueErasureJobs({ now: new Date() })).toEqual([]);
    } finally {
      chmodSync(proofDir(id), 0o700);
    }

    const ran = await processDueErasureJobs({ now: later(24 * HOUR_MS) });
    expect(ran).toEqual([expect.objectContaining({ requestId: body.requestId, status: "COMPLETED" })]);
    expect(storedProofs(id)).toEqual([]);
  });
});

describe("public deletion requests", () => {
  it("an unverified public request erases nothing; only the emailed one-time token starts it", async () => {
    const email = f.credentials("userA").email;
    const created = await f.json("guest", "POST", "/api/account-deletion-requests", { email, reason: "pindah kota" });
    expect(created.status).toBe(202);
    const body = (await created.json()) as Json;
    const unknown = await f.json("guest", "POST", "/api/account-deletion-requests", { email: "tidak-ada@reloop-audit.test" });
    expect(unknown.status).toBe(202);
    const unknownBody = (await unknown.json()) as Json;
    // Same answer whether or not the email has an account (no enumeration).
    expect(Object.keys(unknownBody).sort()).toEqual(Object.keys(body).sort());
    expect(unknownBody.status).toBe(body.status);
    expect(unknownBody.message).toBe(body.message);

    const request = await f.db.deletionRequest.findUniqueOrThrow({ where: { id: body.requestId } });
    expect(request).toMatchObject({ status: "PENDING", userId: f.ids.userA, verifiedAt: null });

    // Unverified: neither a direct job run nor the periodic runner acts on it,
    // even if job steps exist for it (verification is checked, not inferred).
    await runErasureJob(body.requestId);
    expect(await processDueErasureJobs({ now: later(48 * HOUR_MS) })).toEqual([]);
    const legacy = await f.db.deletionRequest.create({ data: { email, userId: f.ids.userA, scope: "FULL", status: "VERIFIED",
      steps: { create: [{ step: "ANONYMIZE_ACCOUNT" }, { step: "DELETE_PROOF_FILES" }] } } });
    await runErasureJob(legacy.id);
    expect(await processDueErasureJobs({ now: later(48 * HOUR_MS) })).toEqual([]);
    expect((await erasureSteps(legacy.id)).every((step) => step.attempts === 0 && step.completedAt === null)).toBe(true);
    await f.db.erasureJobStep.deleteMany({ where: { requestId: legacy.id } });
    await f.db.deletionRequest.delete({ where: { id: legacy.id } });
    expect(await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } })).toMatchObject({ status: "ACTIVE", name: "Pengguna Audit A" });
    expect(await f.db.deletionRequest.findUniqueOrThrow({ where: { id: body.requestId } })).toMatchObject({ status: "PENDING" });
    expect(await erasureSteps(body.requestId)).toEqual([]);
    expect(JSON.stringify(await erasureAudits())).not.toContain(email);

    // Mailed after the response, only for the real account, with a link on the
    // configured base URL (never the request Host).
    await vi.waitFor(async () => expect(await f.capturedTransport("mail")).toHaveLength(1), { timeout: 10_000 });
    const mails = await f.capturedTransport("mail");
    expect(mails.map((m) => m.kind === "mail" && m.to)).toEqual([email]);
    const text = mails[0].kind === "mail" ? mails[0].text : "";
    expect(text).toContain(`${process.env.NEXT_PUBLIC_BASE_URL}/account-deletion/confirm?token=`);
    const token = /\/account-deletion\/confirm\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1];
    expect(token).toBeTruthy();

    const confirm = (value: string) => f.json("guest", "POST", "/api/account-deletion-requests/confirm", { token: value });
    expect((await confirm(randomBytes(32).toString("base64url"))).status).toBe(400);
    await f.db.deletionRequest.update({ where: { id: body.requestId }, data: { verificationExpiresAt: new Date(Date.now() - 1_000) } });
    expect((await confirm(token!)).status).toBe(400);
    expect((await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } })).status).toBe("ACTIVE");
    await f.db.deletionRequest.update({ where: { id: body.requestId }, data: { verificationExpiresAt: later(HOUR_MS) } });

    const confirmed = await confirm(token!);
    expect(confirmed.status).toBe(202);
    expect(await confirmed.json()).toMatchObject({ requestId: body.requestId, status: "COMPLETED", completed: true });
    expect((await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } })).status).toBe("INACTIVE");
    const done = await f.db.deletionRequest.findUniqueOrThrow({ where: { id: body.requestId } });
    expect(done).toMatchObject({ verificationMethod: "EMAIL_TOKEN", verificationTokenHash: null, email: null, reason: null, ipAddress: null });
    expect((await confirm(token!)).status).toBe(400); // single use
  });

  it("an operator can verify a request for an owner who cannot log in or receive email", async () => {
    const created = await f.json("guest", "POST", "/api/account-deletion-requests", { email: f.credentials("userA").email });
    const { requestId } = (await created.json()) as Json;
    await expect(verifyDeletionRequestByOperator(requestId, { reference: "" })).rejects.toThrow();
    const result = await verifyDeletionRequestByOperator(requestId, { reference: "TIKET-2026-0042" });
    expect(result).toMatchObject({ requestId, status: "PROCESSING" });
    await runErasureJob(requestId);
    expect(await getErasureStatus(requestId)).toMatchObject({ status: "COMPLETED" });
    expect(await f.db.deletionRequest.findUniqueOrThrow({ where: { id: requestId } })).toMatchObject({ verificationMethod: "OPERATOR" });
  });
});

function runner(args: string[]) {
  const root = path.resolve(__dirname, "../..");
  const result = spawnSync(path.join(root, "node_modules/.bin/tsx"), ["scripts/process-erasure-jobs.ts", ...args], {
    cwd: root, env: process.env, encoding: "utf8", timeout: 90_000,
  });
  return { status: result.status, output: result.stdout ? (JSON.parse(result.stdout) as Json) : null, stderr: result.stderr };
}

describe("ops runner (scripts/process-erasure-jobs.ts)", () => {
  it("runs from the command line: operator verification, a held request, and refused arguments", async () => {
    const created = await f.json("guest", "POST", "/api/account-deletion-requests", { email: f.credentials("userA").email });
    const { requestId } = (await created.json()) as Json;

    // A pass never picks an unverified public request.
    const pass = runner([]);
    expect(pass.status).toBe(0);
    expect(pass.output).toMatchObject({ results: [], failing: 0 });

    // Held: an open payout keeps the operator-verified request in PENDING_RECONCILIATION.
    const open = await f.processingRedemption(20_000);
    const verified = runner(["--operator-verify", requestId, "--reference", "TIKET-2026-0042"]);
    expect(verified.status).toBe(0);
    expect(verified.output!.results).toEqual([{ requestId, status: "PENDING_RECONCILIATION", completed: false }]);
    expect((await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } })).status).toBe("ACTIVE");

    expect((await patch("superadmin", open, { action: "success", providerReference: "CLI-REF" })).status).toBe(200);
    const resumed = runner(["--request", requestId]);
    expect(resumed.status).toBe(0);
    expect(resumed.output!.results).toEqual([{ requestId, status: "COMPLETED", completed: true }]);
    expect((await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } })).status).toBe("INACTIVE");
    expect(JSON.stringify(resumed.output)).not.toContain(f.credentials("userA").email);

    expect(runner(["--force"]).status).toBe(2);
  });

  it("a runner without the proof storage mounted reports RETRYABLE_FAILED instead of a false completion", async () => {
    const id = await f.processingRedemption(20_000);
    expect(await uploadProof("superadmin", id)).toBe(201);
    expect((await patch("superadmin", id, { action: "success" })).status).toBe(200);
    const { requestId } = await requestErasure(f.ids.userA);
    const elsewhere = path.join(path.dirname(proofDir(id)), "..", `not-mounted-${randomUUID()}`);

    const misconfigured = spawnSync(path.resolve(__dirname, "../../node_modules/.bin/tsx"),
      ["scripts/process-erasure-jobs.ts", "--request", requestId], {
        cwd: path.resolve(__dirname, "../.."), encoding: "utf8", timeout: 90_000,
        env: { ...process.env, REDEMPTION_PROOF_STORAGE_DIR: elsewhere } });
    expect(misconfigured.status).toBe(3);
    expect(JSON.parse(misconfigured.stdout).results).toEqual([{ requestId, status: "RETRYABLE_FAILED", completed: false }]);
    const [cleanup] = (await erasureSteps(requestId)).filter((s) => s.step === "DELETE_PROOF_FILES");
    expect(cleanup).toMatchObject({ completedAt: null, lastError: "PROOF_STORAGE_MISSING" });
    expect(storedProofs(id)).toHaveLength(1);

    const fixed = runner(["--request", requestId]);
    expect(fixed.status).toBe(0);
    expect(fixed.output!.results).toEqual([{ requestId, status: "COMPLETED", completed: true }]);
    expect(storedProofs(id)).toEqual([]);
  });
});

describe("data export (access request)", () => {
  it("includes the owner's own payout destination and accounts in plaintext, never ciphertext", async () => {
    const account = await f.db.payoutAccount.findUniqueOrThrow({ where: { id: f.ids.payoutAccountA } });
    const open = await f.processingRedemption(20_000);
    const response = await f.json("userA", "GET", "/api/user/data");
    expect(response.status).toBe(200);
    const exported = (await response.json()) as Json;
    const redemption = exported.redemptions.find((r: Json) => r.id === open);
    expect(redemption.payoutDestination).toMatchObject({ accountIdentifier: account.accountIdentifier, accountName: account.accountName });
    expect(redemption).not.toHaveProperty("payoutDestinationIdentifier");
    expect(redemption).not.toHaveProperty("requestHash");
    expect(exported.payoutAccounts).toEqual([expect.objectContaining({ id: account.id, accountIdentifier: account.accountIdentifier })]);
    expect(JSON.stringify(exported)).not.toMatch(/[0-9a-f]{24}:[0-9a-f]{32}:/);
    // The streamed export and the in-memory export expose the same sections.
    expect(Object.keys(exported).sort()).toEqual(Object.keys(await exportUserData(f.ids.userA)).sort());
  });
});
