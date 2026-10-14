import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getWalletBalance } from "@/lib/ledger";
import { signMachinePayload } from "@/lib/machine-auth";
import { ingestMachineEvent } from "@/lib/machine-events/ingest";
import { UNKNOWN_WASTE_TYPE_NAME } from "@/lib/machine-events/shared";
import { resolveRewardRate } from "@/lib/reward";
import {
  LEGACY_ACCEPTANCE_PREFIX,
  REVIEW_LEGACY_ROW,
  REVIEW_LEGACY_SESSION_OPEN,
  REVIEW_LEGACY_SUPERADMIN_ONLY,
  REVIEW_NOT_ACCEPTED,
  REVIEW_NOT_LEGACY,
} from "@/lib/deposit-review-contract";
import { collectWalletInventory } from "@/scripts/reconcile-wallet-history";
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
  (await f.db.wasteType.findFirstOrThrow({ where: { name: "Botol Plastik Audit" } })).id;
const machineCampaignId = async () =>
  (await f.db.campaign.findFirstOrThrow({ where: { organizationId: f.ids.orgA, campaignType: "MACHINE_DEPOSIT" } })).id;

interface DepositOptions {
  campaignId?: string | null;
  /** Defaults to the fixture's ITEM-unit waste type. */
  wasteTypeId?: string;
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
  const wasteTypeId = options.wasteTypeId ?? (await fixtureWasteTypeId());
  const session = await openSession({
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

/**
 * R03 (EX-04): a machine has at most one active session (partial unique index
 * DepositSession_one_active_per_machine). These tests model consecutive
 * deposits on the single fixture machine, so an active session is opened only
 * after the previous one was finished, as its owner would; a closed session is
 * inserted as is.
 */
async function openSession(args: Prisma.DepositSessionCreateArgs) {
  const status = args.data.status ?? "RESERVED";
  if (["RESERVED", "ACTIVE", "PROCESSING_ITEM", "REVIEW"].includes(status)) {
    await f.db.depositSession.updateMany({
      where: { machineId: f.ids.machineA, status: { in: ["RESERVED", "ACTIVE", "PROCESSING_ITEM", "REVIEW"] } },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
  }
  return f.db.depositSession.create(args);
}

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
    const session = await openSession({
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
    const session = await openSession({
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
      status: "REVIEW", validationReasonCode: "ANOMALY_REVIEW", source: "MACHINE",
      acceptanceEventId: `evt-${randomUUID()}`, acceptedAt: new Date(),
      rewardRateId: (await f.db.rewardRate.findFirstOrThrow({ where: { organizationId: f.ids.orgA } })).id } });
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

describe("decided items stay decided (M04 fix round 1)", () => {
  /** ITEM_DETECTED (+ optional weight) without an acceptance point: the item stays PENDING. */
  async function detectOnly(options: { weightGrams?: number | null; unknownType?: boolean } = {}) {
    const session = await openSession({
      data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE" } });
    const detected = options.unknownType
      ? edgeEvent(session.id, "ITEM_DETECTED", { quantity: 1, inputBeam: true })
      : edgeEvent(session.id, "ITEM_DETECTED", { wasteTypeId: await fixtureWasteTypeId(), quantity: 1, inputBeam: true });
    const events = [detected];
    if (options.weightGrams !== null) {
      events.push(edgeEvent(session.id, "WEIGHT_MEASURED", { weightGrams: options.weightGrams ?? 25, stable: true }));
    }
    const res = await postBatch(events);
    expect(res.body.results.map((r: Json) => r.status)).toEqual(events.map(() => "accepted"));
    const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: session.id } });
    return { session, item };
  }
  const machineEvent = async (sessionId: string, eventType: string, payload: Record<string, unknown>, depositItemId?: string) => {
    const event = edgeEvent(sessionId, eventType, payload);
    if (depositItemId) event.depositItemId = depositItemId;
    const res = await postBatch([event]);
    expect(res.status).toBe(200);
    return res.body.results[0] as Json;
  };
  const itemOf = (id: string) => f.db.depositItem.findUniqueOrThrow({ where: { id } });
  const review = (id: string, body: Record<string, unknown>) => call("adminA", "PATCH", `/api/deposit-reviews/${id}`, body);
  const weightWindow = () =>
    f.db.rewardRate.updateMany({ where: { organizationId: f.ids.orgA }, data: { minWeightGrams: 10, maxWeightGrams: 100 } });

  it("I1: a fraud event never reopens a REJECTED item or erases its weight reason; approving it is 409", async () => {
    await warmUp();
    await weightWindow();
    const rejected = await deposit({ weightGrams: 500 });
    expect(rejected.item).toMatchObject({ status: "REJECTED", validationReasonCode: "WEIGHT_ABOVE_MAX" });

    // Session-only fraud event: the server picks the latest item of the session.
    expect((await machineEvent(rejected.session.id, "FRAUD_DETECTED", { reason: "STRING_PULL" })).status).toBe("accepted");
    expect(await itemOf(rejected.item.id)).toMatchObject({
      status: "REJECTED", validationReasonCode: "WEIGHT_ABOVE_MAX", externalFraudFlag: true });
    const approve = await review(rejected.item.id, { action: "approve" });
    expect(approve.status).toBe(409);
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA } })).toBe(0);

    // The same holds for an item the machine itself rejected, and for a sensor anomaly naming it.
    const machineRejected = await detectOnly();
    await machineEvent(machineRejected.session.id, "ITEM_REJECTED", { reason: "ABNORMAL_ITEM_WEIGHT" });
    await machineEvent(machineRejected.session.id, "VANDALISM_DETECTED", { reason: "DOOR_FORCED" }, machineRejected.item.id);
    await machineEvent(machineRejected.session.id, "SENSOR_SEQUENCE",
      { steps: ["ITEM_PRESENT", "CHAMBER_OPEN"], reverseMotion: true }, machineRejected.item.id);
    expect(await itemOf(machineRejected.item.id)).toMatchObject({ status: "REJECTED", validationReasonCode: "ABNORMAL_ITEM_WEIGHT" });
    expect((await review(machineRejected.item.id, { action: "approve" })).status).toBe(409);
  });

  it("I1: a fraud event keeps an unknown-type item's reason, so approving still requires a waste type", async () => {
    await warmUp();
    const unknown = await detectOnly({ unknownType: true });
    expect(unknown.item).toMatchObject({ status: "REVIEW", validationReasonCode: "UNKNOWN_WASTE_TYPE" });
    await machineEvent(unknown.session.id, "FRAUD_DETECTED", { reason: "STRING_PULL" });
    await machineEvent(unknown.session.id, "SENSOR_SEQUENCE", { steps: ["ITEM_PRESENT"], reverseMotion: true }, unknown.item.id);
    expect(await itemOf(unknown.item.id)).toMatchObject({
      status: "REVIEW", validationReasonCode: "UNKNOWN_WASTE_TYPE", externalFraudFlag: true });
    // Fix round 3 (R1): nothing is approvable before the acceptance point.
    expect((await review(unknown.item.id, { action: "approve" })).status).toBe(409);
    await machineEvent(unknown.session.id, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true }, unknown.item.id);
    expect(await itemOf(unknown.item.id)).toMatchObject({ status: "REVIEW", validationReasonCode: "UNKNOWN_WASTE_TYPE" });
    const approve = await review(unknown.item.id, { action: "approve" });
    expect(approve.status).toBe(422);
    expect(approve.body.error).toBe("wasteTypeId wajib diisi untuk item tanpa jenis sampah");
  });

  it("C1: machine reasons can never forge a reviewer's decision", async () => {
    await warmUp();
    // A held item: the machine claims it was "REVIEW_REJECTED".
    const held = await deposit({ anomaly: true });
    expect(held.ledger).toEqual([expect.objectContaining({ status: "PENDING", amount: 50 })]);
    await machineEvent(held.session.id, "ITEM_REJECTED", { reason: "REVIEW_REJECTED" }, held.item.id);
    expect((await itemOf(held.item.id)).status).toBe("REVIEW");
    const rejected = await review(held.item.id, { action: "reject" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.idempotent).toBe(false);
    expect(await f.db.rewardLedger.findMany({ where: { depositItemId: held.item.id } }))
      .toEqual([expect.objectContaining({ entryType: "EARN", status: "REJECTED", amount: 50 })]);
    expect((await getWalletBalance(f.ids.userA)).pending).toBe(0);

    // A pending item rejected by the machine with a forged code is namespaced, never "reviewed".
    const pending = await detectOnly();
    await machineEvent(pending.session.id, "ITEM_REJECTED", { reason: "REVIEW_REJECTED" }, pending.item.id);
    expect(await itemOf(pending.item.id)).toMatchObject({ status: "REJECTED", validationReasonCode: "MACHINE_REVIEW_REJECTED" });
    const replay = await review(pending.item.id, { action: "reject" });
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe("Item sudah berstatus REJECTED, tidak lagi menunggu peninjauan");

    // A fraud reason claiming approval still leaves the item for a real review.
    const paid = await deposit();
    await machineEvent(paid.session.id, "FRAUD_DETECTED", { reason: "REVIEW_APPROVED" }, paid.item.id);
    expect(await itemOf(paid.item.id)).toMatchObject({ status: "REVIEW", validationReasonCode: "MACHINE_REVIEW_APPROVED" });
    const approved = await review(paid.item.id, { action: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.idempotent).toBe(false);
  });

  it("C2: ITEM_REJECTED never flips an accepted, held or reviewed item", async () => {
    await warmUp();
    const paid = await deposit();
    await machineEvent(paid.session.id, "ITEM_REJECTED", { reason: "ACTUATION_BLOCKED" }, paid.item.id);
    expect(await itemOf(paid.item.id)).toMatchObject({ status: "ACCEPTED", validationReasonCode: "ACCEPTED" });
    expect(await f.db.rewardLedger.findMany({ where: { depositItemId: paid.item.id } }))
      .toEqual([expect.objectContaining({ status: "AVAILABLE", amount: 100 })]);

    const reviewed = await deposit({ anomaly: true });
    expect((await review(reviewed.item.id, { action: "approve" })).status).toBe(200);
    await machineEvent(reviewed.session.id, "ITEM_REJECTED", { reason: "ACTUATION_BLOCKED" }, reviewed.item.id);
    expect(await itemOf(reviewed.item.id)).toMatchObject({ status: "ACCEPTED", validationReasonCode: "REVIEW_APPROVED" });

    // A pending item is still rejected normally, and a late acceptance point never pays it.
    const pending = await detectOnly();
    await machineEvent(pending.session.id, "ITEM_REJECTED", { reason: "ABNORMAL_ITEM_WEIGHT" }, pending.item.id);
    expect(await itemOf(pending.item.id)).toMatchObject({ status: "REJECTED", validationReasonCode: "ABNORMAL_ITEM_WEIGHT" });
    await machineEvent(pending.session.id, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true }, pending.item.id);
    expect(await f.db.rewardLedger.count({ where: { depositItemId: pending.item.id } })).toBe(0);
    expect((await getWalletBalance(f.ids.userA)).available).toBe(200);
  });

  it("C2: ITEM_REJECTED takes the recipient's User lock before the session and item", async () => {
    await warmUp();
    const pending = await detectOnly();
    const rejectEvent = edgeEvent(pending.session.id, "ITEM_REJECTED", { reason: "ABNORMAL_ITEM_WEIGHT" });
    rejectEvent.depositItemId = pending.item.id;
    const observer = await f.connection();
    const holder = await holdLock((tx) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${f.ids.userA} FOR NO KEY UPDATE`);
    let sent: Promise<{ status: number; body: Json }> | undefined;
    try {
      sent = postBatch([rejectEvent]);
      sent.catch(() => {});
      await waitForBlockedBy(observer, { holderPid: holder.pid, timeoutMs: 15_000 });
      expect(await isStillPending(sent, 200)).toBe(true);
      expect(await rowLockFree(observer, "DepositSession", pending.session.id)).toBe(true);
      expect(await rowLockFree(observer, "DepositItem", pending.item.id)).toBe(true);
    } finally {
      await holder.release();
    }
    expect((await sent!).body.results[0].status).toBe("accepted");
    expect((await itemOf(pending.item.id)).status).toBe("REJECTED");
  });

  it("C3: an unknown-type item is held for review with no money, whatever the fallback type or weight", async () => {
    await warmUp();
    // An admin gave the shared fallback type a default reward: it must still never pay.
    await f.db.wasteType.create({
      data: { name: UNKNOWN_WASTE_TYPE_NAME, unit: "ITEM", active: false, defaultRewardPerItem: 500 } });
    for (const weightGrams of [25, null]) {
      const unknown = await detectOnly({ unknownType: true, weightGrams });
      expect((await machineEvent(unknown.session.id, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true }, unknown.item.id)).status)
        .toBe("accepted");
      expect(await itemOf(unknown.item.id)).toMatchObject({
        status: "REVIEW", validationReasonCode: "UNKNOWN_WASTE_TYPE", rewardAmount: 0, baseRewardAmount: 0 });
      expect(await f.db.rewardLedger.count({ where: { depositItemId: unknown.item.id } })).toBe(0);
    }
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 0, pending: 0 });
  });
});

describe("review approvals price verified, frozen inputs (M04 fix round 2)", () => {
  const review = (id: string, body: Record<string, unknown>) => call("adminA", "PATCH", `/api/deposit-reviews/${id}`, body);
  const itemOf = (id: string) => f.db.depositItem.findUniqueOrThrow({ where: { id } });
  const send = async (sessionId: string, eventType: string, payload: Record<string, unknown>, depositItemId?: string) => {
    const event = edgeEvent(sessionId, eventType, payload);
    if (depositItemId) event.depositItemId = depositItemId;
    const res = await postBatch([event]);
    expect(res.body.results[0].status).toBe("accepted");
  };
  async function unknownItem(weightGrams: number | null) {
    const session = await openSession({
      data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE" } });
    const events = [edgeEvent(session.id, "ITEM_DETECTED", { quantity: 1, inputBeam: true })];
    if (weightGrams !== null) events.push(edgeEvent(session.id, "WEIGHT_MEASURED", { weightGrams, stable: true }));
    events.push(edgeEvent(session.id, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true }));
    expect((await postBatch(events)).body.results.map((r: Json) => r.status)).toEqual(events.map(() => "accepted"));
    const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: session.id } });
    expect(item).toMatchObject({ status: "REVIEW", validationReasonCode: "UNKNOWN_WASTE_TYPE", rewardAmount: 0 });
    return { session, item };
  }
  /** A KG waste type on the fixture machine: Rp2.000/kg, window 10-1.000 g. */
  async function kgWasteType() {
    const type = await f.db.wasteType.create({ data: { name: "Kaleng Audit KG", unit: "KG", active: true } });
    await f.db.machineWasteType.create({ data: { machineId: f.ids.machineA, wasteTypeId: type.id, active: true } });
    await f.db.rewardRate.create({ data: {
      organizationId: f.ids.orgA, wasteTypeId: type.id, unit: "KG", pointsPerItem: 2_000,
      minWeightGrams: 10, maxWeightGrams: 1_000, active: true } });
    return type.id;
  }

  it("A1: approval refuses the fallback (unknown) waste type, however it is named", async () => {
    await warmUp();
    const fallback = await f.db.wasteType.create({
      data: { name: UNKNOWN_WASTE_TYPE_NAME, unit: "ITEM", active: false, defaultRewardPerItem: 500 } });
    const { item } = await unknownItem(25);
    expect(item.wasteTypeId).toBe(fallback.id);
    const refused = await review(item.id, { action: "approve", wasteTypeId: fallback.id });
    expect(refused.status).toBe(422);
    expect(refused.body.error).toBe("Jenis sampah cadangan tidak dapat disetujui. Pilih jenis sampah yang sebenarnya.");
    // A legacy row whose reason was overwritten is still recognized by its type.
    await f.db.depositItem.update({ where: { id: item.id }, data: { validationReasonCode: "REVERSE_MOTION" } });
    expect((await review(item.id, { action: "approve" })).status).toBe(422);
    expect((await review(item.id, { action: "approve", wasteTypeId: fallback.id })).status).toBe(422);
    expect(await itemOf(item.id)).toMatchObject({ status: "REVIEW", rewardAmount: 0 });
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA } })).toBe(0);

    // A concrete type with a valid weight is approved and priced from that type.
    const approved = await review(item.id, { action: "approve", wasteTypeId: await fixtureWasteTypeId() });
    expect(approved.status).toBe(200);
    expect(approved.body.targetAmount).toBe(100);
  });

  it("A2: approval validates the weight against the assigned type: a missing weight is never valid", async () => {
    await warmUp();
    const { item } = await unknownItem(null);
    const missing = await review(item.id, { action: "approve", wasteTypeId: await fixtureWasteTypeId() });
    expect(missing.status).toBe(422);
    expect(missing.body.error).toBe("Berat setoran tidak tercatat. Item tanpa berat tidak dapat disetujui; tolak item ini.");
    expect(await itemOf(item.id)).toMatchObject({ status: "REVIEW", rewardAmount: 0 });
    expect((await review(item.id, { action: "reject" })).status).toBe(200);

    // Out of the assigned type's window (the rate window wins over the type window).
    await f.db.rewardRate.updateMany({ where: { organizationId: f.ids.orgA }, data: { minWeightGrams: 10, maxWeightGrams: 100 } });
    const heavy = await unknownItem(500);
    const outOfWindow = await review(heavy.item.id, { action: "approve", wasteTypeId: await fixtureWasteTypeId() });
    expect(outOfWindow.status).toBe(422);
    expect(outOfWindow.body.error).toBe("Berat setoran di luar batas jenis sampah yang dipilih. Tolak item ini atau pilih jenis sampah yang sesuai.");
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA } })).toBe(0);

    const inWindow = await unknownItem(50);
    const ok = await review(inWindow.item.id, { action: "approve", wasteTypeId: await fixtureWasteTypeId() });
    expect(ok.status).toBe(200);
    expect(ok.body.targetAmount).toBe(100);
  });

  it("A3: machine writes after acceptance cannot change the evidence a review prices from", async () => {
    await warmUp();
    const kg = await kgWasteType();
    const held = await deposit({ wasteTypeId: kg, weightGrams: 250, anomaly: true });
    expect(held.item).toMatchObject({ status: "REVIEW", baseRewardAmount: 500, rewardAmount: 250, measuredWeightGrams: 250 });

    await send(held.session.id, "WEIGHT_MEASURED", { weightGrams: 950, stable: true }, held.item.id);
    await send(held.session.id, "IMAGE_CLASSIFIED", { detectedType: "paper", confidence: 0.99 }, held.item.id);
    await send(held.session.id, "BARCODE_READ", { barcode: "0000000000000" }, held.item.id);
    expect(await itemOf(held.item.id)).toMatchObject({ measuredWeightGrams: 250, aiDetectedType: null, barcodeValue: null });

    const approved = await review(held.item.id, { action: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.targetAmount).toBe(500);
    const rows = await f.db.rewardLedger.findMany({ where: { depositItemId: held.item.id } });
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(500);
  });

  it("A3: compaction is recorded only after acceptance; evidence only before it", async () => {
    await warmUp();
    const accepted = await deposit();
    await send(accepted.session.id, "COMPACTION_COMPLETED", {}, accepted.item.id);
    expect((await itemOf(accepted.item.id)).compactionStatus).toBe("COMPACTED");

    const session = await openSession({
      data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE" } });
    await send(session.id, "ITEM_DETECTED", { wasteTypeId: await fixtureWasteTypeId(), quantity: 1 });
    const pending = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: session.id } });
    await send(session.id, "COMPACTION_COMPLETED", {}, pending.id);
    await send(session.id, "WEIGHT_MEASURED", { weightGrams: 30 }, pending.id);
    await send(session.id, "IMAGE_CLASSIFIED", { detectedType: "bottle_pet", confidence: 0.9 }, pending.id);
    await send(session.id, "BARCODE_READ", { barcode: "8991002100012" }, pending.id);
    expect(await itemOf(pending.id)).toMatchObject({
      compactionStatus: "NOT_REQUIRED", measuredWeightGrams: 30, aiDetectedType: "bottle_pet", barcodeValue: "8991002100012" });
  });

  it("A3: evidence writes take the recipient's User lock before the session and item", async () => {
    await warmUp();
    const session = await openSession({
      data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE" } });
    await send(session.id, "ITEM_DETECTED", { wasteTypeId: await fixtureWasteTypeId(), quantity: 1 });
    const pending = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: session.id } });
    const weigh = edgeEvent(session.id, "WEIGHT_MEASURED", { weightGrams: 40 });
    weigh.depositItemId = pending.id;
    const observer = await f.connection();
    const holder = await holdLock((tx) => tx.$queryRaw`SELECT id FROM "User" WHERE id = ${f.ids.userA} FOR NO KEY UPDATE`);
    let sent: Promise<{ status: number; body: Json }> | undefined;
    try {
      sent = postBatch([weigh]);
      sent.catch(() => {});
      await waitForBlockedBy(observer, { holderPid: holder.pid, timeoutMs: 15_000 });
      expect(await rowLockFree(observer, "DepositSession", session.id)).toBe(true);
      expect(await rowLockFree(observer, "DepositItem", pending.id)).toBe(true);
    } finally {
      await holder.release();
    }
    expect((await sent!).body.results[0].status).toBe("accepted");
    expect((await itemOf(pending.id)).measuredWeightGrams).toBe(40);
  });
});

describe("approval needs the acceptance point and its recorded rate (M04 fix round 3)", () => {
  const review = (id: string, body: Record<string, unknown>) => call("adminA", "PATCH", `/api/deposit-reviews/${id}`, body);
  const itemOf = (id: string) => f.db.depositItem.findUniqueOrThrow({ where: { id } });
  const send = async (sessionId: string, eventType: string, payload: Record<string, unknown>, depositItemId?: string) => {
    const event = edgeEvent(sessionId, eventType, payload);
    if (depositItemId) event.depositItemId = depositItemId;
    expect((await postBatch([event])).body.results[0].status).toBe("accepted");
  };
  /** An unknown-type item before the acceptance point: already in the review queue (REVIEW). */
  async function unknownBeforeAcceptance(weightGrams: number) {
    const session = await openSession({
      data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE" } });
    await send(session.id, "ITEM_DETECTED", { quantity: 1, inputBeam: true });
    const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: session.id } });
    await send(session.id, "WEIGHT_MEASURED", { weightGrams }, item.id);
    expect(await itemOf(item.id)).toMatchObject({ status: "REVIEW", acceptanceEventId: null, measuredWeightGrams: weightGrams });
    return { session, item };
  }
  /** A KG type with no weight window: Rp2.000/kg, so the weight alone sets the price. */
  async function unboundedKgType() {
    const type = await f.db.wasteType.create({ data: { name: "Logam Audit KG", unit: "KG", active: true } });
    await f.db.rewardRate.create({ data: {
      organizationId: f.ids.orgA, wasteTypeId: type.id, unit: "KG", pointsPerItem: 2_000, active: true,
      effectiveFrom: new Date(Date.now() - 86_400_000) } });
    return type.id;
  }
  const NOT_ACCEPTED = "Item belum melewati titik penerimaan mesin. Tunggu hingga mesin menyelesaikan setoran, atau tolak item ini.";

  it("R1: an item in review before the acceptance point cannot be approved, whatever the machine reports next", async () => {
    await warmUp();
    const kg = await unboundedKgType();
    const { session, item } = await unknownBeforeAcceptance(250);
    const early = await review(item.id, { action: "approve", wasteTypeId: kg });
    expect(early.status).toBe(409);
    expect(early.body.error).toBe(NOT_ACCEPTED);

    // The machine can still record evidence before acceptance, but nothing is priced from it.
    await send(session.id, "WEIGHT_MEASURED", { weightGrams: 5_000_000 }, item.id);
    expect((await review(item.id, { action: "approve", wasteTypeId: kg })).status).toBe(409);
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA } })).toBe(0);

    // The machine returns the item: it ends REJECTED with nothing paid.
    await send(session.id, "ITEM_REJECTED", { reason: "ABNORMAL_ITEM_WEIGHT" }, item.id);
    expect(await itemOf(item.id)).toMatchObject({ status: "REJECTED", validationReasonCode: "ABNORMAL_ITEM_WEIGHT", rewardAmount: 0 });
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA } })).toBe(0);
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 0, pending: 0 });
  });

  it("R1: a pre-acceptance item can still be rejected by a reviewer", async () => {
    await warmUp();
    const { item } = await unknownBeforeAcceptance(250);
    const rejected = await review(item.id, { action: "reject" });
    expect(rejected.status).toBe(200);
    expect(rejected.body.item).toMatchObject({ status: "REJECTED", validationReasonCode: "REVIEW_REJECTED" });
  });

  it("R1: evidence freezes at the acceptance point, exactly when approval becomes possible", async () => {
    await warmUp();
    const kg = await unboundedKgType();
    const { session, item } = await unknownBeforeAcceptance(250);
    await send(session.id, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true }, item.id);
    await send(session.id, "WEIGHT_MEASURED", { weightGrams: 5_000_000 }, item.id);
    expect(await itemOf(item.id)).toMatchObject({ status: "REVIEW", measuredWeightGrams: 250 });
    const approved = await review(item.id, { action: "approve", wasteTypeId: kg });
    expect(approved.status).toBe(200);
    expect(approved.body.targetAmount).toBe(500);
  });

  it("R2: a held item is validated and priced against the rate recorded at acceptance", async () => {
    await warmUp();
    const original = await f.db.rewardRate.findFirstOrThrow({ where: { organizationId: f.ids.orgA } });
    await f.db.rewardRate.update({ where: { id: original.id }, data: { minWeightGrams: 10, maxWeightGrams: 100,
      effectiveFrom: new Date(Date.now() - 86_400_000) } });
    const held = await deposit({ weightGrams: 50, anomaly: true });
    expect(held.item).toMatchObject({ status: "REVIEW", rewardRateId: original.id, rewardAmount: 50 });

    // The organization supersedes the rate: narrower window, new price.
    const now = new Date();
    await f.db.rewardRate.update({ where: { id: original.id }, data: { effectiveTo: now } });
    await f.db.rewardRate.create({ data: {
      organizationId: f.ids.orgA, wasteTypeId: await fixtureWasteTypeId(), unit: "ITEM", pointsPerItem: 300,
      minWeightGrams: 60, maxWeightGrams: 100, active: true, effectiveFrom: now } });

    const approved = await review(held.item.id, { action: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.targetAmount).toBe(100);
    expect(approved.body.item.rewardRateId).toBe(original.id);
    const rows = await f.db.rewardLedger.findMany({ where: { depositItemId: held.item.id } });
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(100);
  });

  it("R2: the recorded rate wins even if it was deactivated and a back-dated rate replaced it", async () => {
    await warmUp();
    const original = await f.db.rewardRate.findFirstOrThrow({ where: { organizationId: f.ids.orgA } });
    const yesterday = new Date(Date.now() - 86_400_000);
    await f.db.rewardRate.update({ where: { id: original.id }, data: { minWeightGrams: 10, maxWeightGrams: 100, effectiveFrom: yesterday } });
    const held = await deposit({ weightGrams: 50, anomaly: true });
    expect(held.item.rewardRateId).toBe(original.id);

    // Deactivated (not expired) and replaced by a rate whose window covers the acceptance time too.
    await f.db.rewardRate.update({ where: { id: original.id }, data: { active: false } });
    await f.db.rewardRate.create({ data: {
      organizationId: f.ids.orgA, wasteTypeId: await fixtureWasteTypeId(), unit: "ITEM", pointsPerItem: 300,
      minWeightGrams: 60, maxWeightGrams: 100, active: true, effectiveFrom: yesterday } });

    const approved = await review(held.item.id, { action: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.targetAmount).toBe(100);
  });
});

describe("legacy review rows and recorded-rate drift (M04 fix round 4)", () => {
  const review = (as: ActorKey, id: string, body: Record<string, unknown>) =>
    call(as, "PATCH", `/api/deposit-reviews/${id}`, body);
  const itemOf = (id: string) => f.db.depositItem.findUniqueOrThrow({ where: { id } });
  const ledgerOf = async (itemId: string) =>
    (await f.db.rewardLedger.findMany({ where: { depositItemId: itemId }, orderBy: { createdAt: "asc" } }))
      .map((row) => ({ entryType: row.entryType, status: row.status, amount: row.amount, businessKey: row.businessKey }));
  const inventory = () =>
    f.db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return collectWalletInventory(tx);
    }, { isolationLevel: "RepeatableRead" });
  const send = async (sessionId: string, eventType: string, payload: Record<string, unknown>, depositItemId?: string) => {
    const event = edgeEvent(sessionId, eventType, payload);
    if (depositItemId) event.depositItemId = depositItemId;
    expect((await postBatch([event])).body.results[0].status).toBe("accepted");
  };
  const DAY = 86_400_000;

  /**
   * A row shaped like production data from before M04: in REVIEW without the
   * acceptance contract's fields. `earn` is the hold or earning it carries.
   */
  async function legacyRow(options: {
    sessionStatus?: "ACTIVE" | "COMPLETED" | "EXPIRED" | "CANCELLED";
    status?: "REVIEW" | "ACCEPTED";
    acceptanceEventId?: string | null;
    acceptedAt?: Date | null;
    rewardRateId?: string | null;
    campaignId?: string | null;
    earn?: { amount: number; status: "PENDING" | "AVAILABLE" } | null;
    createdAt?: Date;
  } = {}) {
    const wasteTypeId = await fixtureWasteTypeId();
    const sessionStatus = options.sessionStatus ?? "COMPLETED";
    const session = await openSession({ data: {
      userId: f.ids.userA, machineId: f.ids.machineA, status: sessionStatus, campaignId: options.campaignId ?? null,
      completedAt: sessionStatus === "ACTIVE" ? null : new Date() } });
    const earn = options.earn === undefined ? { amount: 50, status: "PENDING" as const } : options.earn;
    const item = await f.db.depositItem.create({ data: {
      sessionId: session.id, wasteTypeId, quantity: 1, measuredWeightGrams: 25, status: options.status ?? "REVIEW",
      validationReasonCode: "ANOMALY_REVIEW", complianceMultiplier: 0.5, baseRewardAmount: 100,
      rewardAmount: earn?.amount ?? 0, source: "MACHINE", createdAt: options.createdAt ?? new Date(Date.now() - 2 * DAY),
      acceptanceEventId: options.acceptanceEventId ?? null, acceptedAt: options.acceptedAt ?? null,
      rewardRateId: options.rewardRateId ?? null } });
    if (earn) {
      await f.db.rewardLedger.create({ data: {
        userId: f.ids.userA, organizationId: f.ids.orgA, sessionId: session.id, depositItemId: item.id,
        entryType: "EARN", amount: earn.amount, status: earn.status, reasonCode: "ANOMALY_REVIEW",
        referenceType: "DepositItem", referenceId: item.id, businessKey: earnKey(item.id) } });
    }
    return { session, item };
  }

  it("N1: a legacy hold recorded at an expired campaign rate is approved at the rate in effect at acceptance, and the drift is inventoried", async () => {
    await warmUp();
    const campaignId = await machineCampaignId();
    const acceptedAt = new Date(Date.now() - DAY);
    // The old spread query recorded this: active, but its window closed before the acceptance.
    const expired = await f.db.rewardRate.create({ data: {
      organizationId: f.ids.orgA, campaignId, wasteTypeId: await fixtureWasteTypeId(), unit: "ITEM", pointsPerItem: 900,
      active: true, effectiveFrom: new Date(Date.now() - 30 * DAY), effectiveTo: new Date(Date.now() - 10 * DAY) } });
    const orgRate = await f.db.rewardRate.findFirstOrThrow({ where: { organizationId: f.ids.orgA, campaignId: null } });
    await f.db.rewardRate.update({ where: { id: orgRate.id }, data: { effectiveFrom: new Date(Date.now() - 30 * DAY) } });
    const { item } = await legacyRow({
      campaignId, acceptanceEventId: `evt-${randomUUID()}`, acceptedAt, rewardRateId: expired.id, earn: { amount: 450, status: "PENDING" } });

    const before = await inventory();
    expect(before.reviewItemsWithRateOutsideAcceptance).toEqual([expect.objectContaining({
      depositItemId: item.id, userId: f.ids.userA, rewardRateId: expired.id, rateActive: true, pending: 450 })]);
    expect(before.summary.reviewItemsWithRateOutsideAcceptance).toBe(1);

    const approved = await review("adminA", item.id, { action: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.targetAmount).toBe(100);
    expect(approved.body.item).toMatchObject({ status: "ACCEPTED", rewardRateId: orgRate.id, rewardAmount: 100 });
    expect(await ledgerOf(item.id)).toEqual([
      { entryType: "EARN", status: "AVAILABLE", amount: 450, businessKey: earnKey(item.id) },
      { entryType: "ADJUST", status: "AVAILABLE", amount: -350, businessKey: `review:${item.id}:decision:v1` },
    ]);
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 100, pending: 0 });
    expect((await inventory()).reviewItemsWithRateOutsideAcceptance).toEqual([]);
  });

  it("N2: a pre-acceptance row of an ended session is reject-only for admins and the 409 never says to wait", async () => {
    await warmUp();
    const { item } = await legacyRow({ sessionStatus: "COMPLETED" });
    const refused = await review("adminA", item.id, { action: "approve" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe(REVIEW_LEGACY_ROW);
    expect(refused.body.error).not.toMatch(/tunggu/i);
    expect((await review("adminA", item.id, { action: "approve", legacy: true })).status).toBe(403);
    expect((await review("adminA", item.id, { action: "approve", legacy: true })).body.error).toBe(REVIEW_LEGACY_SUPERADMIN_ONLY);
    expect(await itemOf(item.id)).toMatchObject({ status: "REVIEW", acceptanceEventId: null });

    // While the session is still running the machine may still accept the item.
    const open = await legacyRow({ sessionStatus: "ACTIVE" });
    expect((await review("adminA", open.item.id, { action: "approve" })).body.error).toBe(REVIEW_NOT_ACCEPTED);
    const tooEarly = await review("superadmin", open.item.id, { action: "approve", legacy: true });
    expect(tooEarly.status).toBe(409);
    expect(tooEarly.body.error).toBe(REVIEW_LEGACY_SESSION_OPEN);

    // Rejecting a legacy row stays available to admins.
    const rejected = await review("adminA", item.id, { action: "reject" });
    expect(rejected.status).toBe(200);
    expect(await ledgerOf(item.id)).toEqual([{ entryType: "EARN", status: "REJECTED", amount: 50, businessKey: earnKey(item.id) }]);
  });

  it("N2: a superadmin legacy approval records the marker, prices at the recorded time with the fixed query and is audited once", async () => {
    await warmUp();
    const createdAt = new Date(Date.now() - 3 * DAY);
    const orgRate = await f.db.rewardRate.findFirstOrThrow({ where: { organizationId: f.ids.orgA, campaignId: null } });
    await f.db.rewardRate.update({ where: { id: orgRate.id }, data: { effectiveFrom: new Date(Date.now() - 30 * DAY) } });
    // A rate created after the item (not retroactive): the legacy approval prices as of createdAt.
    await f.db.rewardRate.create({ data: {
      organizationId: f.ids.orgA, wasteTypeId: await fixtureWasteTypeId(), unit: "ITEM", pointsPerItem: 999, active: true,
      effectiveFrom: new Date(Date.now() - DAY) } });
    const { item } = await legacyRow({ sessionStatus: "EXPIRED", createdAt });

    const listed = await inventory();
    expect(listed.reviewItemsWithoutAcceptance).toEqual([expect.objectContaining({
      depositItemId: item.id, userId: f.ids.userA, sessionStatus: "EXPIRED", sessionEnded: true,
      problem: "NO_ACCEPTANCE_EVENT", pending: 50, netAvailable: 0 })]);

    expect((await review("superadmin", item.id, { action: "approve" })).body.error).toBe(REVIEW_LEGACY_ROW);
    const approved = await review("superadmin", item.id, { action: "approve", legacy: true, note: "sesi lama" });
    expect(approved.status).toBe(200);
    expect(approved.body.targetAmount).toBe(100);
    expect(approved.body.item).toMatchObject({
      status: "ACCEPTED", validationReasonCode: "REVIEW_APPROVED", rewardAmount: 100, rewardRateId: orgRate.id });
    expect(approved.body.item.acceptanceEventId).toBe(`${LEGACY_ACCEPTANCE_PREFIX}${f.ids.superadmin}`);
    expect(new Date(approved.body.item.acceptedAt).getTime()).toBe(createdAt.getTime());
    expect(await ledgerOf(item.id)).toEqual([
      { entryType: "EARN", status: "AVAILABLE", amount: 50, businessKey: earnKey(item.id) },
      { entryType: "ADJUST", status: "AVAILABLE", amount: 50, businessKey: `review:${item.id}:decision:v1` },
    ]);
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 100, pending: 0 });

    const audits = await f.db.auditLog.findMany({ where: { entityType: "DepositItem", entityId: item.id } });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: f.ids.superadmin, action: "DEPOSIT_REVIEW_APPROVED" });
    expect(audits[0].metadataJson).toMatchObject({ legacyApproval: true, sessionStatus: "EXPIRED", measuredWeightGrams: 25, rewardAmount: 100 });
    expect(new Date((audits[0].metadataJson as Json).pricedAt).getTime()).toBe(createdAt.getTime());

    // Replays are idempotent for either approval; the opposite decision is refused; nothing is listed any more.
    expect((await review("superadmin", item.id, { action: "approve", legacy: true })).body.idempotent).toBe(true);
    expect((await review("adminA", item.id, { action: "approve" })).body.idempotent).toBe(true);
    expect((await review("adminA", item.id, { action: "reject" })).status).toBe(409);
    expect(await f.db.auditLog.count({ where: { entityType: "DepositItem", entityId: item.id } })).toBe(1);
    const after = await inventory();
    expect(after.reviewItemsWithoutAcceptance).toEqual([]);
    expect(after.acceptedItemsWithoutAcceptance).toEqual([]);
    // An ordinary accepted row cannot be approved "as legacy".
    const held = await deposit({ anomaly: true });
    const ordinary = await review("superadmin", held.item.id, { action: "approve", legacy: true });
    expect(ordinary.status).toBe(422);
    expect(ordinary.body.error).toBe(REVIEW_NOT_LEGACY);
  });

  it("N4: an acceptance event without an acceptance time is a legacy row: fail closed, then priced at its recorded time", async () => {
    await warmUp();
    const createdAt = new Date(Date.now() - 2 * DAY);
    const orgRate = await f.db.rewardRate.findFirstOrThrow({ where: { organizationId: f.ids.orgA, campaignId: null } });
    await f.db.rewardRate.update({ where: { id: orgRate.id }, data: { effectiveFrom: new Date(Date.now() - 30 * DAY) } });
    const eventId = `evt-${randomUUID()}`;
    const { item } = await legacyRow({ sessionStatus: "COMPLETED", acceptanceEventId: eventId, acceptedAt: null, createdAt, earn: null });

    expect((await inventory()).reviewItemsWithoutAcceptance).toEqual([expect.objectContaining({
      depositItemId: item.id, problem: "NO_ACCEPTANCE_TIME", sessionEnded: true, pending: 0, ledgerIds: [] })]);
    const refused = await review("adminA", item.id, { action: "approve" });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe(REVIEW_LEGACY_ROW);
    expect(await ledgerOf(item.id)).toEqual([]);

    const approved = await review("superadmin", item.id, { action: "approve", legacy: true });
    expect(approved.status).toBe(200);
    expect(approved.body.targetAmount).toBe(100);
    // The real event id is kept; only the missing time is filled with the time the price was resolved at.
    expect(approved.body.item).toMatchObject({ acceptanceEventId: eventId, rewardRateId: orgRate.id });
    expect(new Date(approved.body.item.acceptedAt).getTime()).toBe(createdAt.getTime());
    expect(await ledgerOf(item.id)).toEqual([
      { entryType: "EARN", status: "AVAILABLE", amount: 100, businessKey: `review:${item.id}:decision:v1` },
    ]);
  });

  it("N2: a legacy ACCEPTED row is inventoried as fraud exposure; a fraud hold moves it to the legacy review path", async () => {
    await warmUp();
    const orgRate = await f.db.rewardRate.findFirstOrThrow({ where: { organizationId: f.ids.orgA, campaignId: null } });
    await f.db.rewardRate.update({ where: { id: orgRate.id }, data: { effectiveFrom: new Date(Date.now() - 30 * DAY) } });
    const { session, item } = await legacyRow({ status: "ACCEPTED", earn: { amount: 100, status: "AVAILABLE" } });
    await f.db.depositItem.update({ where: { id: item.id }, data: { validationReasonCode: "ACCEPTED", complianceMultiplier: 1 } });
    expect((await inventory()).acceptedItemsWithoutAcceptance).toEqual([expect.objectContaining({
      depositItemId: item.id, userId: f.ids.userA, sessionStatus: "COMPLETED", netAvailable: 100, pending: 0 })]);

    await send(session.id, "FRAUD_DETECTED", { reason: "STRING_PULL" }, item.id);
    expect(await itemOf(item.id)).toMatchObject({ status: "REVIEW", validationReasonCode: "STRING_PULL", acceptanceEventId: null });
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 0, pending: 100 });
    const listed = await inventory();
    expect(listed.acceptedItemsWithoutAcceptance).toEqual([]);
    expect(listed.reviewItemsWithoutAcceptance).toEqual([expect.objectContaining({
      depositItemId: item.id, problem: "NO_ACCEPTANCE_EVENT", sessionEnded: true, pending: 100 })]);

    expect((await review("adminA", item.id, { action: "approve" })).body.error).toBe(REVIEW_LEGACY_ROW);
    const approved = await review("superadmin", item.id, { action: "approve", legacy: true });
    expect(approved.status).toBe(200);
    expect(approved.body.targetAmount).toBe(100);
    expect(await ledgerOf(item.id)).toEqual([{ entryType: "EARN", status: "AVAILABLE", amount: 100, businessKey: earnKey(item.id) }]);
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 100, pending: 0 });
  });
});
