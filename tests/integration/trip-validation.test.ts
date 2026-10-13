import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { collectWalletInventory } from "@/scripts/reconcile-wallet-history";
import { f, type ActorKey } from "../support/audit-fixture";
import { deferred, isStillPending, waitForBlockedBy } from "../support/race-probe";

type Json = Record<string, any>;

async function call(actor: ActorKey, method: string, path: string, body?: unknown) {
  const response = await f.json(actor, method, path, body);
  return { status: response.status, body: (await response.json().catch(() => null)) as Json };
}

/** Bulk gate check-out (POST /api/manual-validations). */
function checkout(actor: ActorKey, tripId: string, extra: Record<string, unknown> = {}) {
  return call(actor, "POST", "/api/manual-validations", {
    tripId, validationStage: "CHECK_OUT", appCompleted: true, ...extra });
}

/** Progressive per-bag scan (PATCH /api/trash-bags). */
function scan(actor: ActorKey, bagId: string, status: string, extra: Record<string, unknown> = {}) {
  return call(actor, "PATCH", "/api/trash-bags", { id: bagId, status, appCompleted: true, ...extra });
}

const good = (...ids: string[]) => ids.map((id) => ({ id, status: "GOOD" }));
const returnKey = (tripId: string) => `trip:${tripId}:return`;

/** Everything a check-out may change for one trip. */
async function tripState(tripId: string) {
  const trip = await f.db.trip.findUniqueOrThrow({ where: { id: tripId } });
  const bags = await f.db.trashBagAssignment.findMany({
    where: { tripId }, orderBy: { id: "asc" }, select: { id: true, status: true, returnedAt: true } });
  const validations = await f.db.manualValidation.findMany({ where: { tripId }, orderBy: { createdAt: "asc" } });
  const earnings = await f.db.rewardLedger.findMany({
    where: { OR: [{ referenceId: tripId }, { businessKey: returnKey(tripId) },
      { referenceType: "ManualValidation", referenceId: { in: validations.map((v) => v.id) } }] },
    orderBy: { createdAt: "asc" } });
  return {
    status: trip.status, complianceScore: trip.complianceScore, complianceStatus: trip.complianceStatus,
    checkOutAt: trip.checkOutAt, bags,
    checkouts: validations.filter((v) => v.validationStage === "CHECK_OUT").length,
    validations: validations.length, earnings,
  };
}

async function readOnlyInventory() {
  return f.db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return collectWalletInventory(tx);
  }, { isolationLevel: "RepeatableRead" });
}

async function setRewardMode(tripId: string, rewardMode: "MONEY_REWARD" | "COMPLIANCE_ONLY") {
  const { campaignId } = await f.db.trip.findUniqueOrThrow({ where: { id: tripId } });
  await f.db.campaign.update({ where: { id: campaignId }, data: { rewardMode } });
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

const lockTripRow = (id: string) => (tx: Prisma.TransactionClient) => tx.$queryRaw`
  SELECT id FROM "Trip" WHERE id = ${id} FOR UPDATE`;
const lockUserRow = (id: string) => (tx: Prisma.TransactionClient) => tx.$queryRaw`
  SELECT id FROM "User" WHERE id = ${id} FOR NO KEY UPDATE`;

/**
 * Deterministic ordering: `first` is proven blocked on a row held by another
 * session, then `second` is proven blocked behind `first`, then the row is
 * released. `first` therefore always decides before `second` re-reads.
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

/** Compiles the routes in `next dev` before a test starts holding locks. */
async function warmUp() {
  expect((await scan("adminA", "missing-bag", "GOOD")).status).toBe(404);
  expect((await checkout("adminA", "missing-trip")).status).toBe(404);
  expect((await call("adminA", "POST", "/api/trash-bags", { tripId: "missing-trip", bagCount: 1 })).status).toBe(404);
  expect((await call("adminA", "PATCH", "/api/trips/missing-trip", { status: "CANCELLED" })).status).toBe(404);
}

describe("POST /api/manual-validations check-out validates owned bags (LOG-03)", () => {
  it("rejects duplicate and foreign bag IDs without changing any bag", async () => {
    const own = await f.trip({bagCount:1});
    const foreign = await f.trip({bagCount:1,organization:"B"});
    for (const ids of [[own.bagIds[0],own.bagIds[0]],[foreign.bagIds[0]]]) {
      const res=await f.json("adminA","POST","/api/manual-validations",{
        tripId:own.id,validationStage:"CHECK_OUT",appCompleted:true,
        bags:ids.map(id=>({id,status:"GOOD"})),
      });
      expect(res.status).toBe(422);
    }
    expect(await f.db.rewardLedger.count({where:{referenceId:own.id}})).toBe(0);
  });

  it("refuses duplicate, foreign and unknown IDs atomically: no bag, trip, validation or ledger change", async () => {
    const foreign = await f.trip({ bagCount: 1, organization: "B" });
    const otherOwnTrip = await f.trip({ bagCount: 1 });
    const cases: Array<[string, (bagIds: string[]) => Array<{ id: string; status: string }>, string]> = [
      ["duplicate", (ids) => good(ids[0], ids[1], ids[0]), "Kantong dipindai lebih dari sekali"],
      ["foreign organization", (ids) => good(ids[0], ids[1], foreign.bagIds[0]), "Kantong tidak sesuai trip"],
      ["another trip of the same organization", (ids) => good(ids[0], otherOwnTrip.bagIds[0]), "Kantong tidak sesuai trip"],
      ["unknown", (ids) => good(ids[0], "bag-yang-tidak-ada"), "Kantong tidak sesuai trip"],
    ];
    for (const [label, bags, message] of cases) {
      const own = await f.trip({ bagCount: 2 });
      const before = await tripState(own.id);
      const res = await checkout("adminA", own.id, { bags: bags(own.bagIds) });
      expect(res.status, label).toBe(422);
      expect(res.body.error, label).toBe(message);
      expect(await tripState(own.id), label).toEqual(before);
      expect(before).toMatchObject({ status: "ACTIVE", checkouts: 0, earnings: [] });
      expect(before.bags.every((bag) => bag.status === null), label).toBe(true);
    }
    for (const other of [foreign, otherOwnTrip]) {
      expect((await tripState(other.id)).bags.map((bag) => bag.status)).toEqual([null]);
    }
    expect(await f.db.rewardLedger.count()).toBe(0);
  });

  it("pays only from verified owned rows and marks unlisted bags not returned", async () => {
    const trip = await f.trip({ bagCount: 3 });
    const [b0, b1, b2] = trip.bagIds;
    const res = await checkout("adminA", trip.id, { bags: [{ id: b0, status: "GOOD" }, { id: b1, status: "PARTIAL" }] });
    expect(res.status).toBe(201);
    // app 30 + some returned 20 + PARTIAL 20 = 70; 2 rewardable bags x Rp2.000 x 70%.
    expect(res.body.compliance).toEqual({ score: 70, status: "NEEDS_REVIEW" });
    expect(res.body.rewardAmount).toBe(2_800);
    expect(res.body.validation).toMatchObject({ returnedBagCount: 2, conditionStatus: "PARTIAL", complianceScore: 70 });
    const state = await tripState(trip.id);
    expect(state.status).toBe("COMPLETED");
    expect(Object.fromEntries(state.bags.map((bag) => [bag.id, bag.status]))).toEqual({
      [b0]: "GOOD", [b1]: "PARTIAL", [b2]: "NOT_RETURNED" });
    expect(state.bags.find((bag) => bag.id === b2)!.returnedAt).toBeNull();
    expect(state.earnings).toEqual([expect.objectContaining({
      userId: f.ids.userA, entryType: "EARN", status: "AVAILABLE", amount: 2_800,
      reasonCode: "TRASH_BAG_RETURN", referenceType: "Trip", referenceId: trip.id, businessKey: returnKey(trip.id) })]);
  });

  it("rejects returnedBagCount 500 on a one-bag trip and never pays a reward trip from a count", async () => {
    const trip = await f.trip({ bagCount: 1 });
    const over = await checkout("adminA", trip.id, { returnedBagCount: 500, conditionStatus: "GOOD" });
    expect(over.status).toBe(422);
    expect(over.body.error).toBe("Jumlah kantong kembali melebihi jumlah kantong yang diterbitkan untuk trip ini");

    const countOnly = await checkout("adminA", trip.id, { returnedBagCount: 1, conditionStatus: "GOOD" });
    expect(countOnly.status).toBe(422);
    expect(countOnly.body.error).toBe(
      "Check-out trip berhadiah wajib menyertakan ID setiap kantong. Muat ulang daftar kantong lalu ulangi.");
    const emptyList = await checkout("adminA", trip.id, { bags: [], returnedBagCount: 1, conditionStatus: "GOOD" });
    expect(emptyList.status).toBe(422);
    expect(await tripState(trip.id)).toMatchObject({ status: "ACTIVE", checkouts: 0, earnings: [], bags: [{ status: null }] });

    const withIds = await checkout("adminA", trip.id, { bags: good(trip.bagIds[0]) });
    expect(withIds.status).toBe(201);
    expect(withIds.body.rewardAmount).toBe(2_000);
    expect((await tripState(trip.id)).earnings.map((row) => row.amount)).toEqual([2_000]);
  });

  it("gives no reward to a trip with zero assigned bags", async () => {
    const trip = await f.trip({ bagCount: 0 });
    const claimed = await checkout("adminA", trip.id, { returnedBagCount: 3, conditionStatus: "GOOD" });
    expect(claimed.status).toBe(422);
    expect(await tripState(trip.id)).toMatchObject({ status: "ACTIVE", checkouts: 0, earnings: [] });

    const closed = await checkout("adminA", trip.id, { returnedBagCount: 0, conditionStatus: "GOOD" });
    expect(closed.status).toBe(201);
    expect(closed.body.rewardAmount).toBe(0);
    expect(await tripState(trip.id)).toMatchObject({ status: "COMPLETED", checkouts: 1, earnings: [] });
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA } })).toBe(0);
  });

  it("caps a COMPLIANCE_ONLY count-only check-out at the issued bag count", async () => {
    const trip = await f.trip({ bagCount: 2 });
    await setRewardMode(trip.id, "COMPLIANCE_ONLY");
    const over = await checkout("adminA", trip.id, { returnedBagCount: 3, conditionStatus: "GOOD" });
    expect(over.status).toBe(422);
    expect(await tripState(trip.id)).toMatchObject({ status: "ACTIVE", checkouts: 0 });

    const res = await checkout("adminA", trip.id, { returnedBagCount: 2, conditionStatus: "GOOD" });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ rewardAmount: 0, compliance: { score: 100, status: "COMPLIANT" } });
    expect(res.body.validation).toMatchObject({ returnedBagCount: 2, conditionStatus: "GOOD" });
    const state = await tripState(trip.id);
    expect(state).toMatchObject({ status: "COMPLETED", complianceScore: 100, checkouts: 1, earnings: [] });
    // A count never stamps a status on a bag nobody scanned.
    expect(state.bags.map((bag) => bag.status)).toEqual([null, null]);
  });

  it("honours a legacy trip reward without a business key instead of paying again", async () => {
    for (const legacyReference of ["Trip", "ManualValidation"] as const) {
      const trip = await f.trip({ bagCount: 1 });
      const { campaignId } = await f.db.trip.findUniqueOrThrow({ where: { id: trip.id } });
      // The earliest code referenced the paying validation; later code the trip, both without a key.
      const referenceId = legacyReference === "Trip" ? trip.id : (await f.db.manualValidation.create({ data: {
        tripId: trip.id, validationStage: "CHECK_IN", gateType: "ENTRY", appCompleted: true } })).id;
      await f.db.rewardLedger.create({ data: { userId: f.ids.userA, campaignId, entryType: "EARN", amount: 2_000,
        status: "AVAILABLE", reasonCode: "TRASH_BAG_RETURN", referenceType: legacyReference, referenceId } });

      const res = await checkout("adminA", trip.id, { bags: good(trip.bagIds[0]) });
      expect(res.status, legacyReference).toBe(201);
      expect(res.body.rewardAmount, legacyReference).toBe(0);
      const state = await tripState(trip.id);
      expect(state.status).toBe("COMPLETED");
      expect(state.earnings, legacyReference).toHaveLength(1);
      expect(state.earnings[0]).toMatchObject({ referenceType: legacyReference, businessKey: null });
    }
  });
});

describe("trip return earning is recognised only by its reason (C1)", () => {
  it("a non-return EARN referencing the trip neither blocks nor collides with the recipient's return earning", async () => {
    const trip = await f.trip({ bagCount: 1 });
    const { campaignId } = await f.db.trip.findUniqueOrThrow({ where: { id: trip.id } });
    // Seed-style bonus for a travel-agent user (prisma/seed.ts writes these with referenceType "Trip").
    await f.db.rewardLedger.create({ data: { userId: f.ids.userB, campaignId, entryType: "EARN", amount: 7_800,
      status: "AVAILABLE", reasonCode: "TOURISM_COMPLIANCE_BONUS", referenceType: "Trip", referenceId: trip.id } });

    const res = await checkout("adminA", trip.id, { bags: good(trip.bagIds[0]) });
    expect(res.status).toBe(201);
    expect(res.body.rewardAmount).toBe(2_000);
    const rows = await f.db.rewardLedger.findMany({ where: { referenceType: "Trip", referenceId: trip.id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => [row.userId, row.reasonCode, row.amount, row.businessKey])).toEqual([
      [f.ids.userB, "TOURISM_COMPLIANCE_BONUS", 7_800, null],
      [f.ids.userA, "TRASH_BAG_RETURN", 2_000, returnKey(trip.id)],
    ]);
  });
});

describe("trip aggregate is serialized under User -> Trip -> bag locks (EX-02)", () => {
  it("last two bags scanned in parallel: all reviewed, trip COMPLETED, exactly one earning", async () => {
    const trip = await f.trip({ bagCount: 2 });
    await warmUp();
    const [first, second] = await inOrder(lockTripRow(trip.id),
      () => scan("adminA", trip.bagIds[0], "GOOD"),
      () => scan("adminA", trip.bagIds[1], "GOOD"));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toMatchObject({ rewardAmount: 0, validation: null });
    expect(second.body.rewardAmount).toBe(4_000);
    expect(second.body.validation).toMatchObject({ validationStage: "CHECK_OUT", returnedBagCount: 2, complianceScore: 100 });

    const state = await tripState(trip.id);
    expect(state.bags.map((bag) => bag.status)).toEqual(["GOOD", "GOOD"]);
    expect(state).toMatchObject({ status: "COMPLETED", complianceScore: 100, complianceStatus: "COMPLIANT", checkouts: 1 });
    expect(state.checkOutAt).not.toBeNull();
    expect(state.earnings).toEqual([expect.objectContaining({ amount: 4_000, businessKey: returnKey(trip.id), status: "AVAILABLE" })]);
  });

  it("progressive scan decided before bulk check-out: one outcome, the late check-out is refused", async () => {
    const trip = await f.trip({ bagCount: 2 });
    expect((await scan("adminA", trip.bagIds[1], "GOOD")).status).toBe(200);
    await warmUp();
    const [scanned, bulk] = await inOrder(lockTripRow(trip.id),
      () => scan("adminA", trip.bagIds[0], "GOOD"),
      () => checkout("adminA", trip.id, { bags: good(...trip.bagIds) }));
    expect(scanned.status).toBe(200);
    expect(scanned.body.rewardAmount).toBe(4_000);
    expect(bulk.status).toBe(422);
    expect(bulk.body.error).toBe("Trip sudah selesai; validasi gerbang tidak dapat diulang");
    const state = await tripState(trip.id);
    expect(state).toMatchObject({ status: "COMPLETED", checkouts: 1 });
    expect(state.earnings.map((row) => row.amount)).toEqual([4_000]);
  });

  it("bulk check-out decided before a progressive scan: the late scan cannot change the closed trip", async () => {
    const trip = await f.trip({ bagCount: 2 });
    expect((await scan("adminA", trip.bagIds[1], "GOOD")).status).toBe(200);
    await warmUp();
    const [bulk, scanned] = await inOrder(lockTripRow(trip.id),
      () => checkout("adminA", trip.id, { bags: good(...trip.bagIds) }),
      () => scan("adminA", trip.bagIds[0], "POOR"));
    expect(bulk.status).toBe(201);
    expect(bulk.body.rewardAmount).toBe(4_000);
    expect(scanned.status).toBe(422);
    expect(scanned.body.error).toBe(
      "Trip sudah selesai. Perubahan kondisi kantong setelah check-out harus dicatat sebagai koreksi beserta alasannya.");
    const state = await tripState(trip.id);
    expect(state.bags.map((bag) => bag.status)).toEqual(["GOOD", "GOOD"]);
    expect(state).toMatchObject({ status: "COMPLETED", checkouts: 1 });
    expect(state.earnings.map((row) => row.amount)).toEqual([4_000]);
  });

  it("check-out takes the reward user's wallet lock before the trip lock", async () => {
    const trip = await f.trip({ bagCount: 1 });
    await warmUp();
    const observer = await f.connection();
    const holder = await holdLock(lockUserRow(f.ids.userA));
    let pending: ReturnType<typeof checkout> | undefined;
    try {
      pending = checkout("adminA", trip.id, { bags: good(trip.bagIds[0]) });
      pending.catch(() => {});
      await waitForBlockedBy(observer, { holderPid: holder.pid, timeoutMs: 15_000 });
      // While it waits for the User row it holds nothing on the Trip yet.
      const probe = await f.connection();
      const tripFree = await probe.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Trip" WHERE id = ${trip.id} FOR UPDATE NOWAIT`;
        return rows.length === 1;
      });
      expect(tripFree).toBe(true);
      expect(await isStillPending(pending, 100)).toBe(true);
    } finally {
      await holder.release();
    }
    const res = await pending!;
    expect(res.status).toBe(201);
    expect((await tripState(trip.id)).earnings).toHaveLength(1);
  });

  it("bag issuance waits for a closing check-out and cannot add a bag to the completed trip", async () => {
    const trip = await f.trip({ bagCount: 1 });
    await warmUp();
    const [closed, issued] = await inOrder(lockTripRow(trip.id),
      () => checkout("adminA", trip.id, { bags: good(trip.bagIds[0]) }),
      () => call("adminA", "POST", "/api/trash-bags", { tripId: trip.id, bagCount: 1 }));
    expect(closed.status).toBe(201);
    expect(issued.status).toBe(422);
    expect(issued.body.error).toBe("Kantong hanya dapat diterbitkan untuk trip PLANNED atau ACTIVE");
    expect((await tripState(trip.id)).bags).toHaveLength(1);
  });

  it("a cancel racing a check-out cannot overwrite the completed, rewarded trip", async () => {
    const trip = await f.trip({ bagCount: 1 });
    await warmUp();
    const [closed, cancelled] = await inOrder(lockTripRow(trip.id),
      () => checkout("adminA", trip.id, { bags: good(trip.bagIds[0]) }),
      () => call("adminA", "PATCH", `/api/trips/${trip.id}`, { status: "CANCELLED" }));
    expect(closed.status).toBe(201);
    expect(cancelled.status).toBe(409);
    expect(cancelled.body.error).toBe("Status trip sudah berubah. Muat ulang halaman lalu coba lagi.");
    expect(await tripState(trip.id)).toMatchObject({ status: "COMPLETED", checkouts: 1 });
  });
});

describe("authorization, idempotency and corrections", () => {
  it("rejects wrong-organization admins and collectors without changing anything", async () => {
    const own = await f.trip({ bagCount: 1 });
    const foreign = await f.trip({ bagCount: 1, organization: "B" });
    await f.db.trip.update({ where: { id: foreign.id }, data: { status: "COMPLETED" } });
    const attempts: Array<[string, Promise<{ status: number; body: Json }>]> = [
      ["adminB checks out org A", checkout("adminB", own.id, { bags: good(own.bagIds[0]) })],
      ["adminB scans org A", scan("adminB", own.bagIds[0], "GOOD")],
      ["adminA scans org B", scan("adminA", foreign.bagIds[0], "GOOD")],
      ["collector checks out", checkout("collectorA", own.id, { bags: good(own.bagIds[0]) })],
      ["collector scans", scan("collectorA", own.bagIds[0], "GOOD")],
      ["collector without partnership picks up", call("collectorB", "POST", "/api/manual-validations", {
        tripId: foreign.id, validationStage: "BANK_SAMPAH_PICKUP", returnedBagCount: 1, appCompleted: true })],
      ["user checks out", checkout("userA", own.id, { bags: good(own.bagIds[0]) })],
    ];
    for (const [label, attempt] of attempts) expect((await attempt).status, label).toBe(403);
    expect((await call("adminA", "POST", "/api/manual-validations", {
      tripId: foreign.id, validationStage: "CHECK_OUT", appCompleted: true, bags: good(foreign.bagIds[0]) })).status).toBe(403);
    for (const trip of [own, foreign]) {
      const state = await tripState(trip.id);
      expect(state.bags.map((bag) => bag.status)).toEqual([null]);
      expect(state).toMatchObject({ validations: 0, earnings: [] });
    }
    expect((await tripState(own.id)).status).toBe("ACTIVE");
  });

  it("repeating the same bag state is idempotent, before and after the trip closes", async () => {
    const trip = await f.trip({ bagCount: 2 });
    const firstScan = await scan("adminA", trip.bagIds[0], "GOOD");
    expect(firstScan.status).toBe(200);
    expect(firstScan.body.idempotent).toBe(false);
    const stamped = (await tripState(trip.id)).bags.find((bag) => bag.id === trip.bagIds[0])!.returnedAt;

    const repeat = await scan("adminA", trip.bagIds[0], "GOOD");
    expect(repeat.status).toBe(200);
    expect(repeat.body).toMatchObject({ idempotent: true, rewardAmount: 0, validation: null });
    expect((await tripState(trip.id)).bags.find((bag) => bag.id === trip.bagIds[0])!.returnedAt).toEqual(stamped);
    expect(await f.db.auditLog.count({ where: { action: "TRASH_BAG_SCAN_UPDATE", entityId: trip.bagIds[0] } })).toBe(1);

    const last = await scan("adminA", trip.bagIds[1], "GOOD");
    expect(last.body).toMatchObject({ idempotent: false, rewardAmount: 4_000 });
    // The response of the closing scan was lost; the scanner retries it.
    const retry = await scan("adminA", trip.bagIds[1], "GOOD");
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ idempotent: true, rewardAmount: 0, validation: null });
    const bulkRetry = await checkout("adminA", trip.id, { bags: good(...trip.bagIds) });
    expect(bulkRetry.status).toBe(422);
    const state = await tripState(trip.id);
    expect(state).toMatchObject({ status: "COMPLETED", checkouts: 1 });
    expect(state.earnings.map((row) => row.amount)).toEqual([4_000]);
  });

  it("a re-scan never closes or pays a legacy fully-reviewed ACTIVE trip; only a bulk check-out with IDs does (I1)", async () => {
    const trip = await f.trip({ bagCount: 2 });
    // Pre-fix state (EX-02): old scans reviewed every bag on stale aggregates, the trip stayed ACTIVE, nobody was paid.
    await f.db.trashBagAssignment.updateMany({ where: { tripId: trip.id }, data: { status: "GOOD", returnedAt: new Date() } });

    const identical = await scan("adminA", trip.bagIds[0], "GOOD");
    expect(identical.status).toBe(200);
    expect(identical.body).toMatchObject({ idempotent: true, rewardAmount: 0, validation: null });
    expect(await tripState(trip.id)).toMatchObject({ status: "ACTIVE", checkouts: 0, earnings: [] });
    expect(await f.db.auditLog.count({ where: { action: "TRASH_BAG_SCAN_UPDATE" } })).toBe(0);

    const changed = await scan("adminA", trip.bagIds[0], "PARTIAL");
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ idempotent: false, rewardAmount: 0, validation: null });
    let state = await tripState(trip.id);
    expect(state).toMatchObject({ status: "ACTIVE", checkouts: 0, earnings: [] });
    expect(state.bags.find((bag) => bag.id === trip.bagIds[0])!.status).toBe("PARTIAL");

    // The read-only inventory sizes the exposure before anyone closes it.
    const listed = (await readOnlyInventory()).unclosedReviewedTrips;
    expect(listed).toEqual([{
      tripId: trip.id, userId: f.ids.userA, campaignId: expect.any(String), bagRows: 2, returnedCount: 2, rewardableCount: 2,
      conditionStatus: "PARTIAL",
      // app 30 + all returned 40 + PARTIAL 20 = 90 -> 2 x 2.000 x 90%; without the app: 60%.
      recomputedRewardAmount: { appCompleted: 3_600, appNotCompleted: 2_400 },
    }]);

    // Closing a legacy trip is an explicit operator check-out listing every bag.
    const closed = await checkout("adminA", trip.id, { bags: [
      { id: trip.bagIds[0], status: "PARTIAL" }, { id: trip.bagIds[1], status: "GOOD" }] });
    expect(closed.status).toBe(201);
    expect(closed.body.rewardAmount).toBe(3_600);
    state = await tripState(trip.id);
    expect(state).toMatchObject({ status: "COMPLETED", checkouts: 1 });
    expect(state.earnings.map((row) => [row.amount, row.businessKey])).toEqual([[3_600, returnKey(trip.id)]]);
    expect((await readOnlyInventory()).unclosedReviewedTrips).toEqual([]);
  });

  it("a change after close needs a recorded correction and never mints a second reward", async () => {
    const trip = await f.trip({ bagCount: 2 });
    const closed = await checkout("adminA", trip.id, { bags: [
      { id: trip.bagIds[0], status: "GOOD" }, { id: trip.bagIds[1], status: "POOR" }] });
    expect(closed.status).toBe(201);
    // app 30 + all returned 40 + POOR 0 = 70; one rewardable bag x Rp2.000 x 70%.
    expect(closed.body.rewardAmount).toBe(1_400);

    const silent = await scan("adminA", trip.bagIds[1], "GOOD");
    expect(silent.status).toBe(422);
    expect((await tripState(trip.id)).bags.map((bag) => bag.status).sort()).toEqual(["GOOD", "POOR"]);

    const reason = "Salah input kondisi di gerbang";
    const corrected = await scan("adminA", trip.bagIds[1], "GOOD", { correctionReason: reason });
    expect(corrected.status).toBe(200);
    expect(corrected.body).toMatchObject({
      idempotent: false, rewardAmount: 0, validation: null,
      compliance: { score: 100, status: "COMPLIANT" },
      correction: { previousStatus: "POOR", paidRewardAmount: 1_400, recomputedRewardAmount: 4_000 },
    });
    const state = await tripState(trip.id);
    expect(state.bags.map((bag) => bag.status)).toEqual(["GOOD", "GOOD"]);
    expect(state).toMatchObject({ status: "COMPLETED", complianceScore: 100, checkouts: 1 });
    expect(state.earnings.map((row) => [row.amount, row.businessKey])).toEqual([[1_400, returnKey(trip.id)]]);
    const audit = await f.db.auditLog.findFirstOrThrow({ where: { action: "TRASH_BAG_CORRECTION", entityId: trip.bagIds[1] } });
    expect(audit.metadataJson).toMatchObject({ tripId: trip.id, previousStatus: "POOR", status: "GOOD", reason,
      paidRewardAmount: 1_400, recomputedRewardAmount: 4_000 });

    const again = await scan("adminA", trip.bagIds[1], "GOOD", { correctionReason: reason });
    expect(again.body).toMatchObject({ idempotent: true, rewardAmount: 0 });
    expect(await f.db.auditLog.count({ where: { action: "TRASH_BAG_CORRECTION" } })).toBe(1);
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA } })).toBe(1);
  });
});
