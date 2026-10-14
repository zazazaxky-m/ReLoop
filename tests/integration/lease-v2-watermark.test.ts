import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { GET as machineSessionRoute } from "@/app/api/machine-session/[code]/route";
import { signMachinePayload } from "@/lib/machine-auth";
import { MACHINE_LEASE_PROTOCOL_HEADER } from "@/lib/machine-auth-constants";
import { verifyLeaseV2 } from "@/lib/machine-lease";
import {
  PROGRAM_HAS_OPEN_SOURCES,
  guardOrganizationModeChange,
  guardProgramRewardChange,
  sessionAdmissionKey,
  sessionCloseWatermarkKey,
} from "@/lib/reward-funding";
import { startOrResumeDeposit } from "@/lib/deposit-session-service";
import type { CurrentUser } from "@/lib/rbac";
import type { AppRole } from "@/lib/roles";
import { sessionPolicyVersion } from "@/lib/session-policy";
import { f, type ActorKey } from "../support/audit-fixture";
import { machineLeaseV2 } from "../support/contracts";
import { deferred, isStillPending, waitForBlockedBy } from "../support/race-probe";

/**
 * B01b (BIZ-02, second half) against the real PostgreSQL, Redis and Next
 * server: the signed lease v2 binds the reservation, the admission policy
 * version and the caps; the user sees the limit before the first item; an
 * offline batch is priced from the admission snapshot; the residual hold is
 * released only after the RVM close watermark (keyed); a lost connection
 * retains the hold; and the real RVM worker stops at the bound, keeps its
 * consumed counter across a restart and sends the watermark.
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

const REPO_ROOT = path.resolve(__dirname, "../..");
const PYTHON = existsSync(path.join(REPO_ROOT, ".venv/bin/python"))
  ? path.join(REPO_ROOT, ".venv/bin/python")
  : process.env.RVM_PYTHON ?? "python3";

async function call(actor: ActorKey, method: string, urlPath: string, body?: unknown) {
  const response = await f.json(actor, method, urlPath, body);
  return { status: response.status, body: (await response.json().catch(() => null)) as Json };
}

const account = () => f.db.rewardFundingAccount.findUniqueOrThrow({ where: { organizationId: f.ids.orgA } });
const reservationOf = (businessKey: string) => f.db.rewardBudgetReservation.findUniqueOrThrow({ where: { businessKey } });
const commitOf = (businessKey: string) => f.db.rewardBudgetCommit.findUnique({ where: { businessKey } });
const earnKey = (itemId: string) => `deposit-item:${itemId}:earn`;
const sessionRow = (id: string) => f.db.depositSession.findUniqueOrThrow({ where: { id } });

async function actorOf(userId: string): Promise<CurrentUser> {
  const user = await f.db.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role as AppRole,
    organizationId: user.organizationId, organizationName: null, payoutEligible: false, status: user.status,
  } as CurrentUser;
}

async function withEnv<T>(name: string, value: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}
const withEnforced = <T,>(fn: () => Promise<T>) => withEnv("REWARD_FUNDING_ENFORCED", "true", fn);

async function machine() {
  return f.db.machine.findUniqueOrThrow({ where: { id: f.ids.machineA } });
}

function signedHeaders(secret: string, raw: string, extra: Record<string, string> = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replaceAll("-", "");
  return {
    "x-reloop-machine": f.ids.machineCode,
    "x-reloop-timestamp": timestamp,
    "x-reloop-nonce": nonce,
    "x-reloop-signature": signMachinePayload(secret, timestamp, nonce, raw),
    ...extra,
  };
}

/** The RVM's session-bridge poll; `protocol` is what rvm/sync.py announces. */
async function machineSession(protocol?: "2") {
  const m = await machine();
  const response = await fetch(new URL(`/api/machine-session/${f.ids.machineCode}`, process.env.AUDIT_BASE_URL), {
    headers: signedHeaders(m.ingestSecret ?? "", "", protocol ? { [MACHINE_LEASE_PROTOCOL_HEADER]: protocol } : {}),
  });
  return { status: response.status, body: (await response.json()) as Json };
}

/** The same poll served in-process (so this process's env, e.g. enforcement, applies). */
async function machineSessionInProcess(protocol?: "2") {
  const m = await machine();
  const request = new Request(`http://localhost/api/machine-session/${f.ids.machineCode}`, {
    headers: signedHeaders(m.ingestSecret ?? "", "", protocol ? { [MACHINE_LEASE_PROTOCOL_HEADER]: protocol } : {}),
  });
  const response = await machineSessionRoute(request, { params: Promise.resolve({ code: f.ids.machineCode }) });
  return { status: response.status, body: (await response.json()) as Json };
}

async function postBatch(events: EdgeEvent[]) {
  const m = await machine();
  const raw = JSON.stringify({ machineCode: m.machineCode, events });
  const response = await fetch(new URL("/api/machine-events", process.env.AUDIT_BASE_URL), {
    method: "POST",
    headers: { "content-type": "application/json", ...signedHeaders(m.ingestSecret ?? "", raw) },
    body: raw,
  });
  return { status: response.status, body: (await response.json()) as Json };
}

let clock = 0;
const EVENT_CLOCK_BASE = Date.now() - 60_000;
function edgeEvent(sessionId: string, eventType: string, payload: Record<string, unknown>, occurredAt?: Date): EdgeEvent {
  clock += 1;
  return {
    localEventId: randomUUID(), eventType, payload, sessionId, depositItemId: null,
    occurredAt: (occurredAt ?? new Date(EVENT_CLOCK_BASE + clock)).toISOString(),
  };
}

const fixtureWasteTypeId = async () => (await f.db.wasteType.findFirstOrThrow({ where: { name: "Botol Plastik Audit" } })).id;

async function depositEvents(sessionId: string, options: { anomaly?: boolean } = {}): Promise<EdgeEvent[]> {
  const wasteTypeId = await fixtureWasteTypeId();
  const events = [edgeEvent(sessionId, "ITEM_DETECTED", { wasteTypeId, quantity: 1, inputBeam: true })];
  events.push(edgeEvent(sessionId, "WEIGHT_MEASURED", { weightGrams: 25, stable: true }));
  if (options.anomaly) {
    events.push(edgeEvent(sessionId, "SENSOR_SEQUENCE", { steps: ["CHAMBER_OPEN", "ITEM_PRESENT"], reverseMotion: true }));
  }
  events.push(edgeEvent(sessionId, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true }));
  return events;
}

async function deposit(sessionId: string, options: { anomaly?: boolean } = {}) {
  const events = await depositEvents(sessionId, options);
  const res = await postBatch(events);
  expect(res.status).toBe(200);
  expect(res.body.results.map((r: Json) => r.status)).toEqual(events.map(() => "accepted"));
  const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId }, orderBy: { createdAt: "desc" } });
  const ledger = await f.db.rewardLedger.findMany({ where: { depositItemId: item.id }, orderBy: { createdAt: "asc" } });
  return { item, ledger, events };
}

async function scan(actor: ActorKey, options: { campaignId?: string } = {}) {
  const token = await f.machineQrToken();
  return call(actor, "POST", "/api/scan", { machineCode: f.ids.machineCode, token, ...(options.campaignId ? { campaignId: options.campaignId } : {}) });
}

const finishSession = (actor: ActorKey, sessionId: string) => call(actor, "PATCH", `/api/sessions/${sessionId}`, { action: "finish" });

const setMachineBounds = (data: { maxRewardPerSessionRupiah: number | null; maxItemsPerSession: number | null }) =>
  f.db.machine.update({ where: { id: f.ids.machineA }, data });

const moneyCampaign = (data: Partial<Prisma.CampaignUncheckedCreateInput> = {}) =>
  f.db.campaign.create({
    data: {
      organizationId: f.ids.orgA, name: "Program Berkuota", campaignType: "MACHINE_DEPOSIT", rewardMode: "MONEY_REWARD",
      status: "ACTIVE", startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000),
      rewardBudgetRupiah: 100_000, maxRewardPerSessionRupiah: 1_000, ...data,
    },
  });

/** What the RVM sends once every event of the session was ACKed (rvm/sync.py). */
async function serverWatermarkFacts(sessionId: string) {
  const events = await f.db.machineEvent.findMany({
    where: { machineId: f.ids.machineA, sessionId, eventType: { not: "SESSION_CLOSE_WATERMARK" } },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    select: { localEventId: true },
  });
  return { eventCount: events.length, lastLocalEventId: events.at(-1)?.localEventId ?? null };
}

function watermarkEvent(sessionId: string, facts: { eventCount: number; lastLocalEventId: string | null }, extra: Record<string, unknown> = {}) {
  return edgeEvent(sessionId, "SESSION_CLOSE_WATERMARK", { ...facts, consumedRupiah: 0, consumedItems: 0, ...extra }, new Date());
}

type ProgramShape = { rewardMode: string; rewardMultiplier: number | null; campaignType: string; supportsMachine: boolean };
const programShape = (c: ProgramShape): ProgramShape =>
  ({ rewardMode: c.rewardMode, rewardMultiplier: c.rewardMultiplier, campaignType: c.campaignType, supportsMachine: c.supportsMachine });

async function guardRaise(campaignId: string) {
  const c = await f.db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  return f.db.$transaction((tx) =>
    guardProgramRewardChange(tx, { campaignId, current: programShape(c), next: { ...programShape(c), rewardMultiplier: 2 } }, { enforced: true }));
}

async function warmUp() {
  expect((await postBatch([])).status).toBe(200);
  expect((await machineSession("2")).status).toBe(200);
  expect((await call("userA", "PATCH", "/api/sessions/missing", { action: "finish" })).status).toBe(404);
  expect((await call("userA", "GET", "/api/sessions/missing")).status).toBe(404);
}

// ---------------------------------------------------------------------------

describe("lease protocol v2 (B01b)", () => {
  it("shows the user the limit before the first item; the v2 lease binds the reservation, policy version and caps; renewal and a legacy session keep them", async () => {
    await warmUp();
    await setMachineBounds({ maxRewardPerSessionRupiah: 250, maxItemsPerSession: 3 });
    await f.confirmFunding(10_000);

    const started = await scan("userA");
    expect(started.status).toBe(201);
    expect(started.body.limits).toEqual({ maxRewardRupiah: 250, maxItems: 3 });
    const sessionId = started.body.session.id as string;
    const detail = await call("userA", "GET", `/api/sessions/${sessionId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.limits).toEqual({ maxRewardRupiah: 250, maxItems: 3 });
    const stored = await sessionRow(sessionId);
    expect(stored.policyVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.policySnapshotJson).toMatchObject({ version: 1, mode: "MONEY_REWARD", ceilingRupiah: 250, maxItems: 3 });
    const reservation = await reservationOf(sessionAdmissionKey(sessionId));

    const polled = await machineSession("2");
    expect(polled.status).toBe(200);
    expect(polled.body.leaseProtocol).toBe(2);
    const lease = machineLeaseV2.parse(polled.body.lease);
    expect(lease).toMatchObject({
      id: `lease-${sessionId}`, machineCode: f.ids.machineCode, sessionId, userRef: f.ids.userA,
      reservationId: reservation.id, ceilingRupiah: 250, maxItems: 3, policyVersion: stored.policyVersion,
      policy: { mode: "MONEY_REWARD", multiplierBps: 10000, wasteTypes: [{ id: await fixtureWasteTypeId(), unit: "ITEM", rewardPerUnit: 100, maxRewardRupiah: 100 }] },
    });
    expect(verifyLeaseV2((await machine()).ingestSecret ?? "", lease, f.ids.machineCode)).toEqual({ ok: true });
    expect(sessionPolicyVersion(lease.policy)).toBe(stored.policyVersion);
    expect(polled.body.session.limits).toEqual({ maxRewardRupiah: 250, maxItems: 3 });

    // Renewal keeps the reservation, the ceiling and the policy version.
    const renewed = machineLeaseV2.parse((await machineSession("2")).body.lease);
    expect(renewed).toMatchObject({ reservationId: reservation.id, ceilingRupiah: 250, maxItems: 3, policyVersion: stored.policyVersion });
    expect(renewed.issuedAt).toBeGreaterThanOrEqual(lease.issuedAt);
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ ceilingRupiah: 250, remainingRupiah: 250, status: "ACTIVE" });
    expect((await finishSession("userA", sessionId)).status).toBe(200);

    // A session admitted before B01b (no snapshot) gets one at its first v2 poll and is leased with it.
    const legacy = await f.db.depositSession.create({
      data: { userId: f.ids.userB, machineId: f.ids.machineA, status: "ACTIVE", timeoutAt: new Date(Date.now() + 120_000) },
    });
    const legacyLease = machineLeaseV2.parse((await machineSession("2")).body.lease);
    const upgraded = await sessionRow(legacy.id);
    expect(upgraded.policyVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(legacyLease).toMatchObject({ sessionId: legacy.id, policyVersion: upgraded.policyVersion, ceilingRupiah: 250, maxItems: 3, reservationId: null });
    expect(verifyLeaseV2((await machine()).ingestSecret ?? "", legacyLease, f.ids.machineCode)).toEqual({ ok: true });
  });

  it("a v1 worker keeps the v1 lease for compliance and shadow-mode money sessions; under enforcement a money session is refused to it", async () => {
    await warmUp();
    await setMachineBounds({ maxRewardPerSessionRupiah: 250, maxItemsPerSession: null });
    await f.confirmFunding(10_000);
    const money = await scan("userA");
    expect(money.status).toBe(201);

    const shadow = await machineSession();
    expect(shadow.body.lease).toMatchObject({ id: `lease-${money.body.session.id}`, sessionId: money.body.session.id });
    expect(shadow.body.lease.version).toBeUndefined();
    expect(shadow.body.leaseRefused).toBeUndefined();

    await withEnforced(async () => {
      const refused = await machineSessionInProcess();
      expect(refused.status).toBe(200);
      expect(refused.body).toMatchObject({ lease: null, session: null, leaseRefused: "LEASE_PROTOCOL_V2_REQUIRED" });
      const served = await machineSessionInProcess("2");
      expect(served.body.lease).toMatchObject({ version: 2, sessionId: money.body.session.id, ceilingRupiah: 250 });
    });
    expect((await finishSession("userA", money.body.session.id)).status).toBe(200);

    await f.db.organization.update({ where: { id: f.ids.orgA }, data: { machineRewardMode: "COMPLIANCE_ONLY" } });
    const compliance = await scan("userB");
    expect(compliance.status).toBe(201);
    expect(compliance.body.limits).toEqual({ maxRewardRupiah: null, maxItems: null });
    await withEnforced(async () => {
      const v1 = await machineSessionInProcess();
      expect(v1.body.lease).toMatchObject({ sessionId: compliance.body.session.id });
      expect(v1.body.lease.version).toBeUndefined();
      expect(v1.body.leaseRefused).toBeUndefined();
      const v2 = await machineSessionInProcess("2");
      expect(v2.body.lease).toMatchObject({ version: 2, reservationId: null, ceilingRupiah: null, maxItems: null });
      expect(v2.body.lease.policy.mode).toBe("COMPLIANCE_ONLY");
    });
  });
});

describe("admission snapshot (B01b)", () => {
  it("an offline batch after a rate change is priced from the admission snapshot; a duplicate localEventId never consumes funding again", async () => {
    await warmUp();
    await setMachineBounds({ maxRewardPerSessionRupiah: 10_000, maxItemsPerSession: null });
    await f.confirmFunding(50_000);
    const wasteTypeId = await fixtureWasteTypeId();
    const admitted = await scan("userA");
    const sessionId = admitted.body.session.id as string;
    const snapshot = (await sessionRow(sessionId)).policySnapshotJson as Json;
    expect(snapshot.wasteTypes).toEqual([expect.objectContaining({ id: wasteTypeId, rewardPerUnit: 100 })]);

    // The operator raises the rate while the machine is offline with the items already accepted.
    await f.db.rewardRate.updateMany({ where: { organizationId: f.ids.orgA, wasteTypeId }, data: { pointsPerItem: 500 } });
    const offline = await deposit(sessionId);
    expect(offline.item).toMatchObject({ status: "ACCEPTED", rewardAmount: 100, baseRewardAmount: 100 });
    expect(offline.ledger.map((row) => row.amount)).toEqual([100]);
    expect(await commitOf(earnKey(offline.item.id))).toMatchObject({ heldRupiah: 100, uncoveredRupiah: 0 });
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ remainingRupiah: 9_900 });

    // The same batch again (lost ACK): duplicates, nothing consumed again.
    const replay = await postBatch(offline.events);
    expect(replay.body.results.map((r: Json) => r.status)).toEqual(offline.events.map(() => "duplicate"));
    expect(await f.db.rewardBudgetCommit.count()).toBe(1);
    expect(await f.db.rewardLedger.count({ where: { sessionId } })).toBe(1);
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ remainingRupiah: 9_900 });
    expect(await account()).toMatchObject({ heldRupiah: 10_000 });
    expect((await finishSession("userA", sessionId)).status).toBe(200);

    // A session admitted after the change snapshots the new rate: the change is live for new admissions only.
    const later = await scan("userA");
    const laterSnapshot = (await sessionRow(later.body.session.id)).policySnapshotJson as Json;
    expect(laterSnapshot.wasteTypes).toEqual([expect.objectContaining({ id: wasteTypeId, rewardPerUnit: 500 })]);
    const priced = await deposit(later.body.session.id);
    expect(priced.item.rewardAmount).toBe(500);
  });
});

describe("close watermark (B01b)", () => {
  it("releases the residual hold only after the RVM close watermark, keyed: a count mismatch is refused and a retry never releases twice", async () => {
    await warmUp();
    await setMachineBounds({ maxRewardPerSessionRupiah: 1_000, maxItemsPerSession: null });
    await f.confirmFunding(10_000);
    const started = await scan("userA");
    const sessionId = started.body.session.id as string;
    const { item } = await deposit(sessionId);
    expect(item.status).toBe("ACCEPTED");
    expect((await finishSession("userA", sessionId)).status).toBe(200);

    // Ended, not watermarked: the residue is retained and reported.
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "ACTIVE", remainingRupiah: 900 });
    expect(await account()).toMatchObject({ heldRupiah: 1_000 });
    const report = await call("superadmin", "GET", "/api/reports/reconciliation");
    const org = report.body.report.funding.organizations.find((row: Json) => row.organizationId === f.ids.orgA);
    expect(org.staleHolds).toEqual([expect.objectContaining({ sourceId: sessionId, reasons: ["SOURCE_CLOSED_AWAITING_WATERMARK"] })]);

    const facts = await serverWatermarkFacts(sessionId);
    expect(facts.eventCount).toBe(3);
    // The RVM claims more events than the server holds: refused permanently, hold kept.
    const mismatch = await postBatch([watermarkEvent(sessionId, { ...facts, eventCount: facts.eventCount + 1 })]);
    expect(mismatch.body.results[0]).toMatchObject({ status: "error", error: "EVENT_REJECTED", retryable: false });
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "ACTIVE", remainingRupiah: 900 });
    expect((await sessionRow(sessionId)).closeWatermarkAt).toBeNull();

    const mark = watermarkEvent(sessionId, facts, { consumedRupiah: 100, consumedItems: 1 });
    const accepted = await postBatch([mark]);
    expect(accepted.body.results[0]).toMatchObject({ status: "accepted" });
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({
      status: "RELEASED", remainingRupiah: 0, releaseReason: "CLOSE_WATERMARK" });
    expect(await account()).toMatchObject({ heldRupiah: 100 });
    expect(await sessionRow(sessionId)).toMatchObject({ closeWatermarkAt: expect.any(Date), closeWatermarkEventCount: 3 });
    const releases = await f.db.rewardBudgetRelease.findMany({ where: { businessKey: sessionCloseWatermarkKey(sessionId) } });
    expect(releases).toEqual([expect.objectContaining({ amount: 900, reason: "CLOSE_WATERMARK" })]);
    const audit = await f.db.auditLog.findFirst({ where: { action: "DEPOSIT_SESSION_CLOSE_WATERMARK", entityId: sessionId } });
    expect(audit).not.toBeNull();

    // Retry of the same event: duplicate; a second watermark (new localEventId): nothing more released.
    const replay = await postBatch([mark]);
    expect(replay.body.results[0].status).toBe("duplicate");
    const again = await postBatch([watermarkEvent(sessionId, facts)]);
    expect(again.body.results[0].status).toBe("accepted");
    expect(await account()).toMatchObject({ heldRupiah: 100 });
    expect(await f.db.rewardBudgetRelease.count({ where: { reservationId: (await reservationOf(sessionAdmissionKey(sessionId))).id } })).toBe(1);
    expect(await f.db.rewardBudgetReservation.count({ where: { status: "ACTIVE" } })).toBe(0);
  });

  it("a lost connection retains the hold and keeps the program's sources open under enforcement until the watermark", async () => {
    await warmUp();
    await f.confirmFunding(50_000);
    const campaign = await moneyCampaign({ rewardMultiplier: 1 });
    const started = await scan("userA", { campaignId: campaign.id });
    expect(started.status).toBe(201);
    const sessionId = started.body.session.id as string;
    await deposit(sessionId);
    expect((await finishSession("userA", sessionId)).status).toBe(200);
    expect((await sessionRow(sessionId)).status).toBe("COMPLETED");

    // The RVM never reported the close (connection lost): the hold stays and the program cannot raise its terms.
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "ACTIVE", remainingRupiah: 900 });
    await expect(guardRaise(campaign.id)).rejects.toMatchObject({ status: 409, message: PROGRAM_HAS_OPEN_SOURCES });

    const accepted = await postBatch([watermarkEvent(sessionId, await serverWatermarkFacts(sessionId))]);
    expect(accepted.body.results[0].status).toBe("accepted");
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "RELEASED" });
    await expect(guardRaise(campaign.id)).resolves.toBeUndefined();

    // The carry-in example: a compliance program whose ended session still holds a REVIEW item cannot be
    // flipped to money until that item is decided or the RVM confirmed the close.
    const compliance = await f.db.campaign.create({
      data: {
        organizationId: f.ids.orgA, name: "Program Kepatuhan", campaignType: "MACHINE_DEPOSIT", rewardMode: "COMPLIANCE_ONLY",
        status: "ACTIVE", startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000), rewardBudgetRupiah: 100_000,
        maxRewardPerSessionRupiah: 1_000,
      },
    });
    const held = await scan("userB", { campaignId: compliance.id });
    expect(held.status).toBe(201);
    const heldSession = held.body.session.id as string;
    const { item } = await deposit(heldSession, { anomaly: true });
    expect(item.status).toBe("REVIEW");
    expect((await finishSession("userB", heldSession)).status).toBe(200);
    const flip = (current: ProgramShape, next: ProgramShape) =>
      f.db.$transaction((tx) => guardProgramRewardChange(tx, { campaignId: compliance.id, current: programShape(current), next: programShape(next) }, { enforced: true }));
    const shape = await f.db.campaign.findUniqueOrThrow({ where: { id: compliance.id } });
    await expect(flip(shape, { ...shape, rewardMode: "MONEY_REWARD" })).rejects.toMatchObject({ status: 409, message: PROGRAM_HAS_OPEN_SOURCES });
    const marked = await postBatch([watermarkEvent(heldSession, await serverWatermarkFacts(heldSession))]);
    expect(marked.body.results[0].status).toBe("accepted");
    // Fix round 1 (I1): an accepted item still awaiting a reviewer keeps the session open even after the watermark.
    await expect(flip(shape, { ...shape, rewardMode: "MONEY_REWARD" })).rejects.toMatchObject({ status: 409, message: PROGRAM_HAS_OPEN_SOURCES });
    // The reviewer decides it: priced at the admission mode (compliance), it pays nothing; the program may then flip.
    const approved = await call("adminA", "PATCH", `/api/deposit-reviews/${item.id}`, { action: "approve" });
    expect(approved.status).toBe(200);
    expect(await f.db.rewardLedger.count({ where: { depositItemId: item.id } })).toBe(0);
    expect(await f.db.depositItem.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "ACCEPTED", rewardAmount: 0 });
    await expect(flip(shape, { ...shape, rewardMode: "MONEY_REWARD" })).resolves.toBeUndefined();
    await f.db.campaign.update({ where: { id: compliance.id }, data: { rewardMode: "MONEY_REWARD" } });
    expect(await f.db.rewardLedger.count({ where: { sessionId: heldSession } })).toBe(0);
  });

  it("drives the real RVM worker: it stops at the bound, keeps the consumed counter across a restart and sends the watermark after the owner finished", async () => {
    await warmUp();
    await setMachineBounds({ maxRewardPerSessionRupiah: 250, maxItemsPerSession: null });
    await f.confirmFunding(10_000);
    const started = await scan("userA");
    const sessionId = started.body.session.id as string;
    const reservation = await reservationOf(sessionAdmissionKey(sessionId));
    const workdir = mkdtempSync(path.join(tmpdir(), "reloop-b01b-"));
    const env = async (phase: string): Promise<NodeJS.ProcessEnv> => ({
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "",
      PYTHONDONTWRITEBYTECODE: "1",
      B01B_PHASE: phase,
      B01B_BASE_URL: process.env.AUDIT_BASE_URL ?? "",
      B01B_MACHINE: f.ids.machineCode,
      B01B_SECRET: (await machine()).ingestSecret ?? "",
      B01B_DB: path.join(workdir, "edge.db"),
      B01B_SESSION: sessionId,
      B01B_ITEMS: "3",
    });
    const run = async (phase: string) => {
      const result = spawnSync(PYTHON, ["-c", WORKER_SCRIPT], { cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000, env: await env(phase) });
      expect(result.status, result.stderr).toBe(0);
      return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as Json;
    };
    try {
      const first = await run("deposit");
      expect(first.activated).toBe(true);
      expect(first.lease).toMatchObject({ version: 2, reservation_id: reservation.id, ceiling_rupiah: 250, max_items: null });
      expect(first.accepted).toBe(2);
      expect(first.rejected).toEqual([expect.objectContaining({ reason: "SESSION_BOUND_REACHED", bound: "SESSION_CEILING_REACHED" })]);
      expect(first.bound).toMatchObject({ ceilingRupiah: 250, consumedRupiah: 200, consumedItems: 2, remainingRupiah: 50, exhausted: true });
      expect(first.gateOpen).toBe(false);
      expect(first.flushed).toBe(true);
      expect(first.queueDepth).toBe(0);

      const items = await f.db.depositItem.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
      expect(items.map((i) => [i.status, i.rewardAmount, i.validationReasonCode])).toEqual([
        ["ACCEPTED", 100, "ACCEPTED"], ["ACCEPTED", 100, "ACCEPTED"], ["REJECTED", 0, "SESSION_BOUND_REACHED"],
      ]);
      expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "ACTIVE", remainingRupiah: 50 });
      expect(await f.db.rewardBudgetCommit.count()).toBe(2);
      expect((await finishSession("userA", sessionId)).status).toBe(200);
      expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "ACTIVE", remainingRupiah: 50 });

      const second = await run("close");
      expect(second.stateAfterRestart).toBe("SESSION_ACTIVE");
      expect(second.boundAfterRestart).toMatchObject({ consumedRupiah: 200, consumedItems: 2, exhausted: true });
      expect(second.stateAfterPoll).toBe("IDLE");
      expect(second.closed).toBe(true);
      expect(second.flushed).toBe(true);
      expect(second.watermark).toEqual(expect.any(String));
      expect(second.queueDepth).toBe(0);

      expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "RELEASED", remainingRupiah: 0, releaseReason: "CLOSE_WATERMARK" });
      expect(await account()).toMatchObject({ heldRupiah: 200 });
      expect(await sessionRow(sessionId)).toMatchObject({ closeWatermarkAt: expect.any(Date) });
      const watermark = await f.db.machineEvent.findFirst({ where: { sessionId, eventType: "SESSION_CLOSE_WATERMARK" } });
      expect(watermark?.localEventId).toBe(second.watermark);
      expect(watermark?.payloadJson).toMatchObject({ consumedRupiah: 200, consumedItems: 2 });
    } finally {
      rmSync(workdir, { recursive: true, force: true });
    }
  });
});

describe("fix round 1: review exposure across the watermark, lock order, snapshot-missing types", () => {
  /** An item the machine could not classify (unknown-type fallback): REVIEW, reward 0, no funding commit. */
  async function unknownTypeDeposit(sessionId: string) {
    const events = [
      edgeEvent(sessionId, "ITEM_DETECTED", { quantity: 1, inputBeam: true }),
      edgeEvent(sessionId, "WEIGHT_MEASURED", { weightGrams: 25, stable: true }),
      edgeEvent(sessionId, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true }),
    ];
    const res = await postBatch(events);
    expect(res.body.results.map((r: Json) => r.status)).toEqual(events.map(() => "accepted"));
    return f.db.depositItem.findFirstOrThrow({ where: { sessionId }, orderBy: { createdAt: "desc" } });
  }
  const releasesOf = (reservationId: string) =>
    f.db.rewardBudgetRelease.findMany({ where: { reservationId }, orderBy: { createdAt: "asc" } });
  const heldNeverExceedsConfirmed = async () => {
    const row = await account();
    expect(row.heldRupiah).toBeLessThanOrEqual(row.confirmedRupiah);
  };

  it("I1: the watermark keeps the exposure of an undecided accepted item held (keyed partial release); its approval is covered and the remainder closes once the last item is decided", async () => {
    await warmUp();
    await setMachineBounds({ maxRewardPerSessionRupiah: 1_000, maxItemsPerSession: null });
    await f.confirmFunding(10_000);
    const userA = await actorOf(f.ids.userA);
    const token = await f.machineQrToken();
    const { session } = await withEnforced(() => startOrResumeDeposit(userA, { machineCode: f.ids.machineCode, token }));
    const sessionId = session.id;
    const reservation = await reservationOf(sessionAdmissionKey(sessionId));
    expect(reservation).toMatchObject({ remainingRupiah: 1_000 });

    const held = await unknownTypeDeposit(sessionId);
    expect(held).toMatchObject({ status: "REVIEW", rewardAmount: 0, validationReasonCode: "UNKNOWN_WASTE_TYPE" });
    expect(held.acceptanceEventId).not.toBeNull();
    expect(await commitOf(earnKey(held.id))).toBeNull();
    expect((await finishSession("userA", sessionId)).status).toBe(200);

    // Watermark: only remaining - exposure is released; the reservation stays ACTIVE for the review.
    const mark = await postBatch([watermarkEvent(sessionId, await serverWatermarkFacts(sessionId))]);
    expect(mark.body.results[0].status).toBe("accepted");
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "ACTIVE", remainingRupiah: 100 });
    expect(await releasesOf(reservation.id)).toEqual([expect.objectContaining({ businessKey: sessionCloseWatermarkKey(sessionId), amount: 900 })]);
    expect(await account()).toMatchObject({ heldRupiah: 100 });
    expect(await sessionRow(sessionId)).toMatchObject({ closeWatermarkAt: expect.any(Date) });
    // A replayed watermark releases nothing more.
    await postBatch([watermarkEvent(sessionId, await serverWatermarkFacts(sessionId))]);
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "ACTIVE", remainingRupiah: 100 });
    expect(await releasesOf(reservation.id)).toHaveLength(1);

    // The freed capacity (9.900) admits others; the exposure is not available to them.
    const userB = await actorOf(f.ids.userB);
    const { session: next } = await withEnforced(() => startOrResumeDeposit(userB, { machineCode: f.ids.machineCode, token }));
    expect(await account()).toMatchObject({ heldRupiah: 1_100 });
    await heldNeverExceedsConfirmed();

    // The reviewer reclassifies and approves after the watermark: covered by the kept exposure, never uncovered.
    const approved = await call("adminA", "PATCH", `/api/deposit-reviews/${held.id}`, { action: "approve", wasteTypeId: await fixtureWasteTypeId() });
    expect(approved.status).toBe(200);
    expect(approved.body.targetAmount).toBe(100);
    expect(await commitOf(earnKey(held.id))).toMatchObject({ heldRupiah: 100, uncoveredRupiah: 0, reviewPending: false });
    expect(await account()).toMatchObject({ heldRupiah: 1_100 });
    await heldNeverExceedsConfirmed();
    // The last undecided item is decided: the remainder closes, keyed.
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "RELEASED", remainingRupiah: 0 });
    const releases = await releasesOf(reservation.id);
    expect(releases).toHaveLength(2);
    expect(releases[1]).toMatchObject({ amount: 0 });
    expect(await f.db.rewardBudgetReservation.count({ where: { status: "ACTIVE" } })).toBe(1); // userB's
    expect((await finishSession("userB", next.id)).status).toBe(200);
  });

  it("I1: an undecided item whose approvable obligation is already committed leaves no exposure; a reject after the watermark also closes the remainder", async () => {
    await warmUp();
    await setMachineBounds({ maxRewardPerSessionRupiah: 1_000, maxItemsPerSession: null });
    await f.confirmFunding(10_000);
    const started = await scan("userA");
    const sessionId = started.body.session.id as string;
    const anomaly = await deposit(sessionId, { anomaly: true });
    expect(anomaly.item.status).toBe("REVIEW");
    expect(await commitOf(earnKey(anomaly.item.id))).toMatchObject({ heldRupiah: 100, reviewPending: true });
    expect((await finishSession("userA", sessionId)).status).toBe(200);
    await postBatch([watermarkEvent(sessionId, await serverWatermarkFacts(sessionId))]);
    // Exposure = max item cap (100) - committed (100) = 0: everything is released and closed now.
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "RELEASED", remainingRupiah: 0, releaseReason: "CLOSE_WATERMARK" });
    expect(await account()).toMatchObject({ heldRupiah: 100 });

    // A second session with an unknown-type item: rejecting it after the watermark closes the remainder too.
    const second = await scan("userB");
    const rejected = await unknownTypeDeposit(second.body.session.id);
    expect((await finishSession("userB", second.body.session.id)).status).toBe(200);
    await postBatch([watermarkEvent(second.body.session.id, await serverWatermarkFacts(second.body.session.id))]);
    expect(await reservationOf(sessionAdmissionKey(second.body.session.id))).toMatchObject({ status: "ACTIVE", remainingRupiah: 100 });
    // Until the item is decided the organization's campaign-less sources stay open under enforcement.
    const orgGuard = () => f.db.$transaction((tx) => guardOrganizationModeChange(tx,
      { organizationId: f.ids.orgA, current: { machineRewardMode: "COMPLIANCE_ONLY" }, next: { machineRewardMode: "MONEY_REWARD" } }, { enforced: true }));
    await expect(orgGuard()).rejects.toMatchObject({ status: 409 });
    expect((await call("adminA", "PATCH", `/api/deposit-reviews/${rejected.id}`, { action: "reject" })).status).toBe(200);
    expect(await reservationOf(sessionAdmissionKey(second.body.session.id))).toMatchObject({ status: "RELEASED", remainingRupiah: 0, releaseReason: "REVIEW_SETTLED" });
    expect(await f.db.rewardBudgetRelease.findMany({ where: { reservationId: (await reservationOf(sessionAdmissionKey(second.body.session.id))).id } }))
      .toEqual([expect.objectContaining({ amount: 900 }), expect.objectContaining({ amount: 100, reason: "REVIEW_SETTLED" })]);
    expect(await account()).toMatchObject({ heldRupiah: 100 });
    await heldNeverExceedsConfirmed();
    // The first session's anomaly item is still undecided (no exposure kept: its obligation is committed), and
    // a reviewer can still decide it: the campaign-less sources stay open until then (openSessionWhere, I1).
    await expect(orgGuard()).rejects.toMatchObject({ status: 409 });
    expect((await call("adminA", "PATCH", `/api/deposit-reviews/${anomaly.item.id}`, { action: "approve" })).status).toBe(200);
    expect(await commitOf(earnKey(anomaly.item.id))).toMatchObject({ heldRupiah: 100, uncoveredRupiah: 0, reviewPending: false });
    expect(await account()).toMatchObject({ heldRupiah: 100 });
    await heldNeverExceedsConfirmed();
    await expect(orgGuard()).resolves.toBeUndefined();
  });

  it("C1: a machine moved to another organization: the watermark is refused permanently and the hold stays; a legacy session's first v2 poll is refused too", async () => {
    await warmUp();
    await setMachineBounds({ maxRewardPerSessionRupiah: 1_000, maxItemsPerSession: null });
    await f.confirmFunding(10_000);
    const started = await scan("userA");
    const sessionId = started.body.session.id as string;
    await deposit(sessionId);
    expect((await finishSession("userA", sessionId)).status).toBe(200);
    await f.db.machine.update({ where: { id: f.ids.machineA }, data: { organizationId: f.ids.orgB } });
    try {
      const mark = await postBatch([watermarkEvent(sessionId, await serverWatermarkFacts(sessionId))]);
      expect(mark.body.results[0]).toMatchObject({ status: "error", error: "EVENT_REJECTED", retryable: false });
      expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "ACTIVE", remainingRupiah: 900 });
      expect((await sessionRow(sessionId)).closeWatermarkAt).toBeNull();

    } finally {
      await f.db.machine.update({ where: { id: f.ids.machineA }, data: { organizationId: f.ids.orgA } });
    }

    // A pre-B01b session (no snapshot): its first v2 poll creates the snapshot under the locks. Deterministic race:
    // the machine moves to organization B while the poll waits on the Machine row it read as organization A.
    const legacy = await f.db.depositSession.create({
      data: { userId: f.ids.userB, machineId: f.ids.machineA, status: "ACTIVE", timeoutAt: new Date(Date.now() + 120_000) },
    });
    const holderConnection = await f.connection();
    const locked = deferred<void>();
    const release = deferred<void>();
    const holder = holderConnection.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Machine" WHERE id = ${f.ids.machineA} FOR NO KEY UPDATE`;
      locked.resolve();
      await release.promise;
      await tx.machine.update({ where: { id: f.ids.machineA }, data: { organizationId: f.ids.orgB } });
    }, { maxWait: 10_000, timeout: 60_000 });
    holder.catch(() => {});
    await locked.promise;
    try {
      const poll = machineSessionInProcess("2");
      poll.catch(() => {});
      expect(await isStillPending(poll, 500)).toBe(true); // waiting on the Machine row after its pre-lock read
      release.resolve();
      await holder;
      const refused = await poll;
      expect(refused.status).toBe(409);
      expect((await sessionRow(legacy.id)).policyVersion).toBeNull();
      expect((await sessionRow(legacy.id)).policySnapshotJson).toBeNull();
    } finally {
      release.resolve();
      await f.db.machine.update({ where: { id: f.ids.machineA }, data: { organizationId: f.ids.orgA } });
    }
  });

  it("C1 (review): the decision locks the session reservation's account before the Machine row; a machine moved to another organization is refused 409 and nothing is settled", async () => {
    await warmUp();
    await setMachineBounds({ maxRewardPerSessionRupiah: 1_000, maxItemsPerSession: null });
    await f.confirmFunding(10_000);
    const started = await scan("userA");
    const sessionId = started.body.session.id as string;
    const held = await unknownTypeDeposit(sessionId);
    expect(held).toMatchObject({ status: "REVIEW", rewardAmount: 0 });
    expect((await finishSession("userA", sessionId)).status).toBe(200);
    // Compile the review route before any lock is held.
    expect((await call("superadmin", "PATCH", "/api/deposit-reviews/missing", { action: "reject" })).status).toBe(404);
    const accountA = await account();
    const wasteTypeId = await fixtureWasteTypeId();

    // The machine moves to organization B after admission; the reservation (and its account) stay organization A's.
    await f.db.machine.update({ where: { id: f.ids.machineA }, data: { organizationId: f.ids.orgB } });
    const holderConnection = await f.connection();
    const observer = await f.connection();
    const locked = deferred<number>();
    const release = deferred<void>();
    const holder = holderConnection.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM "RewardFundingAccount" WHERE id = ${accountA.id} FOR NO KEY UPDATE`;
      locked.resolve(pid);
      await release.promise;
    }, { maxWait: 10_000, timeout: 60_000 });
    holder.catch((error) => locked.reject(error));
    try {
      const holderPid = await locked.promise;
      const review = call("superadmin", "PATCH", `/api/deposit-reviews/${held.id}`, { action: "approve", wasteTypeId });
      review.catch(() => {});
      await waitForBlockedBy(observer, { holderPid, timeoutMs: 15_000 });
      // Global order: the review waits on the reservation's account holding no Machine lock (a decision that
      // took the Machine first and the reservation's account later could deadlock with an admission).
      const machineFree = await observer
        .$transaction((tx) => tx.$queryRaw`SELECT id FROM "Machine" WHERE id = ${f.ids.machineA} FOR NO KEY UPDATE NOWAIT`)
        .then(() => true, () => false);
      expect(machineFree).toBe(true);
      release.resolve();
      await holder;
      // Re-read under the locks: the machine's organization no longer owns the reservation's account.
      const refused = await review;
      expect(refused.status).toBe(409);
    } finally {
      release.resolve();
      await holder.catch(() => {});
      await f.db.machine.update({ where: { id: f.ids.machineA }, data: { organizationId: f.ids.orgA } });
    }
    // Nothing was decided or settled, on either organization's account.
    expect(await f.db.depositItem.findUniqueOrThrow({ where: { id: held.id } })).toMatchObject({ status: "REVIEW", rewardAmount: 0 });
    expect(await commitOf(earnKey(held.id))).toBeNull();
    expect(await f.db.rewardLedger.count({ where: { depositItemId: held.id } })).toBe(0);
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ status: "ACTIVE", remainingRupiah: 1_000 });
    expect(await account()).toMatchObject({ heldRupiah: 1_000 });
    expect((await f.db.rewardFundingAccount.findUnique({ where: { organizationId: f.ids.orgB } }))?.heldRupiah ?? 0).toBe(0);

    // Back in its organization, the same decision goes through, covered by the session's reservation.
    const approved = await call("adminA", "PATCH", `/api/deposit-reviews/${held.id}`, { action: "approve", wasteTypeId });
    expect(approved.status).toBe(200);
    expect(await commitOf(earnKey(held.id))).toMatchObject({ heldRupiah: 100, uncoveredRupiah: 0 });
    expect(await account()).toMatchObject({ heldRupiah: 1_000 });
    await heldNeverExceedsConfirmed();
  });

  it("C3: a type added to the machine after admission is held for review at 0, never priced from live configuration; approval must pick a type of the session's price list", async () => {
    await warmUp();
    await setMachineBounds({ maxRewardPerSessionRupiah: 1_000, maxItemsPerSession: null });
    await f.confirmFunding(10_000);
    const started = await scan("userA");
    const sessionId = started.body.session.id as string;
    const added = await f.db.wasteType.create({ data: { name: "Kaleng Baru", unit: "ITEM", active: true } });
    await f.db.machineWasteType.create({ data: { machineId: f.ids.machineA, wasteTypeId: added.id, active: true } });
    await f.db.rewardRate.create({ data: { organizationId: f.ids.orgA, wasteTypeId: added.id, unit: "ITEM", pointsPerItem: 999, active: true } });

    const events = [
      edgeEvent(sessionId, "ITEM_DETECTED", { wasteTypeId: added.id, quantity: 1, inputBeam: true }),
      edgeEvent(sessionId, "WEIGHT_MEASURED", { weightGrams: 25, stable: true }),
      edgeEvent(sessionId, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true }),
    ];
    const res = await postBatch(events);
    expect(res.body.results.map((r: Json) => r.status)).toEqual(events.map(() => "accepted"));
    const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId } });
    expect(item).toMatchObject({ status: "REVIEW", rewardAmount: 0, baseRewardAmount: 0, validationReasonCode: "TYPE_NOT_IN_SNAPSHOT", wasteTypeId: added.id });
    expect(await f.db.rewardLedger.count({ where: { depositItemId: item.id } })).toBe(0);
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ remainingRupiah: 1_000 });

    const sameType = await call("adminA", "PATCH", `/api/deposit-reviews/${item.id}`, { action: "approve" });
    expect(sameType.status).toBe(422);
    const otherNew = await call("adminA", "PATCH", `/api/deposit-reviews/${item.id}`, { action: "approve", wasteTypeId: added.id });
    expect(otherNew.status).toBe(422);
    const snapshotType = await call("adminA", "PATCH", `/api/deposit-reviews/${item.id}`, { action: "approve", wasteTypeId: await fixtureWasteTypeId() });
    expect(snapshotType.status).toBe(200);
    expect(snapshotType.body.targetAmount).toBe(100);
    expect(await commitOf(earnKey(item.id))).toMatchObject({ heldRupiah: 100, uncoveredRupiah: 0 });
  });
});

/** The real controller (mock hardware) against the real server, in two processes sharing one SQLite file. */
const WORKER_SCRIPT = String.raw`
import json, os, time
from rvm.config import RvmConfig
from rvm.controller import RvmController, MachineState

config = RvmConfig(machine_code=os.environ["B01B_MACHINE"], machine_secret=os.environ["B01B_SECRET"],
                   server_url=os.environ["B01B_BASE_URL"], database_path=os.environ["B01B_DB"],
                   hardware_driver="mock", camera_capture_session_start=False,
                   camera_capture_security_events=False, compactor_enabled=False)
c = RvmController(config)
report = {}

def sensor_pass():
    s = c.hardware.read(); c._process_sensors(s); c._last = s

def insert(waste_type_id):
    assert c.select_waste_type(waste_type_id), "selection needs SESSION_ACTIVE"
    hw = c.hardware
    hw.patch(chamber_open=True); sensor_pass()
    hw.patch(item_present=True); sensor_pass()
    hw.patch(item_present=False, weight_grams=25.0, weight_stable=True); sensor_pass()
    hw.patch(acceptance_triggered=True); sensor_pass()
    hw.patch(acceptance_triggered=False, weight_grams=0, weight_stable=False, chamber_open=False); sensor_pass()

def flush_all(rounds=12):
    for _ in range(rounds):
        done = c.sync.flush_once()
        if done and c.db.queue_depth() == 0:
            return True
        time.sleep(0.3)
    return False

c._recover_state_after_restart()
phase = os.environ["B01B_PHASE"]
if phase == "deposit":
    c._poll_server_session()
    lease = c.db.active_lease()
    report["activated"] = bool(lease) and c.state == MachineState.SESSION_ACTIVE
    report["lease"] = {k: lease[k] for k in ("version", "reservation_id", "ceiling_rupiah", "max_items", "policy_version")} if lease else None
    waste_type_id = (c.db.get_json("waste_types") or [{}])[0].get("id")
    for _ in range(int(os.environ.get("B01B_ITEMS", "3"))):
        insert(waste_type_id)
    rows = c.db.pending(500)
    report["accepted"] = len([r for r in rows if r["eventType"] == "ITEM_ACCEPTED_POINT"])
    report["rejected"] = [r["payload"] for r in rows if r["eventType"] == "ITEM_REJECTED"]
    report["bound"] = c.public_state()["sessionBound"]
    report["gateOpen"] = c.hardware.input_gate_open
    report["flushed"] = flush_all()
    report["queueDepth"] = c.db.queue_depth()
else:
    report["stateAfterRestart"] = c.state
    report["boundAfterRestart"] = c.public_state()["sessionBound"]
    c._poll_server_session()
    report["stateAfterPoll"] = c.state
    session_id = os.environ["B01B_SESSION"]
    report["closed"] = c.db.session_consumption(session_id)["closed_at"] is not None
    report["flushed"] = flush_all()
    report["watermark"] = c.db.session_consumption(session_id)["watermark_event_id"]
    report["queueDepth"] = c.db.queue_depth()
c.db.close()
print(json.dumps(report))
`;
