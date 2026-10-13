import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getWalletBalance } from "@/lib/ledger";
import { signMachinePayload } from "@/lib/machine-auth";
import { ingestMachineEvent } from "@/lib/machine-events/ingest";
import { resolveRewardRate } from "@/lib/reward";
import { f, type ActorKey } from "../support/audit-fixture";
import { InjectedFault, deferred, isStillPending, waitForBlockedBy } from "../support/race-probe";

/**
 * M04 (LOG-04, LOG-05, EX-03): one reward policy for every entry point, run
 * against the real Next server and PostgreSQL. Machine deposits go through the
 * signed /api/machine-events protocol exactly like rvm/sync.py sends them.
 */

type Json = Record<string, any>;
type EdgeEvent = {
  localEventId: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  sessionId: string | null;
  depositItemId: string | null;
  occurredAt: string;
};

async function call(actor: ActorKey, method: string, path: string, body?: unknown) {
  const response = await f.json(actor, method, path, body);
  return { status: response.status, body: (await response.json().catch(() => null)) as Json };
}

async function postBatch(events: EdgeEvent[]) {
  const machine = await f.db.machine.findUniqueOrThrow({ where: { id: f.ids.machineA } });
  const raw = JSON.stringify({ machineCode: f.ids.machineCode, events });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replaceAll("-", "");
  const response = await fetch(new URL("/api/machine-events", process.env.AUDIT_BASE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-reloop-machine": f.ids.machineCode,
      "x-reloop-timestamp": timestamp,
      "x-reloop-nonce": nonce,
      "x-reloop-signature": signMachinePayload(machine.ingestSecret ?? "", timestamp, nonce, raw),
    },
    body: raw,
  });
  return { status: response.status, body: (await response.json()) as Json };
}

let clock = 0;
function edgeEvent(sessionId: string, eventType: string, payload: Record<string, unknown>): EdgeEvent {
  clock += 1;
  return {
    localEventId: randomUUID(),
    eventType,
    payload,
    sessionId,
    depositItemId: null,
    occurredAt: new Date(Date.UTC(2026, 9, 14, 8, 0, 0, clock)).toISOString(),
  };
}

const fixtureWasteTypeId = async () =>
  (await f.db.machineWasteType.findFirstOrThrow({ where: { machineId: f.ids.machineA, active: true } })).wasteTypeId;
const machineCampaignId = async () =>
  (await f.db.campaign.findFirstOrThrow({ where: { organizationId: f.ids.orgA, campaignType: "MACHINE_DEPOSIT" } })).id;

interface DepositOptions {
  campaignId?: string | null;
  weightGrams?: number;
  /** [label, confidence] reported by IMAGE_CLASSIFIED; null = no classification event. */
  ai?: [string, number] | null;
  barcode?: string;
  /** Reverse motion in the sensor sequence (an anomaly). */
  anomaly?: boolean;
}

function depositEvents(sessionId: string, wasteTypeId: string, options: DepositOptions): EdgeEvent[] {
  const events = [edgeEvent(sessionId, "ITEM_DETECTED", { wasteTypeId, quantity: 1, inputBeam: true })];
  if (options.ai) {
    events.push(edgeEvent(sessionId, "IMAGE_CLASSIFIED", { detectedType: options.ai[0], confidence: options.ai[1] }));
  }
  events.push(edgeEvent(sessionId, "WEIGHT_MEASURED", { weightGrams: options.weightGrams ?? 25, stable: true }));
  if (options.barcode) events.push(edgeEvent(sessionId, "BARCODE_READ", { barcode: options.barcode }));
  if (options.anomaly) {
    events.push(edgeEvent(sessionId, "SENSOR_SEQUENCE", { steps: ["CHAMBER_OPEN", "ITEM_PRESENT"], reverseMotion: true }));
  }
  events.push(edgeEvent(sessionId, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true }));
  return events;
}

/** One item through the signed machine protocol; every event must be ACKed. */
async function deposit(options: DepositOptions = {}) {
  const wasteTypeId = await fixtureWasteTypeId();
  const session = await f.db.depositSession.create({
    data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE", campaignId: options.campaignId ?? null },
  });
  const events = depositEvents(session.id, wasteTypeId, options);
  const res = await postBatch(events);
  expect(res.status).toBe(200);
  expect(res.body.results.map((r: Json) => r.status)).toEqual(events.map(() => "accepted"));
  const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: session.id } });
  const ledger = await f.db.rewardLedger.findMany({ where: { depositItemId: item.id }, orderBy: { createdAt: "asc" } });
  return { session, item, ledger, events };
}

async function warmUp() {
  expect((await postBatch([])).status).toBe(200);
  expect((await call("adminA", "PATCH", "/api/deposit-reviews/missing-item", { action: "reject" })).status).toBe(404);
}

const earnKey = (itemId: string) => `deposit-item:${itemId}:earn`;

describe("COMPLIANCE_ONLY never mints money at any entry point (LOG-04)", () => {
  it("machine deposit: a COMPLIANCE_ONLY campaign session accepts the item without any money entry; MONEY_REWARD pays", async () => {
    await warmUp();
    const campaignId = await machineCampaignId();
    const paid = await deposit({ campaignId });
    expect(paid.item).toMatchObject({ status: "ACCEPTED", rewardAmount: 100 });
    expect(paid.ledger).toEqual([expect.objectContaining({
      entryType: "EARN", status: "AVAILABLE", amount: 100, userId: f.ids.userA, businessKey: earnKey(paid.item.id) })]);

    await f.db.campaign.update({ where: { id: campaignId }, data: { rewardMode: "COMPLIANCE_ONLY" } });
    const before = await getWalletBalance(f.ids.userA);
    const compliance = await deposit({ campaignId });
    expect(compliance.item).toMatchObject({ status: "ACCEPTED", rewardAmount: 0 });
    expect(compliance.ledger).toEqual([]);
    expect(await getWalletBalance(f.ids.userA)).toEqual(before);

    // An anomaly in a COMPLIANCE_ONLY session goes to review, still without a pending money hold.
    const anomaly = await deposit({ campaignId, anomaly: true });
    expect(anomaly.item).toMatchObject({ status: "REVIEW", rewardAmount: 0 });
    expect(anomaly.ledger).toEqual([]);
  });

  it("machine deposit without a campaign uses the organization's explicit machine reward mode", async () => {
    await warmUp();
    const paid = await deposit();
    expect(paid.ledger.map((row) => [row.entryType, row.status, row.amount])).toEqual([["EARN", "AVAILABLE", 100]]);

    await f.db.organization.update({ where: { id: f.ids.orgA }, data: { machineRewardMode: "COMPLIANCE_ONLY" } });
    const compliance = await deposit();
    expect(compliance.item.status).toBe("ACCEPTED");
    expect(compliance.ledger).toEqual([]);
  });

  it("machine deposit in a session bound to a non-machine campaign (TRASH_BAG) earns no money", async () => {
    await warmUp();
    const trashBag = await f.db.campaign.findFirstOrThrow({ where: { organizationId: f.ids.orgA, campaignType: "TRASH_BAG" } });
    expect(trashBag.rewardMode).toBe("MONEY_REWARD");
    const legacy = await deposit({ campaignId: trashBag.id });
    expect(legacy.item.rewardAmount).toBe(0);
    expect(legacy.ledger).toEqual([]);
  });

  it("scan refuses campaigns that do not support machines; EVENT/SCHOOL_PROGRAM need supportsMachine", async () => {
    const token = await f.machineQrToken();
    const scan = (campaignId: string) => call("userA", "POST", "/api/scan", { machineCode: f.ids.machineCode, token, campaignId });
    const trashBag = await f.db.campaign.findFirstOrThrow({ where: { organizationId: f.ids.orgA, campaignType: "TRASH_BAG" } });
    const refused = await scan(trashBag.id);
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("Campaign ini tidak berlaku untuk setoran mesin");

    const window = { status: "ACTIVE" as const, startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000) };
    const event = await f.db.campaign.create({
      data: { ...window, organizationId: f.ids.orgA, name: "Acara Audit", campaignType: "EVENT" } });
    expect((await scan(event.id)).status).toBe(422);
    await f.db.campaign.update({ where: { id: event.id }, data: { supportsMachine: true } });
    const started = await scan(event.id);
    expect(started.status).toBe(201);
    expect(started.body.session.campaignId).toBe(event.id);
    expect(await f.db.depositSession.count({ where: { campaignId: trashBag.id } })).toBe(0);
  });

  it("manual check-out and progressive bag scan of a COMPLIANCE_ONLY trip close it with money 0", async () => {
    const { campaignId } = await f.db.trip.findUniqueOrThrow({ where: { id: (await f.trip({ bagCount: 0 })).id } });
    await f.db.campaign.update({ where: { id: campaignId }, data: { rewardMode: "COMPLIANCE_ONLY" } });

    const bulk = await f.trip({ bagCount: 2 });
    const checkout = await call("adminA", "POST", "/api/manual-validations", {
      tripId: bulk.id, validationStage: "CHECK_OUT", appCompleted: true,
      bags: bulk.bagIds.map((id) => ({ id, status: "GOOD" })) });
    expect(checkout.status).toBe(201);
    expect(checkout.body.rewardAmount).toBe(0);
    expect((await f.db.trip.findUniqueOrThrow({ where: { id: bulk.id } })).status).toBe("COMPLETED");

    const progressive = await f.trip({ bagCount: 1 });
    const scanned = await call("adminA", "PATCH", "/api/trash-bags", { id: progressive.bagIds[0], status: "GOOD", appCompleted: true });
    expect(scanned.status).toBe(200);
    expect((await f.db.trip.findUniqueOrThrow({ where: { id: progressive.id } })).status).toBe("COMPLETED");

    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA } })).toBe(0);
  });

  it("review approval in a COMPLIANCE_ONLY campaign pays nothing and rejects a legacy pending hold", async () => {
    await warmUp();
    const campaignId = await machineCampaignId();
    await f.db.campaign.update({ where: { id: campaignId }, data: { rewardMode: "COMPLIANCE_ONLY" } });

    const held = await deposit({ campaignId, anomaly: true });
    expect(held.item.status).toBe("REVIEW");
    const approved = await call("adminA", "PATCH", `/api/deposit-reviews/${held.item.id}`, { action: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.item).toMatchObject({ status: "ACCEPTED", rewardAmount: 0 });
    expect(await f.db.rewardLedger.count({ where: { depositItemId: held.item.id } })).toBe(0);

    // A pending hold written before M04 for a COMPLIANCE_ONLY session is never released.
    const legacy = await deposit({ campaignId, anomaly: true });
    await f.db.rewardLedger.create({ data: {
      userId: f.ids.userA, organizationId: f.ids.orgA, depositItemId: legacy.item.id, sessionId: legacy.session.id,
      entryType: "EARN", amount: 50, status: "PENDING", reasonCode: "REVERSE_MOTION",
      referenceType: "DepositItem", referenceId: legacy.item.id, businessKey: earnKey(legacy.item.id) } });
    const before = await getWalletBalance(f.ids.userA);
    const legacyApproved = await call("adminA", "PATCH", `/api/deposit-reviews/${legacy.item.id}`, { action: "approve" });
    expect(legacyApproved.status).toBe(200);
    const rows = await f.db.rewardLedger.findMany({ where: { depositItemId: legacy.item.id } });
    expect(rows.map((row) => [row.entryType, row.status, row.amount])).toEqual([["EARN", "REJECTED", 50]]);
    expect(await getWalletBalance(f.ids.userA)).toEqual({ ...before, pending: before.pending - 50, totalEarned: before.totalEarned - 50 });
  });
});

describe("AI classification is checked against the selected waste type's taxonomy (LOG-05)", () => {
  async function configure(policy: "AI_REQUIRED" | "BARCODE_WEIGHT" | "WEIGHT_ONLY") {
    await f.db.wasteType.update({ where: { id: await fixtureWasteTypeId() }, data: { aiAcceptedLabels: ["bottle_pet"] } });
    await f.db.machine.update({ where: { id: f.ids.machineA }, data: { materialVerification: policy } });
    await f.db.rewardRate.updateMany({ where: { organizationId: f.ids.orgA }, data: { minWeightGrams: 10, maxWeightGrams: 100 } });
  }
  const outcome = (d: Awaited<ReturnType<typeof deposit>>) => ({
    status: d.item.status,
    reason: d.item.validationReasonCode,
    ledger: d.ledger.map((row) => [row.entryType, row.status, row.amount]),
  });

  it("paper, low confidence and a wrong selected material are held PENDING; a matching label is paid", async () => {
    await warmUp();
    await configure("WEIGHT_ONLY");
    expect(outcome(await deposit({ ai: ["paper", 0.97] })))
      .toEqual({ status: "REVIEW", reason: "AI_TYPE_MISMATCH", ledger: [["EARN", "PENDING", 50]] });
    expect(outcome(await deposit({ ai: ["bottle_pet", 0.31] })))
      .toEqual({ status: "REVIEW", reason: "AI_LOW_CONFIDENCE", ledger: [["EARN", "PENDING", 50]] });
    expect(outcome(await deposit({ ai: ["can_aluminium", 0.95] })))
      .toEqual({ status: "REVIEW", reason: "AI_TYPE_MISMATCH", ledger: [["EARN", "PENDING", 50]] });
    expect(outcome(await deposit({ ai: ["Bottle PET", 0.95] })))
      .toEqual({ status: "ACCEPTED", reason: "ACCEPTED", ledger: [["EARN", "AVAILABLE", 100]] });
    const balance = await getWalletBalance(f.ids.userA);
    expect(balance).toMatchObject({ available: 100, pending: 150 });
  });

  it("an invalid weight is REJECTED without money even with a matching label", async () => {
    await warmUp();
    await configure("WEIGHT_ONLY");
    for (const weightGrams of [500, 2]) {
      const rejected = await deposit({ ai: ["bottle_pet", 0.95], weightGrams });
      expect(rejected.item.status).toBe("REJECTED");
      expect(rejected.item.rewardAmount).toBe(0);
      expect(rejected.ledger).toEqual([]);
    }
  });

  it("an unavailable classifier follows the machine policy explicitly", async () => {
    await warmUp();
    await configure("WEIGHT_ONLY");
    expect(outcome(await deposit({ ai: ["unknown", 0] })))
      .toEqual({ status: "ACCEPTED", reason: "ACCEPTED", ledger: [["EARN", "AVAILABLE", 100]] });
    expect((await deposit({ ai: null })).item.status).toBe("ACCEPTED");

    await configure("AI_REQUIRED");
    expect(outcome(await deposit({ ai: ["unknown", 0] })))
      .toEqual({ status: "REVIEW", reason: "AI_UNAVAILABLE", ledger: [["EARN", "PENDING", 50]] });
    expect(outcome(await deposit({ ai: null })))
      .toEqual({ status: "REVIEW", reason: "AI_UNAVAILABLE", ledger: [["EARN", "PENDING", 50]] });
    expect(outcome(await deposit({ ai: ["bottle_pet", 0.9] })))
      .toEqual({ status: "ACCEPTED", reason: "ACCEPTED", ledger: [["EARN", "AVAILABLE", 100]] });

    await configure("BARCODE_WEIGHT");
    expect(outcome(await deposit({ ai: null, barcode: "8991002100012" })))
      .toEqual({ status: "ACCEPTED", reason: "ACCEPTED", ledger: [["EARN", "AVAILABLE", 100]] });
    expect(outcome(await deposit({ ai: null })))
      .toEqual({ status: "REVIEW", reason: "BARCODE_MISSING", ledger: [["EARN", "PENDING", 50]] });
    // A confirming label does not waive the barcode the policy requires.
    expect(outcome(await deposit({ ai: ["bottle_pet", 0.9] })).reason).toBe("BARCODE_MISSING");
    // A reported label is never ignored, whatever the machine policy.
    expect(outcome(await deposit({ ai: ["paper", 0.9], barcode: "8991002100012" })).status).toBe("REVIEW");
  });
});

describe("reward rate windows (EX-03)", () => {
  it("an active campaign rate whose effectiveTo has passed is never used by a machine deposit", async () => {
    await warmUp();
    const campaignId = await machineCampaignId();
    await f.db.rewardRate.create({ data: {
      campaignId, wasteTypeId: await fixtureWasteTypeId(), unit: "ITEM", pointsPerItem: 900, active: true,
      effectiveFrom: new Date(Date.now() - 10 * 86_400_000), effectiveTo: new Date(Date.now() - 86_400_000) } });
    const paid = await deposit({ campaignId });
    expect(paid.item.rewardAmount).toBe(100);
    expect(paid.ledger.map((row) => row.amount)).toEqual([100]);
  });

  it("selects by half-open UTC windows [effectiveFrom, effectiveTo)", async () => {
    const wasteTypeId = await fixtureWasteTypeId();
    const T = new Date("2026-11-01T00:00:00.000Z");
    const ms = (delta: number) => new Date(T.getTime() + delta);
    await f.db.rewardRate.updateMany({ where: { organizationId: f.ids.orgA }, data: { effectiveFrom: new Date("2026-01-01T00:00:00.000Z") } });
    const ending = await f.db.rewardRate.create({ data: {
      organizationId: f.ids.orgA, wasteTypeId, unit: "ITEM", pointsPerItem: 300, active: true,
      effectiveFrom: new Date("2026-06-01T00:00:00.000Z"), effectiveTo: T } });
    const starting = await f.db.rewardRate.create({ data: {
      organizationId: f.ids.orgA, wasteTypeId, unit: "ITEM", pointsPerItem: 500, active: true, effectiveFrom: T } });
    const pick = async (now: Date) =>
      (await resolveRewardRate({ organizationId: f.ids.orgA, campaignId: null, wasteTypeId, now }))?.id;

    expect(await pick(ms(-1))).toBe(ending.id);
    expect(await pick(T)).toBe(starting.id);
    expect(await pick(ms(1))).toBe(starting.id);

    // active=true but expired, and a future rate: neither is selected.
    await f.db.rewardRate.update({ where: { id: starting.id }, data: { effectiveFrom: ms(86_400_000) } });
    const fallback = await pick(T);
    expect(fallback).not.toBe(ending.id);
    expect(fallback).not.toBe(starting.id);
    expect((await f.db.rewardRate.findUniqueOrThrow({ where: { id: fallback! } })).pointsPerItem).toBe(100);
    // A deactivated rate is never selected inside its window.
    await f.db.rewardRate.update({ where: { id: ending.id }, data: { active: false } });
    expect(await pick(ms(-1))).toBe(fallback);
  });
});

describe("machine event retries and rollback", () => {
  it("a retry after commit is a duplicate and never writes a second EARN", async () => {
    await warmUp();
    const first = await deposit();
    expect(first.ledger).toHaveLength(1);
    const retry = await postBatch(first.events);
    expect(retry.body.results.map((r: Json) => r.status)).toEqual(first.events.map(() => "duplicate"));
    // A different localEventId for the same acceptance point (edge replay after a DB reset) is also not paid twice.
    const replay = edgeEvent(first.session.id, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true });
    replay.depositItemId = first.item.id;
    expect((await postBatch([replay])).body.results[0].status).toBe("accepted");
    expect(await f.db.rewardLedger.count({ where: { depositItemId: first.item.id } })).toBe(1);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(100);
  });

  it("an exception inside the event transaction rolls back the event and the ledger together", async () => {
    const wasteTypeId = await fixtureWasteTypeId();
    const session = await f.db.depositSession.create({
      data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE" } });
    const [detected, weighed, accepted] = depositEvents(session.id, wasteTypeId, {});
    const machine = await f.db.machine.findUniqueOrThrow({ where: { id: f.ids.machineA }, include: { organization: true } });
    const input = (event: EdgeEvent) => ({ ...event, machineCode: f.ids.machineCode }) as Parameters<typeof ingestMachineEvent>[0];
    await ingestMachineEvent(input(detected), { machine });
    await ingestMachineEvent(input(weighed), { machine });

    await expect(ingestMachineEvent(input(accepted), {
      machine,
      hooks: { afterSideEffects: async () => { throw new InjectedFault("SIDE_EFFECT_FAILED"); } },
    })).rejects.toThrow("SIDE_EFFECT_FAILED");
    expect(await f.db.machineEvent.count({ where: { localEventId: accepted.localEventId } })).toBe(0);
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA } })).toBe(0);
    const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: session.id } });
    expect(item).toMatchObject({ status: "PENDING", acceptanceEventId: null, rewardAmount: 0 });

    const retried = await ingestMachineEvent(input(accepted), { machine });
    expect(retried.duplicate).toBe(false);
    expect(await f.db.rewardLedger.findMany({ where: { depositItemId: item.id } }))
      .toEqual([expect.objectContaining({ entryType: "EARN", status: "AVAILABLE", amount: 100 })]);
    expect((await ingestMachineEvent(input(accepted), { machine })).duplicate).toBe(true);
    expect(await f.db.rewardLedger.count({ where: { depositItemId: item.id } })).toBe(1);
  });
});

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

/** True when no other transaction holds a NO KEY UPDATE (or stronger) lock on the row. */
async function rowLockFree(observer: PrismaClient, table: "DepositSession" | "DepositItem", id: string) {
  try {
    await observer.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR NO KEY UPDATE NOWAIT`, id);
    return true;
  } catch (error) {
    if ((error as { meta?: { code?: string } }).meta?.code === "55P03") return false;
    throw error;
  }
}

describe("machine acceptance lock order", () => {
  it("takes the recipient's User lock before the session and item, and is ACKed only after the reward commits", async () => {
    await warmUp();
    const wasteTypeId = await fixtureWasteTypeId();
    const session = await f.db.depositSession.create({
      data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE" } });
    const [detected, weighed, accepted] = depositEvents(session.id, wasteTypeId, {});
    expect((await postBatch([detected, weighed])).body.results.map((r: Json) => r.status)).toEqual(["accepted", "accepted"]);
    const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: session.id } });

    const observer = await f.connection();
    const holder = await holdLock((tx) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${f.ids.userA} FOR NO KEY UPDATE`);
    let pending: Promise<{ status: number; body: Json }> | undefined;
    try {
      pending = postBatch([accepted]);
      pending.catch(() => {});
      await waitForBlockedBy(observer, { holderPid: holder.pid, timeoutMs: 15_000 });
      expect(await isStillPending(pending, 200)).toBe(true);
      expect(await rowLockFree(observer, "DepositSession", session.id)).toBe(true);
      expect(await rowLockFree(observer, "DepositItem", item.id)).toBe(true);
      expect(await f.db.rewardLedger.count({ where: { depositItemId: item.id } })).toBe(0);
    } finally {
      await holder.release();
    }
    expect((await pending!).body.results[0].status).toBe("accepted");
    expect(await f.db.rewardLedger.findMany({ where: { depositItemId: item.id } }))
      .toEqual([expect.objectContaining({ entryType: "EARN", status: "AVAILABLE", amount: 100 })]);
  });
});

describe("fraud holds and erased recipients never force the ledger", () => {
  it("fraud after acceptance moves the earning to PENDING while the balance still covers it", async () => {
    await warmUp();
    const paid = await deposit();
    const fraud = edgeEvent(paid.session.id, "FRAUD_DETECTED", { reason: "STRING_PULL" });
    fraud.depositItemId = paid.item.id;
    expect((await postBatch([fraud])).body.results[0].status).toBe("accepted");
    expect(await f.db.rewardLedger.findMany({ where: { depositItemId: paid.item.id } }))
      .toEqual([expect.objectContaining({ entryType: "EARN", status: "PENDING", amount: 100 })]);
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 0, pending: 100 });
    expect((await f.db.depositItem.findUniqueOrThrow({ where: { id: paid.item.id } })).status).toBe("REVIEW");
    expect(await f.db.rewardReconciliationCase.count()).toBe(0);
  });

  it("fraud on an earning already reserved for payout opens a reconciliation case instead of a negative balance", async () => {
    await warmUp();
    const paid = await deposit();
    // The deposit's Rp100 is part of a payout already being processed.
    await f.processingRedemption(10_000);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(0);
    const fraud = edgeEvent(paid.session.id, "FRAUD_DETECTED", { reason: "STRING_PULL" });
    fraud.depositItemId = paid.item.id;
    expect((await postBatch([fraud])).body.results[0].status).toBe("accepted");

    expect(await f.db.rewardLedger.findMany({ where: { depositItemId: paid.item.id } }))
      .toEqual([expect.objectContaining({ entryType: "EARN", status: "AVAILABLE", amount: 100 })]);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(0);
    expect(await f.db.rewardReconciliationCase.findMany()).toEqual([expect.objectContaining({
      businessKey: `fraud:${paid.item.id}:hold:v1`, userId: f.ids.userA, depositItemId: paid.item.id,
      amount: 100, reasonCode: "ANOMALY_ALREADY_PAID_OUT", status: "OPEN" })]);
    // A retried fraud event for the same item does not open a second case.
    const again = edgeEvent(paid.session.id, "FRAUD_DETECTED", { reason: "STRING_PULL" });
    again.depositItemId = paid.item.id;
    await postBatch([again]);
    expect(await f.db.rewardReconciliationCase.count()).toBe(1);
  });

  it("refuses to credit an erased account and records the refusal as a case (A04)", async () => {
    await warmUp();
    // State an erasure would leave if a reward writer raced it: a reviewable
    // item with no money yet, and an anonymized owner.
    const session = await f.db.depositSession.create({
      data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "COMPLETED", completedAt: new Date() } });
    const item = await f.db.depositItem.create({ data: {
      sessionId: session.id, wasteTypeId: await fixtureWasteTypeId(), quantity: 1, measuredWeightGrams: 25,
      status: "REVIEW", validationReasonCode: "ANOMALY_REVIEW", source: "MACHINE" } });
    await f.db.user.update({ where: { id: f.ids.userA }, data: { status: "INACTIVE" } });
    const request = await f.db.deletionRequest.create({ data: {
      userId: f.ids.userA, scope: "FULL", status: "PROCESSING", verificationMethod: "SESSION", verifiedAt: new Date() } });
    await f.db.erasureJobStep.create({ data: { requestId: request.id, step: "ANONYMIZE_ACCOUNT", completedAt: new Date() } });

    const approved = await call("adminA", "PATCH", `/api/deposit-reviews/${item.id}`, { action: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.item.status).toBe("ACCEPTED");
    expect(approved.body.reconciliationCase).toMatchObject({ reasonCode: "RECIPIENT_ERASED", amount: 100 });
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA } })).toBe(0);
    expect(await f.db.rewardReconciliationCase.findMany()).toEqual([expect.objectContaining({
      businessKey: `review:${item.id}:decision:v1`, userId: f.ids.userA, depositItemId: item.id, amount: 100,
      reasonCode: "RECIPIENT_ERASED", status: "OPEN" })]);
    // Replaying the decision neither credits nor opens a second case.
    const replay = await call("adminA", "PATCH", `/api/deposit-reviews/${item.id}`, { action: "approve" });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
    expect(await f.db.rewardReconciliationCase.count()).toBe(1);
  });
});
