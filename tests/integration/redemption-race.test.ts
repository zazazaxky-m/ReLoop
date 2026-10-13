import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { lockUser } from "@/lib/db-locks";
import { getWalletBalance } from "@/lib/ledger";
import type { CurrentUser } from "@/lib/rbac";
import type { AppRole } from "@/lib/roles";
import { requestRedemption } from "@/lib/wallet-service";
import { f, type ActorKey } from "../support/audit-fixture";
import {
  InjectedFault,
  backendsBlockedBy,
  deferred,
  failAfterCommit,
  isStillPending,
  waitForBlockedBy,
} from "../support/race-probe";

const REDEMPTIONS = "/api/redemptions";

async function postRedemption(actor: ActorKey, body: Record<string, unknown>) {
  const response = await f.json(actor, "POST", REDEMPTIONS, body);
  return { status: response.status, body: await response.json() };
}

/** The service's actor, as requireApiUser would build it (in-process calls). */
async function actorFor(id: string): Promise<CurrentUser> {
  const user = await f.db.user.findUniqueOrThrow({ where: { id } });
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role as AppRole,
    organizationId: user.organizationId, organizationName: null, payoutEligible: user.payoutEligible, status: user.status };
}

/** Another wallet transaction holding userId's row lock on its own connection. */
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

describe("POST /api/redemptions under concurrency (real PostgreSQL)", () => {
  it("two different requests cannot reserve the same money", async () => {
    await f.seedBalance(50_000);
    const results = await Promise.all(["one","two"].map(idempotencyKey =>
      f.json("userA","POST","/api/redemptions",{
        amount:50_000,payoutAccountId:f.ids.payoutAccountA,idempotencyKey,
      })));
    expect(results.map(r=>r.status).sort()).toEqual([201,422]);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(0);
  });

  it("serializes 20 competing requests so reserves never exceed the starting balance", async () => {
    await f.seedBalance(100_000);
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => postRedemption("userA", {
      amount: 15_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `compete-${i}-${randomUUID()}`,
    })));

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(6);
    expect(statuses.filter((s) => s === 422)).toHaveLength(14);
    for (const rejected of results.filter((r) => r.status === 422)) {
      expect(rejected.body.error).toBe("Saldo tersedia tidak mencukupi");
    }

    const balance = await getWalletBalance(f.ids.userA);
    expect(balance.available).toBe(10_000);
    expect(balance.reserved).toBe(90_000);
    const reserves = await f.db.rewardLedger.findMany({ where: { userId: f.ids.userA, entryType: "REDEEM" } });
    const aggregateReserve = reserves.reduce((sum, row) => sum - row.amount, 0);
    expect(aggregateReserve).toBeLessThanOrEqual(100_000);
    const redemptions = await f.db.redemption.findMany({ where: { userId: f.ids.userA } });
    expect(redemptions).toHaveLength(6);
    expect(reserves.map((r) => r.referenceId).sort()).toEqual(redemptions.map((r) => r.id).sort());
    expect(reserves.map((r) => r.businessKey).sort()).toEqual(redemptions.map((r) => `redemption:${r.id}:reserve`).sort());
    expect(new Set(redemptions.map((r) => r.requestHash)).size).toBe(1); // same amount + account => same canonical hash
  });

  it("creates one redemption for concurrent retries with the same key and body", async () => {
    await f.seedBalance(50_000);
    const body = { amount: 20_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `same-${randomUUID()}` };
    const results = await Promise.all(Array.from({ length: 8 }, () => postRedemption("userA", body)));

    const created = results.filter((r) => r.status === 201);
    const replays = results.filter((r) => r.status === 200);
    expect(created).toHaveLength(1);
    expect(replays).toHaveLength(7);
    for (const replay of replays) {
      expect(replay.body.idempotent).toBe(true);
      expect(replay.body.redemption.id).toBe(created[0].body.redemption.id);
    }
    expect(await f.db.redemption.count({ where: { userId: f.ids.userA } })).toBe(1);
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA, entryType: "REDEEM" } })).toBe(1);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(30_000);
  });

  it("answers 409 when a key is reused with a different amount or account", async () => {
    await f.seedBalance(60_000);
    const key = `diff-${randomUUID()}`;
    const first = await postRedemption("userA", { amount: 20_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: key });
    expect(first.status).toBe(201);
    const otherAccount = await f.db.payoutAccount.create({
      data: { userId: f.ids.userA, provider: "OVO", accountIdentifier: "081200000001", accountName: "Pengguna Audit A", status: "VERIFIED" },
    });

    for (const changed of [
      { amount: 25_000, payoutAccountId: f.ids.payoutAccountA },
      { amount: 20_000, payoutAccountId: otherAccount.id },
    ]) {
      const reused = await postRedemption("userA", { ...changed, idempotencyKey: key });
      expect(reused.status).toBe(409);
      expect(reused.body.error).toMatch(/sudah pernah diajukan dengan jumlah atau akun berbeda/);
      expect(reused.body.redemption).toBeUndefined();
    }

    const racedKey = `diff-race-${randomUUID()}`;
    const raced = await Promise.all([10_000, 15_000].map((amount) => postRedemption("userA", {
      amount, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: racedKey,
    })));
    expect(raced.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await f.db.redemption.count({ where: { userId: f.ids.userA } })).toBe(2);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(60_000 - 20_000 - raced.find((r) => r.status === 201)!.body.redemption.amount);
  });

  it("never returns another user's redemption for the same key", async () => {
    await f.seedBalance(30_000);
    const key = `shared-${randomUUID()}`;
    const mine = await postRedemption("userA", { amount: 20_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: key });
    expect(mine.status).toBe(201);

    const probe = await postRedemption("userB", { amount: 20_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: key });
    expect(probe.status).toBe(404);
    expect(JSON.stringify(probe.body)).not.toContain(mine.body.redemption.id);

    const accountB = await f.db.payoutAccount.create({
      data: { userId: f.ids.userB, provider: "DANA", accountIdentifier: "081300000002", accountName: "Pengguna Audit B", status: "VERIFIED" },
    });
    await f.db.rewardLedger.create({
      data: { userId: f.ids.userB, entryType: "EARN", amount: 25_000, status: "AVAILABLE",
        reasonCode: "AUDIT_FIXTURE", referenceType: "AuditFixture", referenceId: `audit-fixture:${randomUUID()}` },
    });
    const theirs = await postRedemption("userB", { amount: 20_000, payoutAccountId: accountB.id, idempotencyKey: key });
    expect(theirs.status).toBe(201);
    expect(theirs.body.redemption.id).not.toBe(mine.body.redemption.id);
    expect(theirs.body.redemption.userId).toBe(f.ids.userB);
    expect(await f.db.redemption.count({ where: { idempotencyKey: key } })).toBe(2);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(10_000);
  });

  it("replays the committed request when a client retries after losing the response", async () => {
    await f.seedBalance(40_000);
    const body = { amount: 25_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `retry-${randomUUID()}` };
    const first = await postRedemption("userA", body);
    expect(first.status).toBe(201);
    // The client never saw `first`; it retries the same logical request.
    const retry = await postRedemption("userA", body);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ idempotent: true, redemption: { id: first.body.redemption.id } });
    expect(await f.db.redemption.count({ where: { userId: f.ids.userA } })).toBe(1);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(15_000);
  });

  it("replays the committed request after a response lost post-commit (fault injected in-process)", async () => {
    await f.seedBalance(40_000);
    const actor = await actorFor(f.ids.userA);
    const body = { amount: 25_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `lost-${randomUUID()}` };
    await expect(requestRedemption(actor, body, { afterCommit: failAfterCommit() })).rejects.toBeInstanceOf(InjectedFault);

    const committed = await f.db.redemption.findUniqueOrThrow({
      where: { userId_idempotencyKey: { userId: f.ids.userA, idempotencyKey: body.idempotencyKey } } });
    expect(committed).toMatchObject({ amount: 25_000, status: "REQUESTED" });
    expect(committed.requestHash).toMatch(/^[0-9a-f]{64}$/);

    const retry = await postRedemption("userA", body);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ idempotent: true, idempotencyKey: body.idempotencyKey,
      redemption: { id: committed.id, amount: 25_000 } });
    expect(retry.body.redemption).not.toHaveProperty("requestHash");
    expect(await f.db.redemption.count({ where: { userId: f.ids.userA } })).toBe(1);
    const reserves = await f.db.rewardLedger.findMany({ where: { userId: f.ids.userA, entryType: "REDEEM" } });
    expect(reserves).toEqual([expect.objectContaining({
      businessKey: `redemption:${committed.id}:reserve`, amount: -25_000, status: "PENDING", referenceId: committed.id })]);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(15_000);
    // The audit row was written once, after commit, and the replay did not add another.
    expect(await f.db.auditLog.count({ where: { action: "REDEMPTION_REQUEST", entityId: committed.id } })).toBe(1);
  });

  it("returns the server-generated key to a legacy client that omits it, and the retry replays", async () => {
    await f.seedBalance(30_000);
    const first = await postRedemption("userA", { amount: 20_000, payoutAccountId: f.ids.payoutAccountA });
    expect(first.status).toBe(201);
    expect(first.body.idempotent).toBe(false);
    expect(first.body.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(first.body.redemption.idempotencyKey).toBe(first.body.idempotencyKey);
    expect(first.body.redemption).not.toHaveProperty("requestHash");

    const retry = await postRedemption("userA", {
      amount: 20_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: first.body.idempotencyKey });
    expect(retry.status).toBe(200);
    expect(retry.body.redemption.id).toBe(first.body.redemption.id);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(10_000);
  });

  it("rejects a payout account disabled while the request waits for the user lock", async () => {
    await f.seedBalance(50_000);
    expect((await f.json("userA", "GET", REDEMPTIONS)).status).toBe(200); // compile the route before holding locks
    const observer = await f.connection();
    const holder = await holdUserLock(f.ids.userA);
    let pending: ReturnType<typeof postRedemption> | undefined;
    try {
      pending = postRedemption("userA", {
        amount: 20_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `disable-${randomUUID()}`,
      });
      const waiterPid = await waitForBlockedBy(observer, { holderPid: holder.pid, timeoutMs: 30_000 });
      expect(waiterPid).not.toBe(holder.pid);
      await observer.$executeRaw`UPDATE "PayoutAccount" SET status = 'DISABLED' WHERE id = ${f.ids.payoutAccountA}`;
      expect(await isStillPending(pending, 250)).toBe(true);
    } finally {
      await holder.release();
    }
    const response = await pending!;
    expect(response.status).toBe(409);
    expect(response.body.error).toBe("Akun pencairan dinonaktifkan");
    expect(await f.db.redemption.count()).toBe(0);
    expect(await f.db.rewardLedger.count({ where: { entryType: "REDEEM" } })).toBe(0);
  });

  it("holds the payout account inside the ReadCommitted decision so a concurrent disable waits for commit", async () => {
    await f.seedBalance(50_000);
    const actor = await actorFor(f.ids.userA);
    const observer = await f.connection();
    const disabler = await f.connection();
    const locked = deferred<{ pid: number; isolation: string; lockTimeout: string }>();
    const release = deferred();
    const request = requestRedemption(actor, {
      amount: 20_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `share-${randomUUID()}`,
    }, {
      afterLock: async (tx) => {
        const [row] = await tx.$queryRaw<{ pid: number; isolation: string; lockTimeout: string }[]>`
          SELECT pg_backend_pid() AS pid, current_setting('transaction_isolation') AS isolation,
                 current_setting('lock_timeout') AS "lockTimeout"`;
        locked.resolve(row);
        await release.promise;
      },
    });
    request.catch((error) => locked.reject(error));
    const holder = await locked.promise;
    expect(holder.isolation).toBe("read committed");
    expect(holder.lockTimeout).toBe("5s");

    const disable = (async () => disabler.$executeRaw`
      UPDATE "PayoutAccount" SET status = 'DISABLED' WHERE id = ${f.ids.payoutAccountA}`)();
    try {
      const waiterPid = await waitForBlockedBy(observer, { holderPid: holder.pid, timeoutMs: 10_000 });
      expect(waiterPid).not.toBe(holder.pid);
      expect(await isStillPending(disable, 250)).toBe(true);
    } finally {
      release.resolve();
    }
    const { redemption, idempotent } = await request;
    expect(idempotent).toBe(false);
    expect(await disable).toBe(1);

    // The request committed while the account was still active; nothing new is accepted afterwards.
    expect(await f.db.redemption.findUniqueOrThrow({ where: { id: redemption.id } })).toMatchObject({ status: "REQUESTED" });
    const after = await postRedemption("userA", {
      amount: 10_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `after-disable-${randomUUID()}` });
    expect(after.status).toBe(409);
    expect(after.body.error).toBe("Akun pencairan dinonaktifkan");
    expect((await getWalletBalance(f.ids.userA)).available).toBe(30_000);
  });

  it("gives up on a stuck user lock with a retryable 503 and writes nothing", async () => {
    await f.seedBalance(30_000);
    expect((await f.json("userA", "GET", REDEMPTIONS)).status).toBe(200);
    const body = { amount: 20_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `stuck-${randomUUID()}` };
    const holder = await holdUserLock(f.ids.userA);
    let stuck: Awaited<ReturnType<typeof postRedemption>>;
    try {
      const started = Date.now();
      stuck = await postRedemption("userA", body);
      expect(Date.now() - started).toBeGreaterThanOrEqual(4_500); // waited for lock_timeout (5s)
    } finally {
      await holder.release();
    }
    expect(stuck.status).toBe(503);
    expect(stuck.body).toEqual({ error: "Sistem sedang sibuk. Silakan coba lagi." });
    expect(await f.db.redemption.count()).toBe(0);

    const retry = await postRedemption("userA", body);
    expect(retry.status).toBe(201);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(10_000);
  });

  it("lockUser answers 404 for a user that does not exist", async () => {
    await expect(f.db.$transaction((tx) => lockUser(tx, `missing-${randomUUID()}`)))
      .rejects.toMatchObject({ status: 404, message: "Pengguna tidak ditemukan" });
  });

  it("rejects fractions, negatives and overflow before touching the wallet", async () => {
    await f.seedBalance(50_000);
    expect((await f.json("userA", "GET", REDEMPTIONS)).status).toBe(200);
    const observer = await f.connection();
    const holder = await holdUserLock(f.ids.userA);
    try {
      const invalid: unknown[] = [10_000.5, -10_000, 0, 2_147_483_648, Number.MAX_SAFE_INTEGER + 2, 1e21, "10000", null];
      const responses = Promise.all(invalid.map((amount, i) => postRedemption("userA", {
        amount, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `invalid-${i}-${randomUUID()}`,
      })));
      // The user row is locked: anything that reached the wallet transaction would still be waiting.
      expect(await isStillPending(responses, 20_000)).toBe(false);
      for (const response of await responses) {
        expect(response.status).toBe(422);
        expect(response.body.error).toBe("Validasi gagal");
        expect(response.body.issues.map((issue: { path: string }) => issue.path)).toContain("amount");
      }
      expect(await backendsBlockedBy(observer, holder.pid)).toEqual([]);
    } finally {
      await holder.release();
    }
    expect(await f.db.redemption.count()).toBe(0);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(50_000);
  });
});
