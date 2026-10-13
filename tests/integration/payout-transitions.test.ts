import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth";
import { decrypt, isEncrypted } from "@/lib/encryption";
import { getWalletBalance } from "@/lib/ledger";
import type { CurrentUser } from "@/lib/rbac";
import type { AppRole } from "@/lib/roles";
import { transitionRedemption } from "@/lib/wallet-service";
import { f, type ActorKey, type FixtureActor } from "../support/audit-fixture";
import { InjectedFault, deferred, failAfterCommit, isStillPending, waitForBlockedBy } from "../support/race-probe";

type Json = Record<string, any>;

async function patch(actor: ActorKey, id: string, body: Record<string, unknown>) {
  const response = await f.json(actor, "PATCH", `/api/redemptions/${id}`, body);
  return { status: response.status, body: (await response.json()) as Json };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

async function uploadProof(actor: FixtureActor, id: string) {
  const form = new FormData();
  form.append("file", new File([JPEG], "bukti.jpg", { type: "image/jpeg" }));
  const response = await fetch(new URL(`/api/redemptions/${id}/proof`, process.env.AUDIT_BASE_URL), {
    method: "POST", body: form, redirect: "manual",
    headers: { accept: "application/json", cookie: `${SESSION_COOKIE}=${await f.sessionCookie(actor)}` },
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as Json | null };
}

function storedProofs(id: string): string[] {
  const dir = path.join(process.env.REDEMPTION_PROOF_STORAGE_DIR ?? "", id);
  return existsSync(dir) ? readdirSync(dir) : [];
}

/** The service's actor, as requireApiUser would build it (in-process calls). */
async function actorFor(id: string): Promise<CurrentUser> {
  const user = await f.db.user.findUniqueOrThrow({ where: { id } });
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role as AppRole,
    organizationId: user.organizationId, organizationName: null, payoutEligible: user.payoutEligible, status: user.status };
}

/** Everything a transition may touch for one request: used to prove "no partial change". */
async function snapshotOf(id: string) {
  const redemption = await f.db.redemption.findUniqueOrThrow({ where: { id } });
  const ledger = await f.db.rewardLedger.findMany({
    where: { OR: [{ referenceType: "Redemption", referenceId: id }, { userId: redemption.userId, entryType: "REDEEM" }] },
    orderBy: { id: "asc" }, select: { id: true, userId: true, status: true, amount: true, referenceId: true },
  });
  const audits = await f.db.auditLog.count({ where: { entityId: id, NOT: { action: "REDEMPTION_REQUEST" } } });
  const notifications = await f.db.notification.count({
    where: { type: "REDEMPTION_STATUS", dataJson: { path: ["redemptionId"], equals: id } } });
  const { updatedAt: _updatedAt, ...row } = redemption;
  return { row, ledger, audits, notifications };
}

async function notificationsFor(id: string, status: string) {
  const rows = await f.db.notification.findMany({
    where: { type: "REDEMPTION_STATUS", dataJson: { path: ["redemptionId"], equals: id } }, select: { dataJson: true } });
  return rows.filter((row) => (row.dataJson as Json | null)?.status === status).length;
}

async function reserveOf(id: string) {
  return f.db.rewardLedger.findFirstOrThrow({ where: { referenceId: id, entryType: "REDEEM" } });
}

/** A request created before M02 existed: no destination snapshot, optional reserve. */
async function legacyRedemption(input: {
  status: "REQUESTED" | "APPROVED" | "PROCESSING" | "SUCCESS"; amount: number;
  reserve?: { amount?: number; userId?: string; status?: "PENDING" | "REDEEMED" | "REVERSED" } | null;
  payoutAccountId?: string;
}) {
  await f.seedBalance(input.amount);
  const redemption = await f.db.redemption.create({
    data: { userId: f.ids.userA, provider: "DANA", payoutAccountId: input.payoutAccountId ?? f.ids.payoutAccountA,
      amount: input.amount, method: "MANUAL_TRANSFER", status: input.status, idempotencyKey: `legacy-${randomUUID()}` },
  });
  if (input.reserve !== null) {
    await f.db.rewardLedger.create({
      data: { userId: input.reserve?.userId ?? f.ids.userA, entryType: "REDEEM", amount: -(input.reserve?.amount ?? input.amount),
        status: input.reserve?.status ?? "PENDING", reasonCode: "REDEMPTION_RESERVE",
        referenceType: "Redemption", referenceId: redemption.id },
    });
  }
  return redemption.id;
}

/** A second database session holding one row lock until released. */
async function holdLock(lock: (tx: Prisma.TransactionClient) => Promise<unknown>) {
  const connection = await f.connection();
  const locked = deferred<number>();
  const release = deferred();
  const done = connection.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await lock(tx);
    locked.resolve(pid);
    await release.promise;
  }, { maxWait: 10_000, timeout: 90_000 });
  done.catch((error) => locked.reject(error));
  const pid = await locked.promise;
  return { pid, async release() { release.resolve(); await done; } };
}

const lockReserveRow = (id: string) => (tx: Prisma.TransactionClient) => tx.$queryRaw`
  SELECT id FROM "RewardLedger" WHERE "referenceType" = 'Redemption' AND "referenceId" = ${id} AND "entryType" = 'REDEEM' FOR UPDATE`;
const lockRedemptionRow = (id: string) => (tx: Prisma.TransactionClient) => tx.$queryRaw`
  SELECT id FROM "Redemption" WHERE id = ${id} FOR UPDATE`;
const lockUserRow = (id: string) => (tx: Prisma.TransactionClient) => tx.$queryRaw`
  SELECT id FROM "User" WHERE id = ${id} FOR NO KEY UPDATE`;

/**
 * Deterministic ordering: `first` is proven blocked on a row held by another
 * session, then `second` is proven blocked behind `first`, then the row is
 * released. `first` therefore always decides before `second` re-reads.
 */
async function inOrder<T>(hold: (tx: Prisma.TransactionClient) => Promise<unknown>,
  first: () => Promise<T>, second: () => Promise<T>): Promise<[T, T]> {
  const observer = await f.connection();
  const holder = await holdLock(hold);
  let a: Promise<T> | undefined;
  let b: Promise<T> | undefined;
  try {
    a = first();
    a.catch(() => {});
    const firstPid = await waitForBlockedBy(observer, { holderPid: holder.pid, timeoutMs: 15_000 });
    b = second();
    b.catch(() => {});
    await waitForBlockedBy(observer, { holderPid: firstPid, timeoutMs: 15_000 });
    expect(await isStillPending(a, 100)).toBe(true);
  } finally {
    await holder.release();
  }
  return [await a!, await b!];
}

/** Compiles the PATCH route in `next dev` before a test starts holding locks. */
async function warmUp() {
  expect((await patch("superadmin", `missing-${randomUUID()}`, { action: "approve" })).status).toBe(404);
}

describe("PATCH /api/redemptions/[id] transitions (real PostgreSQL)", () => {
  it("opposite terminal actions leave payout and ledger consistent", async () => {
    const id = await f.processingRedemption(20_000);
    const results = await Promise.all([
      f.json("superadmin","PATCH",`/api/redemptions/${id}`,{action:"fail"}),
      f.json("superadmin","PATCH",`/api/redemptions/${id}`,{action:"success",providerReference:"TEST-REF"}),
    ]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    const payout = await f.db.redemption.findUniqueOrThrow({where:{id}});
    const reserve = await f.db.rewardLedger.findFirstOrThrow({where:{referenceId:id,entryType:"REDEEM"}});
    expect(reserve.status).toBe(payout.status === "SUCCESS" ? "REDEEMED" : "REVERSED");
  });

  it("fail decided first: the later success is refused and the reserve is released once", async () => {
    const id = await f.processingRedemption(20_000);
    await warmUp();
    const [failed, succeeded] = await inOrder(lockReserveRow(id),
      () => patch("superadmin", id, { action: "fail", note: "Rekening ditolak bank" }),
      () => patch("superadmin", id, { action: "success", providerReference: "LATE-REF" }));
    expect(failed.status).toBe(200);
    expect(succeeded.status).toBe(409);
    expect(succeeded.body.error).toBe("Status pencairan sudah berubah");
    expect(await f.db.redemption.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "FAILED", providerReference: null });
    expect((await reserveOf(id)).status).toBe("REVERSED");
    const balance = await getWalletBalance(f.ids.userA);
    expect(balance).toMatchObject({ available: 20_000, reserved: 0, redeemed: 0 });
  });

  it("success decided first: the later fail is refused and the money stays paid", async () => {
    const id = await f.processingRedemption(20_000);
    await warmUp();
    const [succeeded, failed] = await inOrder(lockReserveRow(id),
      () => patch("superadmin", id, { action: "success", providerReference: "PAID-REF" }),
      () => patch("superadmin", id, { action: "fail", note: "terlambat" }));
    expect(succeeded.status).toBe(200);
    expect(failed.status).toBe(409);
    expect(await f.db.redemption.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "SUCCESS", providerReference: "PAID-REF" });
    expect((await reserveOf(id)).status).toBe("REDEEMED");
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 0, reserved: 0, redeemed: 20_000 });
  });

  it("cancel decided first: a racing approval cannot revive a request whose reserve was released", async () => {
    await f.seedBalance(20_000);
    const created = await f.json("userA", "POST", "/api/redemptions", {
      amount: 20_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `cancel-${randomUUID()}` });
    const id = ((await created.json()) as Json).redemption.id as string;
    await warmUp();
    const [cancelled, approved] = await inOrder(lockReserveRow(id),
      () => patch("userA", id, { action: "cancel" }),
      () => patch("superadmin", id, { action: "approve" }));
    expect(cancelled.status).toBe(200);
    expect(approved.status).toBe(409);
    expect((await f.db.redemption.findUniqueOrThrow({ where: { id } })).status).toBe("REVERSED");
    expect((await reserveOf(id)).status).toBe("REVERSED");
    expect((await getWalletBalance(f.ids.userA)).available).toBe(20_000);
  });

  it("approval decided first: the racing cancel is refused and the reserve stays held", async () => {
    await f.seedBalance(20_000);
    const created = await f.json("userA", "POST", "/api/redemptions", {
      amount: 20_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `approve-${randomUUID()}` });
    const id = ((await created.json()) as Json).redemption.id as string;
    await warmUp();
    const [approved, cancelled] = await inOrder(lockRedemptionRow(id),
      () => patch("superadmin", id, { action: "approve" }),
      () => patch("userA", id, { action: "cancel" }));
    expect(approved.status).toBe(200);
    expect(cancelled.status).toBe(409);
    expect((await f.db.redemption.findUniqueOrThrow({ where: { id } })).status).toBe("APPROVED");
    expect((await reserveOf(id)).status).toBe("PENDING");
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 0, reserved: 20_000 });
  });

  it("repeats the same terminal action idempotently without a second settlement or side effect", async () => {
    const paid = await f.processingRedemption(20_000);
    const first = await patch("superadmin", paid, { action: "success", providerReference: "REF-1" });
    expect(first.status).toBe(200);
    expect(first.body.idempotent).toBe(false);
    expect(first.body.redemption).not.toHaveProperty("requestHash");
    expect(first.body.redemption).not.toHaveProperty("payoutDestinationIdentifier");
    // Only an identical retry is a replay: same reference, or none at all.
    const replays = await Promise.all([
      patch("superadmin", paid, { action: "success", providerReference: "REF-1" }),
      patch("superadmin", paid, { action: "success" }),
    ]);
    for (const replay of replays) {
      expect(replay.status).toBe(200);
      expect(replay.body).toMatchObject({ idempotent: true, redemption: { id: paid, status: "SUCCESS", providerReference: "REF-1" } });
    }

    const failed = await f.processingRedemption(15_000);
    expect((await patch("superadmin", failed, { action: "fail", note: "ditolak" })).body.idempotent).toBe(false);
    const failReplay = await patch("superadmin", failed, { action: "fail", note: "ditolak" });
    expect(failReplay).toMatchObject({ status: 200, body: { idempotent: true, redemption: { status: "FAILED" } } });
    expect(await patch("superadmin", failed, { action: "fail" })).toMatchObject({ status: 200, body: { idempotent: true } });

    for (const [id, ledgerStatus, action, status] of [
      [paid, "REDEEMED", "SUCCESS", "SUCCESS"], [failed, "REVERSED", "FAIL", "FAILED"]] as const) {
      const state = await snapshotOf(id);
      expect(state.ledger.filter((row) => row.referenceId === id).map((row) => row.status)).toEqual([ledgerStatus]);
      expect(await notificationsFor(id, status)).toBe(1);
      expect(await f.db.auditLog.count({ where: { entityId: id, action: `REDEMPTION_${action}` } })).toBe(1);
    }
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ redeemed: 20_000, reserved: 0 });
  });

  it("refuses a replay that carries a different transfer reference or note instead of dropping it", async () => {
    const paid = await f.processingRedemption(20_000);
    expect((await patch("superadmin", paid, { action: "success", providerReference: "REF-1", note: "Sudah ditransfer" })).status).toBe(200);
    const before = await snapshotOf(paid);
    // A second reference may mean a second transfer happened: never a silent 200.
    const otherRef = await patch("superadmin", paid, { action: "success", providerReference: "REF-2" });
    expect(otherRef.status).toBe(409);
    expect(otherRef.body.error).toBe(
      "Pencairan ini sudah dicatat dengan nomor referensi lain. Periksa kemungkinan transfer ganda sebelum melanjutkan.");
    const otherNote = await patch("superadmin", paid, { action: "success", providerReference: "REF-1", note: "Transfer kedua" });
    expect(otherNote.status).toBe(409);
    expect(otherNote.body.error).toBe("Pencairan ini sudah dicatat dengan catatan berbeda. Muat ulang untuk melihat data terbaru.");
    expect(await snapshotOf(paid)).toEqual(before);
    expect((await f.db.redemption.findUniqueOrThrow({ where: { id: paid } })).providerReference).toBe("REF-1");

    const failed = await f.processingRedemption(10_000);
    expect((await patch("superadmin", failed, { action: "fail", note: "Rekening ditutup" })).status).toBe(200);
    const failedBefore = await snapshotOf(failed);
    expect((await patch("superadmin", failed, { action: "fail", note: "Alasan lain" })).status).toBe(409);
    expect((await patch("superadmin", failed, { action: "fail", note: "Rekening ditutup", providerReference: "X" })).status).toBe(409);
    expect(await snapshotOf(failed)).toEqual(failedBefore);
  });

  it("answers the opposite terminal action with 409 instead of a successful no-op", async () => {
    await f.seedBalance(10_000);
    const paid = await f.redeemAndSettle(10_000);
    const before = await snapshotOf(paid);
    const refused = await patch("superadmin", paid, { action: "fail", note: "salah klik" });
    expect(refused.status).toBe(409);
    expect(await snapshotOf(paid)).toEqual(before);

    const failed = await f.processingRedemption(10_000);
    expect((await patch("superadmin", failed, { action: "fail" })).status).toBe(200);
    expect((await patch("superadmin", failed, { action: "success", providerReference: "LATE" })).status).toBe(409);
    expect((await reserveOf(failed)).status).toBe("REVERSED");
  });

  it("does not treat a status that already diverged from the ledger as an idempotent replay", async () => {
    const id = await f.processingRedemption(20_000);
    await f.db.$executeRaw`UPDATE "Redemption" SET status = 'SUCCESS' WHERE id = ${id}`; // legacy divergence
    const before = await snapshotOf(id);
    const replay = await patch("superadmin", id, { action: "success", providerReference: "REF" });
    expect(replay.status).toBe(409);
    expect(replay.body.error).toMatch(/tidak sesuai/);
    expect(await snapshotOf(id)).toEqual(before);
  });

  it("refuses with 409 and changes nothing when the reserve is missing", async () => {
    const id = await legacyRedemption({ status: "PROCESSING", amount: 20_000, reserve: null });
    const before = await snapshotOf(id);
    for (const body of [{ action: "success", providerReference: "REF" }, { action: "fail", note: "x" }]) {
      const res = await patch("superadmin", id, body);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/tidak ditemukan/);
      expect(await snapshotOf(id)).toEqual(before);
    }
    const requested = await legacyRedemption({ status: "REQUESTED", amount: 10_000, reserve: null });
    const requestedBefore = await snapshotOf(requested);
    expect((await patch("superadmin", requested, { action: "approve" })).status).toBe(409);
    expect((await patch("userA", requested, { action: "cancel" })).status).toBe(409);
    expect(await snapshotOf(requested)).toEqual(requestedBefore);
  });

  it("refuses with 409 and changes nothing when the reserve amount differs from the request", async () => {
    const id = await legacyRedemption({ status: "PROCESSING", amount: 20_000, reserve: { amount: 15_000 } });
    const before = await snapshotOf(id);
    for (const body of [{ action: "fail", note: "x" }, { action: "success", providerReference: "REF" }]) {
      const res = await patch("superadmin", id, body);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/tidak sesuai/);
      expect(await snapshotOf(id)).toEqual(before);
    }
  });

  it("refuses with 409 when the request no longer belongs to the reserve's owner", async () => {
    const id = await f.processingRedemption(20_000);
    await f.db.$executeRaw`UPDATE "Redemption" SET "userId" = ${f.ids.userB} WHERE id = ${id}`;
    const before = await snapshotOf(id);
    const res = await patch("superadmin", id, { action: "success", providerReference: "REF" });
    expect(res.status).toBe(409);
    expect(await snapshotOf(id)).toEqual(before);
    expect((await reserveOf(id)).status).toBe("PENDING");
  });

  it("re-reads ownership after the user lock and refuses a request that changed owner while waiting", async () => {
    const id = await f.processingRedemption(20_000);
    await warmUp();
    const observer = await f.connection();
    const holder = await holdLock(lockUserRow(f.ids.userA));
    let pending: ReturnType<typeof patch> | undefined;
    try {
      pending = patch("superadmin", id, { action: "fail", note: "x" });
      await waitForBlockedBy(observer, { holderPid: holder.pid, timeoutMs: 15_000 });
      await observer.$executeRaw`UPDATE "Redemption" SET "userId" = ${f.ids.userB} WHERE id = ${id}`;
    } finally {
      await holder.release();
    }
    const res = await pending!;
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("Data pemilik pencairan berubah. Muat ulang lalu coba lagi.");
    expect(await f.db.redemption.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "PROCESSING", userId: f.ids.userB });
    expect((await reserveOf(id)).status).toBe("PENDING");
  });

  it("keeps a committed settlement when the notification and audit fail after commit, and the retry is idempotent", async () => {
    const id = await f.processingRedemption(20_000);
    const admin = await f.connection();
    await admin.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION m02_fail_side_effect() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'm02 injected side-effect failure'; END $$ LANGUAGE plpgsql`);
    await admin.$executeRawUnsafe(`CREATE TRIGGER m02_fail_notification BEFORE INSERT ON "Notification"
      FOR EACH ROW EXECUTE FUNCTION m02_fail_side_effect()`);
    await admin.$executeRawUnsafe(`CREATE TRIGGER m02_fail_audit BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION m02_fail_side_effect()`);
    let first: Awaited<ReturnType<typeof patch>>;
    try {
      first = await patch("superadmin", id, { action: "success", providerReference: "REF-NOTIFY" });
    } finally {
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS m02_fail_notification ON "Notification"`);
      await admin.$executeRawUnsafe(`DROP TRIGGER IF EXISTS m02_fail_audit ON "AuditLog"`);
      await admin.$executeRawUnsafe(`DROP FUNCTION IF EXISTS m02_fail_side_effect()`);
    }
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ idempotent: false, redemption: { status: "SUCCESS" } });

    const retry = await patch("superadmin", id, { action: "success", providerReference: "REF-NOTIFY" });
    expect(retry).toMatchObject({ status: 200, body: { idempotent: true } });
    const state = await snapshotOf(id);
    expect(state.ledger.map((row) => row.status)).toEqual(["REDEEMED"]);
    expect(await notificationsFor(id, "SUCCESS")).toBe(0); // the lost notification is not replayed by an idempotent retry
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ redeemed: 20_000, reserved: 0, available: 0 });
  });

  it("replays a settlement whose response was lost after commit (fault injected in-process)", async () => {
    const id = await f.processingRedemption(20_000);
    const admin = await actorFor(f.ids.superadmin);
    const seen = deferred<{ isolation: string; lockTimeout: string }>();
    await expect(transitionRedemption(admin, id, { action: "success", providerReference: "LOST-REF" }, {
      afterLock: async (tx) => {
        const [row] = await tx.$queryRaw<{ isolation: string; lockTimeout: string }[]>`
          SELECT current_setting('transaction_isolation') AS isolation, current_setting('lock_timeout') AS "lockTimeout"`;
        seen.resolve(row);
      },
      afterCommit: failAfterCommit(),
    })).rejects.toBeInstanceOf(InjectedFault);
    expect(await seen.promise).toEqual({ isolation: "read committed", lockTimeout: "5s" });

    expect((await f.db.redemption.findUniqueOrThrow({ where: { id } })).status).toBe("SUCCESS");
    const retry = await patch("superadmin", id, { action: "success", providerReference: "LOST-REF" });
    expect(retry).toMatchObject({ status: 200, body: { idempotent: true, redemption: { id, status: "SUCCESS" } } });
    const state = await snapshotOf(id);
    expect(state.ledger.map((row) => row.status)).toEqual(["REDEEMED"]);
    expect(await notificationsFor(id, "SUCCESS")).toBe(1);
    expect(await f.db.auditLog.count({ where: { entityId: id, action: "REDEMPTION_SUCCESS" } })).toBe(1);
  });

  it("keeps the reserve and asks for reconciliation when the operator is unsure the transfer went out", async () => {
    const id = await f.processingRedemption(20_000);
    expect((await patch("superadmin", id, { action: "flag_reconciliation" })).status).toBe(422); // note required

    const flagged = await patch("superadmin", id, { action: "flag_reconciliation", note: "Bank belum mengonfirmasi transfer" });
    expect(flagged.status).toBe(200);
    expect(flagged.body).toMatchObject({ idempotent: false,
      redemption: { status: "PROCESSING", reconciliationRequired: true, reconciliationNote: "Bank belum mengonfirmasi transfer" } });
    expect((await reserveOf(id)).status).toBe("PENDING");
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 0, reserved: 20_000 });
    const sameFlag = await patch("superadmin", id, { action: "flag_reconciliation", note: "Bank belum mengonfirmasi transfer" });
    expect(sameFlag).toMatchObject({ status: 200, body: { idempotent: true } });
    const otherFlag = await patch("superadmin", id, { action: "flag_reconciliation", note: "Catatan lain" });
    expect(otherFlag.status).toBe(409);
    expect(otherFlag.body.error).toBe(
      "Pengajuan ini sudah ditandai untuk rekonsiliasi dengan catatan lain. Muat ulang untuk melihat catatan yang tersimpan.");
    expect((await f.db.redemption.findUniqueOrThrow({ where: { id } })).reconciliationNote).toBe("Bank belum mengonfirmasi transfer");
    expect(await f.db.auditLog.count({ where: { entityId: id, action: "REDEMPTION_FLAG_RECONCILIATION" } })).toBe(1);

    // Releasing the money of a flagged request needs the reconciliation outcome written down.
    const bare = await patch("superadmin", id, { action: "fail" });
    expect(bare.status).toBe(422);
    expect((await reserveOf(id)).status).toBe("PENDING");
    const resolved = await patch("superadmin", id, { action: "fail", note: "Mutasi bank: dana tidak terkirim" });
    expect(resolved.status).toBe(200);
    expect(await f.db.redemption.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "FAILED", reconciliationRequired: false });
    expect((await reserveOf(id)).status).toBe("REVERSED");

    const approved = await legacyRedemption({ status: "APPROVED", amount: 10_000 });
    expect((await patch("superadmin", approved, { action: "flag_reconciliation", note: "x" })).status).toBe(409);
  });
});

describe("payout destination snapshot", () => {
  it("captures the destination encrypted at request time and keeps using it after the account changes", async () => {
    await f.seedBalance(20_000);
    const account = await f.db.payoutAccount.findUniqueOrThrow({ where: { id: f.ids.payoutAccountA } });
    const created = await f.json("userA", "POST", "/api/redemptions", {
      amount: 20_000, payoutAccountId: account.id, idempotencyKey: `snap-${randomUUID()}` });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as Json;
    expect(createdBody.redemption).not.toHaveProperty("payoutDestinationIdentifier");
    const id = createdBody.redemption.id as string;

    const stored = await f.db.redemption.findUniqueOrThrow({ where: { id } });
    expect(stored.payoutDestinationSource).toBe("REQUEST_SNAPSHOT");
    expect(stored.payoutDestinationProvider).toBe("DANA");
    expect(isEncrypted(stored.payoutDestinationIdentifier!)).toBe(true);
    expect(decrypt(stored.payoutDestinationIdentifier!)).toBe(account.accountIdentifier);
    expect(decrypt(stored.payoutDestinationName!)).toBe(account.accountName);

    expect((await f.json("userA", "PATCH", `/api/payout-accounts/${account.id}`, { accountName: "Nama Lain" })).status).toBe(200);
    expect((await f.json("userA", "DELETE", `/api/payout-accounts/${account.id}`)).status).toBe(200);
    for (const body of [{ action: "approve" }, { action: "process" }]) {
      expect((await patch("superadmin", id, body)).status).toBe(200);
    }
    const queue = (await (await f.json("superadmin", "GET", "/api/redemptions?queue=1")).json()) as Json;
    const row = queue.redemptions.find((r: Json) => r.id === id);
    expect(row.payoutDestination).toEqual({ source: "REQUEST_SNAPSHOT", provider: "DANA", erased: false,
      accountIdentifier: account.accountIdentifier, accountName: account.accountName, capturedAt: expect.any(String) });
    expect(row).not.toHaveProperty("payoutDestinationIdentifier");
    expect(row).not.toHaveProperty("payoutDestinationName");

    expect((await patch("superadmin", id, { action: "success", providerReference: "SNAP-REF" })).status).toBe(200);
    const settled = await f.db.redemption.findUniqueOrThrow({ where: { id } });
    expect(settled.payoutDestinationIdentifier).toBe(stored.payoutDestinationIdentifier);
    expect(decrypt(settled.payoutDestinationName!)).toBe(account.accountName);
  });

  it("records a legacy request's destination as a fallback from the current account at processing time", async () => {
    const account = await f.db.payoutAccount.findUniqueOrThrow({ where: { id: f.ids.payoutAccountA } });
    const id = await legacyRedemption({ status: "APPROVED", amount: 15_000 });
    expect((await patch("superadmin", id, { action: "process" })).status).toBe(200);
    const processed = await f.db.redemption.findUniqueOrThrow({ where: { id } });
    expect(processed.payoutDestinationSource).toBe("LEGACY_ACCOUNT_FALLBACK");
    expect(decrypt(processed.payoutDestinationIdentifier!)).toBe(account.accountIdentifier);
    const audit = await f.db.auditLog.findFirstOrThrow({ where: { entityId: id, action: "REDEMPTION_PROCESS" } });
    expect(audit.metadataJson).toMatchObject({ destinationSource: "LEGACY_ACCOUNT_FALLBACK" });

    await f.json("userA", "PATCH", `/api/payout-accounts/${account.id}`, { accountName: "Nama Sesudah Proses" });
    expect((await patch("superadmin", id, { action: "success", providerReference: "LEGACY-REF" })).status).toBe(200);
    expect(decrypt((await f.db.redemption.findUniqueOrThrow({ where: { id } })).payoutDestinationName!)).toBe(account.accountName);
  });

  it("does not invent a destination for a legacy request whose account no longer exists", async () => {
    const id = await legacyRedemption({ status: "APPROVED", amount: 15_000, payoutAccountId: `gone-${randomUUID()}` });
    const before = await snapshotOf(id);
    const res = await patch("superadmin", id, { action: "process" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Tujuan pencairan tidak tersedia/);
    expect(await snapshotOf(id)).toEqual(before);
    expect((await patch("superadmin", id, { action: "fail", note: "akun hilang" })).status).toBe(200);
    expect((await reserveOf(id)).status).toBe("REVERSED");
  });
});

describe("GDPR erasure of the payout destination snapshot", () => {
  it("erases the destination of finished requests, keeps it for unsettled ones, and logs both", async () => {
    await f.seedBalance(80_000);
    const paid = await f.redeemAndSettle(20_000);
    const failed = await f.processingRedemption(15_000);
    expect((await patch("superadmin", failed, { action: "fail", note: "ditolak bank" })).status).toBe(200);
    const created = await f.json("userA", "POST", "/api/redemptions", {
      amount: 10_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `erase-cancel-${randomUUID()}` });
    const cancelled = ((await created.json()) as Json).redemption.id as string;
    expect((await patch("userA", cancelled, { action: "cancel" })).status).toBe(200);
    const open = await f.processingRedemption(12_000);
    const account = await f.db.payoutAccount.findUniqueOrThrow({ where: { id: f.ids.payoutAccountA } });

    const erased = await f.json("userA", "DELETE", "/api/user/data");
    expect(erased.status).toBe(200);

    for (const id of [paid, failed, cancelled]) {
      expect(await f.db.redemption.findUniqueOrThrow({ where: { id } })).toMatchObject({
        payoutDestinationIdentifier: null, payoutDestinationName: null,
        payoutDestinationSource: "REQUEST_SNAPSHOT", payoutDestinationProvider: "DANA" });
    }
    // An unsettled request still needs its destination to be paid or reconciled.
    const kept = await f.db.redemption.findUniqueOrThrow({ where: { id: open } });
    expect(decrypt(kept.payoutDestinationIdentifier!)).toBe(account.accountIdentifier);

    const audit = await f.db.auditLog.findFirstOrThrow({ where: { action: "DATA_ERASURE", entityId: f.ids.userA } });
    expect(audit.metadataJson).toMatchObject({
      steps: expect.arrayContaining(["payout_accounts_deleted", "redemption_destinations_erased",
        "redemption_destinations_retained_for_settlement"]),
      redemptionDestinations: { erased: 3, retainedForSettlement: 1 },
    });

    const queue = (await (await f.json("superadmin", "GET", "/api/redemptions")).json()) as Json;
    const byId = new Map<string, Json>(queue.redemptions.map((r: Json) => [r.id, r]));
    for (const id of [paid, failed, cancelled]) {
      expect(byId.get(id)!.payoutDestination).toEqual({ source: "REQUEST_SNAPSHOT", provider: "DANA", erased: true,
        accountIdentifier: null, accountName: null, capturedAt: expect.any(String) });
    }
    expect(byId.get(open)!.payoutDestination).toMatchObject({ erased: false, accountIdentifier: account.accountIdentifier });
  });
});

describe("POST /api/redemptions/[id]/proof", () => {
  it("cannot attach a proof to another account's or organization's request", async () => {
    const id = await f.processingRedemption(20_000);
    for (const actor of ["userA", "userB", "adminA", "adminB", "collectorA"] as const) {
      const res = await uploadProof(actor, id);
      expect(res.status).toBe(403);
    }
    expect((await f.db.redemption.findUniqueOrThrow({ where: { id } })).manualTransferProofUrl).toBeNull();
    expect(storedProofs(id)).toEqual([]);

    // A proof stored for one request never satisfies another request's success check.
    const other = await f.processingRedemption(10_000);
    expect((await uploadProof("superadmin", other)).status).toBe(201);
    const otherProof = (await f.db.redemption.findUniqueOrThrow({ where: { id: other } })).manualTransferProofUrl!;
    expect(otherProof.startsWith(`${other}/`)).toBe(true);
    await f.db.$executeRaw`UPDATE "Redemption" SET "manualTransferProofUrl" = ${otherProof} WHERE id = ${id}`;
    const res = await patch("superadmin", id, { action: "success" });
    expect(res.status).toBe(422);
    expect((await reserveOf(id)).status).toBe("PENDING");
  });

  it("refuses a proof for a request that changed owner while the upload waited for the lock", async () => {
    const id = await f.processingRedemption(20_000);
    expect((await uploadProof("userB", id)).status).toBe(403); // compile the route before holding locks
    const observer = await f.connection();
    const holder = await holdLock(lockUserRow(f.ids.userA));
    let pending: ReturnType<typeof uploadProof> | undefined;
    try {
      pending = uploadProof("superadmin", id);
      await waitForBlockedBy(observer, { holderPid: holder.pid, timeoutMs: 15_000 });
      await observer.$executeRaw`UPDATE "Redemption" SET "userId" = ${f.ids.userB} WHERE id = ${id}`;
    } finally {
      await holder.release();
    }
    const res = await pending!;
    expect(res.status).toBe(409);
    expect((await f.db.redemption.findUniqueOrThrow({ where: { id } })).manualTransferProofUrl).toBeNull();
    expect(storedProofs(id)).toEqual([]);
    expect(await f.db.auditLog.count({ where: { entityId: id, action: "REDEMPTION_PROOF_UPLOAD" } })).toBe(0);
  });

  it("attaches a proof that then satisfies success for the same request", async () => {
    const id = await f.processingRedemption(20_000);
    expect((await uploadProof("superadmin", id)).status).toBe(201);
    expect(storedProofs(id)).toHaveLength(1);
    const res = await patch("superadmin", id, { action: "success" });
    expect(res.status).toBe(200);
    expect((await reserveOf(id)).status).toBe("REDEEMED");
    expect((await uploadProof("superadmin", id)).status).toBe(409); // terminal: no new proof
  });
});
