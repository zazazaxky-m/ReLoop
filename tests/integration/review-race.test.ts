import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getWalletBalance } from "@/lib/ledger";
import { f, type ActorKey } from "../support/audit-fixture";
import { deferred, isStillPending, waitForBlockedBy } from "../support/race-probe";

/**
 * M04 (EX-01): a deposit review decides once. Every decision locks
 * User -> Machine -> DepositSession -> DepositItem, re-reads the item and its
 * earnings, compare-and-sets REVIEW, and writes at most one ledger effect keyed
 * `review:<itemId>:decision:v1` worth target - everything already committed.
 */

type Json = Record<string, any>;

async function call(actor: ActorKey, method: string, path: string, body?: unknown) {
  const response = await f.json(actor, method, path, body);
  return { status: response.status, body: (await response.json().catch(() => null)) as Json };
}

const review = (itemId: string, body: Record<string, unknown>) =>
  call("adminA", "PATCH", `/api/deposit-reviews/${itemId}`, body);
const decisionKey = (itemId: string) => `review:${itemId}:decision:v1`;

/** A held item as the machine path leaves it: REVIEW with (optionally) a 50% EARN/PENDING hold. */
async function heldItem(options: { earn?: { amount: number; status: "PENDING" | "AVAILABLE" } | null } = {}) {
  const link = await f.db.machineWasteType.findFirstOrThrow({ where: { machineId: f.ids.machineA, active: true } });
  // The rate the acceptance point recorded (fixture org rate: Rp100 per item).
  const rate = await f.db.rewardRate.findFirstOrThrow({ where: { organizationId: f.ids.orgA, wasteTypeId: link.wasteTypeId } });
  const session = await f.db.depositSession.create({
    data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "COMPLETED", completedAt: new Date() } });
  const item = await f.db.depositItem.create({ data: {
    sessionId: session.id, wasteTypeId: link.wasteTypeId, quantity: 1, measuredWeightGrams: 25, status: "REVIEW",
    validationReasonCode: "REVERSE_MOTION", complianceMultiplier: 0.5, baseRewardAmount: 100,
    rewardAmount: options.earn?.amount ?? 0, source: "MACHINE", acceptedAt: new Date(),
    acceptanceEventId: `evt-${randomUUID()}`, rewardRateId: rate.id } });
  const earn = options.earn === undefined ? { amount: 50, status: "PENDING" as const } : options.earn;
  if (earn) {
    await f.db.rewardLedger.create({ data: {
      userId: f.ids.userA, organizationId: f.ids.orgA, sessionId: session.id, depositItemId: item.id,
      entryType: "EARN", amount: earn.amount, status: earn.status, reasonCode: "REVERSE_MOTION",
      referenceType: "DepositItem", referenceId: item.id, businessKey: `deposit-item:${item.id}:earn` } });
  }
  return item;
}

const ledgerOf = async (itemId: string) =>
  (await f.db.rewardLedger.findMany({ where: { depositItemId: itemId }, orderBy: { createdAt: "asc" } }))
    .map((row) => ({ entryType: row.entryType, status: row.status, amount: row.amount, businessKey: row.businessKey }));

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

const lockItemRow = (id: string) => (tx: Prisma.TransactionClient) => tx.$queryRaw`
  SELECT id FROM "DepositItem" WHERE id = ${id} FOR UPDATE`;
const lockUserRow = (id: string) => (tx: Prisma.TransactionClient) => tx.$queryRaw`
  SELECT id FROM "User" WHERE id = ${id} FOR NO KEY UPDATE`;

/** True when no other transaction holds a NO KEY UPDATE (or stronger) lock on the row. */
async function rowLockFree(observer: PrismaClient, table: "Machine" | "DepositSession" | "DepositItem", id: string) {
  try {
    await observer.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR NO KEY UPDATE NOWAIT`, id);
    return true;
  } catch (error) {
    if ((error as { meta?: { code?: string } }).meta?.code === "55P03") return false;
    throw error;
  }
}

/**
 * Deterministic ordering: `first` is proven blocked on a row another session
 * holds, then `second` is proven blocked behind `first`, then the row is
 * released, so `first` always decides before `second` re-reads.
 */
async function inOrder<A, B>(hold: (tx: Prisma.TransactionClient) => Promise<unknown>,
  first: () => Promise<A>, second: () => Promise<B>): Promise<[A, B]> {
  const observer = await f.connection();
  const holder = await holdLock(hold);
  let a: Promise<A> | undefined;
  let b: Promise<B> | undefined;
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

/** Compiles the route in `next dev` before a test starts holding locks. */
async function warmUp() {
  expect((await review("missing-item", { action: "reject" })).status).toBe(404);
}

describe("PATCH /api/deposit-reviews/[id] decides once (EX-01)", () => {
  it("two parallel approvals write exactly one adjustment", async () => {
    await warmUp();
    const item = await heldItem();
    const [a, b] = await inOrder(lockItemRow(item.id),
      () => review(item.id, { action: "approve" }), () => review(item.id, { action: "approve" }));
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await ledgerOf(item.id)).toEqual([
      { entryType: "EARN", status: "AVAILABLE", amount: 50, businessKey: `deposit-item:${item.id}:earn` },
      { entryType: "ADJUST", status: "AVAILABLE", amount: 50, businessKey: decisionKey(item.id) },
    ]);
    expect(a.body.idempotent).toBe(false);
    expect(b.body.idempotent).toBe(true);
    expect(await f.db.depositItem.findUniqueOrThrow({ where: { id: item.id } }))
      .toMatchObject({ status: "ACCEPTED", rewardAmount: 100, validationReasonCode: "REVIEW_APPROVED" });
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 100, pending: 0 });
  });

  it("approve racing reject: the first decision wins and the other gets 409", async () => {
    await warmUp();
    const approvedFirst = await heldItem();
    const [approve, reject] = await inOrder(lockItemRow(approvedFirst.id),
      () => review(approvedFirst.id, { action: "approve" }), () => review(approvedFirst.id, { action: "reject" }));
    expect([approve.status, reject.status]).toEqual([200, 409]);
    expect(reject.body.error).toBe("Item sudah ditinjau dengan keputusan lain");
    expect((await f.db.depositItem.findUniqueOrThrow({ where: { id: approvedFirst.id } })).status).toBe("ACCEPTED");
    expect((await ledgerOf(approvedFirst.id)).map((row) => [row.entryType, row.status, row.amount]))
      .toEqual([["EARN", "AVAILABLE", 50], ["ADJUST", "AVAILABLE", 50]]);

    const rejectedFirst = await heldItem();
    const [rejectWins, approveLoses] = await inOrder(lockItemRow(rejectedFirst.id),
      () => review(rejectedFirst.id, { action: "reject" }), () => review(rejectedFirst.id, { action: "approve" }));
    expect([rejectWins.status, approveLoses.status]).toEqual([200, 409]);
    expect((await f.db.depositItem.findUniqueOrThrow({ where: { id: rejectedFirst.id } })))
      .toMatchObject({ status: "REJECTED", rewardAmount: 0, validationReasonCode: "REVIEW_REJECTED" });
    expect((await ledgerOf(rejectedFirst.id)).map((row) => [row.entryType, row.status, row.amount]))
      .toEqual([["EARN", "REJECTED", 50]]);
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 100, pending: 0 });
  });

  it("takes the reward recipient's User lock before any Machine, DepositSession or DepositItem lock", async () => {
    await warmUp();
    const item = await heldItem();
    const observer = await f.connection();
    const holder = await holdLock(lockUserRow(f.ids.userA));
    let pending: Promise<{ status: number; body: Json }> | undefined;
    try {
      pending = review(item.id, { action: "approve" });
      pending.catch(() => {});
      await waitForBlockedBy(observer, { holderPid: holder.pid, timeoutMs: 15_000 });
      expect(await isStillPending(pending, 200)).toBe(true);
      // While it waits for the User row, the review holds none of the later locks.
      expect(await rowLockFree(observer, "Machine", f.ids.machineA)).toBe(true);
      expect(await rowLockFree(observer, "DepositSession", item.sessionId)).toBe(true);
      expect(await rowLockFree(observer, "DepositItem", item.id)).toBe(true);
      expect((await f.db.depositItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("REVIEW");
    } finally {
      await holder.release();
    }
    expect((await pending!).status).toBe(200);
  });

  it("a repeated identical decision is idempotent; a different one is 409", async () => {
    await warmUp();
    const item = await heldItem();
    expect((await review(item.id, { action: "approve", quantity: 1 })).status).toBe(200);
    const same = await review(item.id, { action: "approve" });
    expect(same.status).toBe(200);
    expect(same.body.idempotent).toBe(true);
    for (const body of [{ action: "approve", quantity: 2 }, { action: "reject" }]) {
      const conflict = await review(item.id, body);
      expect(conflict.status).toBe(409);
      expect(conflict.body.error).toBe("Item sudah ditinjau dengan keputusan lain");
    }
    expect((await ledgerOf(item.id)).map((row) => row.amount)).toEqual([50, 50]);
  });

  it("pays the target minus every committed earning and adjustment, keyed once", async () => {
    await warmUp();
    const item = await heldItem();
    // A pre-M04 correction already gave Rp20 for this item.
    await f.db.rewardLedger.create({ data: {
      userId: f.ids.userA, organizationId: f.ids.orgA, depositItemId: item.id, entryType: "ADJUST", amount: 20,
      status: "AVAILABLE", reasonCode: "REVIEW_ADJUSTMENT", referenceType: "DepositItem", referenceId: item.id } });
    const approved = await review(item.id, { action: "approve", quantity: 3 });
    expect(approved.status).toBe(200);
    expect(approved.body.item.rewardAmount).toBe(300);
    const rows = await ledgerOf(item.id);
    expect(rows.at(-1)).toEqual({ entryType: "ADJUST", status: "AVAILABLE", amount: 230, businessKey: decisionKey(item.id) });
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(300);

    // No earning at all yet (unknown-type fallback): the decision is the item's EARN.
    const fresh = await heldItem({ earn: null });
    expect((await review(fresh.id, { action: "approve" })).status).toBe(200);
    expect(await ledgerOf(fresh.id)).toEqual([
      { entryType: "EARN", status: "AVAILABLE", amount: 100, businessKey: decisionKey(fresh.id) }]);
  });

  it("rejecting an earning that is still available reverses it once", async () => {
    await warmUp();
    const item = await heldItem({ earn: { amount: 100, status: "AVAILABLE" } });
    const rejected = await review(item.id, { action: "reject" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.reconciliationCase).toBeNull();
    expect(await ledgerOf(item.id)).toEqual([
      { entryType: "EARN", status: "AVAILABLE", amount: 100, businessKey: `deposit-item:${item.id}:earn` },
      { entryType: "REVERSE", status: "AVAILABLE", amount: -100, businessKey: decisionKey(item.id) },
    ]);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(0);
  });

  it("rejecting an earning already paid out opens a reconciliation case instead of a forced debit", async () => {
    await warmUp();
    const item = await heldItem({ earn: { amount: 100, status: "AVAILABLE" } });
    await f.processingRedemption(10_000);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(0);

    const rejected = await review(item.id, { action: "reject" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.item.status).toBe("REJECTED");
    expect(rejected.body.reconciliationCase).toMatchObject({
      reasonCode: "ANOMALY_ALREADY_PAID_OUT", amount: 100, status: "OPEN" });
    expect((await ledgerOf(item.id)).map((row) => row.entryType)).toEqual(["EARN"]);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(0);
    expect(await f.db.rewardReconciliationCase.findMany()).toEqual([expect.objectContaining({
      businessKey: decisionKey(item.id), userId: f.ids.userA, depositItemId: item.id, amount: 100,
      reasonCode: "ANOMALY_ALREADY_PAID_OUT", status: "OPEN" })]);

    const report = await call("superadmin", "GET", "/api/reports/reconciliation");
    expect(report.status).toBe(200);
    expect(report.body.report.rewardCases).toMatchObject({ open: 1, openAmount: 100 });
  });

  it("a refused reversal still keeps the rejected money from being withdrawn after the reserve is released", async () => {
    await warmUp();
    const item = await heldItem({ earn: { amount: 100, status: "AVAILABLE" } });
    const payout = await f.processingRedemption(20_000);
    const rejected = await review(item.id, { action: "reject" });
    expect(rejected.body.reconciliationCase).toMatchObject({ status: "OPEN", amount: 100 });
    // A second case for the same item (fraud hold) must not double the hold.
    await f.db.rewardReconciliationCase.create({ data: {
      businessKey: `fraud:${item.id}:hold:v1`, userId: f.ids.userA, depositItemId: item.id, amount: 100,
      entryType: "EARN", reasonCode: "ANOMALY_ALREADY_PAID_OUT" } });

    // The payout fails: the reserve comes back, including the rejected 100.
    expect((await call("superadmin", "PATCH", `/api/redemptions/${payout}`, { action: "fail" })).status).toBe(200);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(20_000);

    const request = (amount: number, idempotencyKey: string) => call("userA", "POST", "/api/redemptions", {
      amount, payoutAccountId: f.ids.payoutAccountA, idempotencyKey });
    const all = await request(20_000, "again-all");
    expect(all.status).toBe(422);
    expect(all.body.error).toContain("ditahan");
    expect((await request(19_900, "again-rest")).status).toBe(201);
  });
});
