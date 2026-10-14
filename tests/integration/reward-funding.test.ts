import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { startOrResumeDeposit } from "@/lib/deposit-session-service";
import { getWalletBalance } from "@/lib/ledger";
import { signMachinePayload } from "@/lib/machine-auth";
import { ingestMachineEvent } from "@/lib/machine-events/ingest";
import { generateToken } from "@/lib/qr";
import type { CurrentUser } from "@/lib/rbac";
import {
  CAMPAIGN_BUDGET_INSUFFICIENT,
  FUNDING_CUTOVER_ENV,
  FUNDING_INSUFFICIENT,
  ORGANIZATION_HAS_OPEN_SESSIONS,
  PROGRAM_HAS_OPEN_SOURCES,
  fundingCashKey,
  guardOrganizationModeChange,
  guardProgramRewardChange,
  resolveFundingCutover,
  sessionAdmissionKey,
  tripIssuanceKey,
} from "@/lib/reward-funding";
import type { AppRole } from "@/lib/roles";
import { changeTripStatus, issueTrashBags } from "@/lib/trip-issuance";
import { runWalletTransaction } from "@/lib/wallet-service";
import { f, type ActorKey } from "../support/audit-fixture";
import { reconciliationReportResponseV1 } from "../support/contracts";
import { InjectedFault, deferred, isStillPending, waitForBlockedBy } from "../support/race-probe";

/**
 * B01a (BIZ-02): reward funding and budget reservations against the real
 * PostgreSQL and Next server. Capacity is reserved before material is admitted
 * (session ceiling, issued bags), accepted earnings commit against the
 * reservation keyed by the earning, review holds the approvable ceiling, a
 * payout success debits the funded source, and residual holds are visible and
 * released only by an explicit operator action.
 *
 * The Next child runs in shadow mode (REWARD_FUNDING_ENFORCED unset): HTTP
 * cases prove the bookkeeping; refusals are proven in-process through the same
 * services with the flag set in this process (`withEnforced`).
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

const account = () => f.db.rewardFundingAccount.findUniqueOrThrow({ where: { organizationId: f.ids.orgA } });
const reservationOf = (businessKey: string) => f.db.rewardBudgetReservation.findUniqueOrThrow({ where: { businessKey } });
const commitOf = (businessKey: string) => f.db.rewardBudgetCommit.findUnique({ where: { businessKey } });
const earnKey = (itemId: string) => `deposit-item:${itemId}:earn`;

async function actorOf(userId: string): Promise<CurrentUser> {
  const user = await f.db.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role as AppRole,
    organizationId: user.organizationId, organizationName: null, payoutEligible: false, status: user.status,
  } as CurrentUser;
}

/** Runs `fn` with one env variable set in this process (the services read the env at call time). */
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

/** Runs `fn` with funding enforcement switched on in this process. */
const withEnforced = <T,>(fn: () => Promise<T>) => withEnv("REWARD_FUNDING_ENFORCED", "true", fn);

const setMachineCeiling = (machineId: string, maxRewardPerSessionRupiah: number | null) =>
  f.db.machine.update({ where: { id: machineId }, data: { maxRewardPerSessionRupiah } });

/** A second machine of organization A, so a second user can deposit at the same time. */
async function createMachineB() {
  const link = await f.db.machineWasteType.findFirstOrThrow({ where: { machineId: f.ids.machineA, active: true } });
  const machine = await f.db.machine.create({
    data: {
      organizationId: f.ids.orgA, machineCode: "AUDIT-A-02", name: "Mesin Audit A2", status: "ONLINE",
      lastHeartbeatAt: new Date(), ingestSecret: randomBytes(32).toString("hex"),
      qrToken: generateToken(), qrTokenExpiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  await f.db.machineWasteType.create({ data: { machineId: machine.id, wasteTypeId: link.wasteTypeId, active: true } });
  return machine;
}

/** Signs and sends an event batch exactly like rvm/sync.py does. */
async function postBatch(events: EdgeEvent[], machineId = f.ids.machineA) {
  const machine = await f.db.machine.findUniqueOrThrow({ where: { id: machineId } });
  const raw = JSON.stringify({ machineCode: machine.machineCode, events });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replaceAll("-", "");
  const response = await fetch(new URL("/api/machine-events", process.env.AUDIT_BASE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-reloop-machine": machine.machineCode,
      "x-reloop-timestamp": timestamp,
      "x-reloop-nonce": nonce,
      "x-reloop-signature": signMachinePayload(machine.ingestSecret ?? "", timestamp, nonce, raw),
    },
    body: raw,
  });
  return { status: response.status, body: (await response.json()) as Json };
}

let clock = 0;
const EVENT_CLOCK_BASE = Date.now();
function edgeEvent(sessionId: string, eventType: string, payload: Record<string, unknown>, occurredAt?: Date): EdgeEvent {
  clock += 1;
  return {
    localEventId: randomUUID(), eventType, payload, sessionId, depositItemId: null,
    occurredAt: (occurredAt ?? new Date(EVENT_CLOCK_BASE + clock)).toISOString(),
  };
}

const fixtureWasteTypeId = async () =>
  (await f.db.wasteType.findFirstOrThrow({ where: { name: "Botol Plastik Audit" } })).id;

/** ITEM_DETECTED -> WEIGHT_MEASURED [-> SENSOR_SEQUENCE anomaly] -> ITEM_ACCEPTED_POINT. */
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

/** One item through the signed machine protocol on an already admitted session; every event must be ACKed. */
async function deposit(sessionId: string, options: { anomaly?: boolean; machineId?: string } = {}) {
  const events = await depositEvents(sessionId, options);
  const res = await postBatch(events, options.machineId);
  expect(res.status).toBe(200);
  expect(res.body.results.map((r: Json) => r.status)).toEqual(events.map(() => "accepted"));
  const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId }, orderBy: { createdAt: "desc" } });
  const ledger = await f.db.rewardLedger.findMany({ where: { depositItemId: item.id }, orderBy: { createdAt: "asc" } });
  return { item, ledger, events };
}

/** The real scan (HTTP, shadow mode): admits the session and reserves its ceiling. */
async function scan(actor: ActorKey, options: { campaignId?: string; machineId?: string } = {}) {
  const machine = await f.db.machine.findUniqueOrThrow({ where: { id: options.machineId ?? f.ids.machineA } });
  const token = options.machineId ? machine.qrToken! : await f.machineQrToken();
  return call(actor, "POST", "/api/scan", {
    machineCode: machine.machineCode, token, ...(options.campaignId ? { campaignId: options.campaignId } : {}),
  });
}

const finishSession = (actor: ActorKey, sessionId: string) => call(actor, "PATCH", `/api/sessions/${sessionId}`, { action: "finish" });

const moneyCampaign = (data: Partial<Prisma.CampaignUncheckedCreateInput> = {}) =>
  f.db.campaign.create({
    data: {
      organizationId: f.ids.orgA, name: "Program Berkuota", campaignType: "MACHINE_DEPOSIT", rewardMode: "MONEY_REWARD",
      status: "ACTIVE", startAt: new Date(Date.now() - 86_400_000), endAt: new Date(Date.now() + 86_400_000), ...data,
    },
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

const lockAccountRow = (organizationId: string) => (tx: Prisma.TransactionClient) => tx.$queryRaw`
  SELECT id FROM "RewardFundingAccount" WHERE "organizationId" = ${organizationId} FOR UPDATE`;

/**
 * Deterministic ordering: `first` is proven blocked on a row another session
 * holds, then `second` is proven blocked behind `first`, then the row is
 * released, so `first` always decides before `second` re-reads.
 */
async function inOrder<A, B>(hold: (tx: Prisma.TransactionClient) => Promise<unknown>,
  first: () => Promise<A>, second: () => Promise<B>): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
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
  return Promise.all([settle(a!), settle(b!)]);
}

const settle = <T,>(promise: Promise<T>): Promise<PromiseSettledResult<T>> =>
  promise.then((value) => ({ status: "fulfilled" as const, value }), (reason) => ({ status: "rejected" as const, reason }));

/** True when no other transaction holds a NO KEY UPDATE (or stronger) lock on the row. */
async function rowLockFree(observer: PrismaClient, table: string, id: string) {
  try {
    await observer.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = $1 FOR NO KEY UPDATE NOWAIT`, id);
    return true;
  } catch (error) {
    if ((error as { meta?: { code?: string } }).meta?.code === "55P03") return false;
    throw error;
  }
}

/** Compiles the routes in `next dev` before a test starts holding locks. */
async function warmUp() {
  expect((await postBatch([])).status).toBe(200);
  expect((await call("superadmin", "GET", `/api/organizations/${f.ids.orgA}/funding`)).status).toBe(200);
  expect((await call("userA", "PATCH", "/api/sessions/missing", { action: "finish" })).status).toBe(404);
}

// ---------------------------------------------------------------------------

describe("reward funding reservations (BIZ-02)", () => {
  it("cannot admit two reward obligations beyond funded capacity",async()=>{
    await f.confirmFunding(10_000);
    const attempts=await Promise.allSettled(["admission-a","admission-b"].map(businessKey=>
      f.reserveBudget({businessKey,amount:8_000})));
    expect(attempts.filter(x=>x.status==="fulfilled")).toHaveLength(1);
    const account=await f.db.rewardFundingAccount.findUniqueOrThrow({where:{organizationId:f.ids.orgA}});
    expect(account.heldRupiah).toBe(8_000);
    expect(account.confirmedRupiah).toBe(10_000);
  });

  it("deterministic: the second reservation waits on the account row and is refused once the first consumed the capacity", async () => {
    await f.confirmFunding(10_000);
    const [first, second] = await inOrder(lockAccountRow(f.ids.orgA),
      () => f.reserveBudget({ businessKey: "admission-a", amount: 8_000 }),
      () => f.reserveBudget({ businessKey: "admission-b", amount: 8_000 }));
    expect(first.status).toBe("fulfilled");
    expect(second.status).toBe("rejected");
    expect((second as PromiseRejectedResult).reason).toMatchObject({ status: 409, message: FUNDING_INSUFFICIENT });
    expect(await account()).toMatchObject({ confirmedRupiah: 10_000, heldRupiah: 8_000 });
    const reservations = await f.db.rewardBudgetReservation.findMany({ orderBy: { businessKey: "asc" } });
    expect(reservations.map((row) => [row.businessKey, row.ceilingRupiah, row.remainingRupiah, row.status]))
      .toEqual([["admission-a", 8_000, 8_000, "ACTIVE"]]);
    // A repeat of the admitted key consumes nothing again; a smaller fit is admitted; then nothing more.
    expect(await f.reserveBudget({ businessKey: "admission-a", amount: 8_000 })).toBe(reservations[0].id);
    await f.reserveBudget({ businessKey: "admission-c", amount: 2_000 });
    expect((await account()).heldRupiah).toBe(10_000);
    await expect(f.reserveBudget({ businessKey: "admission-d", amount: 1 })).rejects.toMatchObject({ status: 409 });
  });
});

describe("admission is refused before a session or a bag exists", () => {
  it("insufficient funding refuses the scan before the session exists; sufficient funding admits and reserves the ceiling; a program cap applies on top", async () => {
    await setMachineCeiling(f.ids.machineA, 10_000);
    await f.confirmFunding(5_000);
    const userA = await actorOf(f.ids.userA);
    const token = await f.machineQrToken();

    await withEnforced(async () => {
      await expect(startOrResumeDeposit(userA, { machineCode: f.ids.machineCode, token }))
        .rejects.toMatchObject({ status: 409, message: FUNDING_INSUFFICIENT });
      expect(await f.db.depositSession.count()).toBe(0);
      expect(await f.db.rewardBudgetReservation.count()).toBe(0);
      expect(await account()).toMatchObject({ confirmedRupiah: 5_000, heldRupiah: 0 });

      await f.confirmFunding(5_000);
      const { session, resumed } = await startOrResumeDeposit(userA, { machineCode: f.ids.machineCode, token });
      expect(resumed).toBe(false);
      expect(await reservationOf(sessionAdmissionKey(session.id))).toMatchObject({
        userId: f.ids.userA, campaignId: null, sourceType: "SESSION", sourceId: session.id,
        ceilingRupiah: 10_000, remainingRupiah: 10_000, shortfallRupiah: 0, status: "ACTIVE" });
      expect(await account()).toMatchObject({ confirmedRupiah: 10_000, heldRupiah: 10_000 });
      // Resuming the same session reserves nothing more.
      expect((await startOrResumeDeposit(userA, { machineCode: f.ids.machineCode, token })).resumed).toBe(true);
      expect((await account()).heldRupiah).toBe(10_000);
      expect((await finishSession("userA", session.id)).status).toBe(200);

      // A capped program: the organization still has nothing free (10.000 held), so top up first.
      await f.confirmFunding(20_000);
      const capped = await moneyCampaign({ rewardBudgetRupiah: 4_000, maxRewardPerSessionRupiah: 5_000 });
      await expect(startOrResumeDeposit(userA, { machineCode: f.ids.machineCode, token, campaignId: capped.id }))
        .rejects.toMatchObject({ status: 409, message: CAMPAIGN_BUDGET_INSUFFICIENT });
      expect(await f.db.depositSession.count({ where: { campaignId: capped.id } })).toBe(0);
      await f.db.campaign.update({ where: { id: capped.id }, data: { rewardBudgetRupiah: 5_000 } });
      const { session: under } = await startOrResumeDeposit(userA, { machineCode: f.ids.machineCode, token, campaignId: capped.id });
      expect(await reservationOf(sessionAdmissionKey(under.id))).toMatchObject({ campaignId: capped.id, ceilingRupiah: 5_000 });
      expect(await f.db.campaign.findUniqueOrThrow({ where: { id: capped.id } })).toMatchObject({ heldRupiah: 5_000, spentRupiah: 0 });
      expect((await account()).heldRupiah).toBe(15_000);
    });
  });

  it("a money program without a configured ceiling is refused under enforcement and admitted with a zero ceiling in shadow mode, which the report flags", async () => {
    await setMachineCeiling(f.ids.machineA, null);
    await f.confirmFunding(10_000);
    const userA = await actorOf(f.ids.userA);
    const token = await f.machineQrToken();
    await withEnforced(async () => {
      await expect(startOrResumeDeposit(userA, { machineCode: f.ids.machineCode, token }))
        .rejects.toMatchObject({ status: 409, message: FUNDING_INSUFFICIENT });
    });
    expect(await f.db.depositSession.count()).toBe(0);

    const shadow = await scan("userA");
    expect(shadow.status).toBe(201);
    expect(await reservationOf(sessionAdmissionKey(shadow.body.session.id))).toMatchObject({ ceilingRupiah: 0, remainingRupiah: 0 });
    const report = await call("superadmin", "GET", "/api/reports/reconciliation");
    expect(report.status).toBe(200);
    const org = report.body.report.funding.organizations.find((row: Json) => row.organizationId === f.ids.orgA);
    expect(org.staleHolds).toEqual([expect.objectContaining({
      sourceType: "SESSION", sourceId: shadow.body.session.id, userId: f.ids.userA, reasons: ["CEILING_NOT_CONFIGURED"] })]);
    expect(org.staleHolds[0].reconciliation).toMatch(/batas reward per sesi/);
  });

  it("a COMPLIANCE_ONLY program needs no money reservation and creates no money funding entry", async () => {
    await warmUp();
    await setMachineCeiling(f.ids.machineA, 10_000);
    await f.db.organization.update({ where: { id: f.ids.orgA }, data: { machineRewardMode: "COMPLIANCE_ONLY" } });
    const started = await scan("userA");
    expect(started.status).toBe(201);
    expect(await f.db.rewardBudgetReservation.count()).toBe(0);
    const { item, ledger } = await deposit(started.body.session.id);
    expect(item).toMatchObject({ status: "ACCEPTED", rewardAmount: 0 });
    expect(ledger).toEqual([]);
    expect(await f.db.rewardBudgetCommit.count()).toBe(0);
    expect(await f.db.fundingEntry.count()).toBe(0);
    expect(await account()).toMatchObject({ confirmedRupiah: 0, heldRupiah: 0 });
  });

  it("bag issuance reserves bags x rate x multiplier before the rows exist, is refused when unfunded, and the trip's close releases the residue", async () => {
    await warmUp();
    const adminA = await actorOf(f.ids.adminA);
    const trip = await f.trip({ bagCount: 0 });
    // C1: an enforced money program needs a budget; the capacity check is what this test exercises.
    const tripProgram = await f.db.trip.findUniqueOrThrow({ where: { id: trip.id }, select: { campaignId: true } });
    await f.db.campaign.update({ where: { id: tripProgram.campaignId }, data: { rewardBudgetRupiah: 1_000_000 } });
    await f.confirmFunding(3_000);

    await withEnforced(async () => {
      await expect(issueTrashBags(adminA, { tripId: trip.id, bagCount: 2 }))
        .rejects.toMatchObject({ status: 409, message: FUNDING_INSUFFICIENT });
      expect(await f.db.trashBagAssignment.count({ where: { tripId: trip.id } })).toBe(0);
      expect(await f.db.rewardBudgetReservation.count()).toBe(0);
      await f.confirmFunding(7_000);
      expect(await issueTrashBags(adminA, { tripId: trip.id, bagCount: 2 })).toHaveLength(2);
    });
    expect(await reservationOf(tripIssuanceKey(trip.id))).toMatchObject({
      sourceType: "TRIP", sourceId: trip.id, userId: f.ids.userA, ceilingRupiah: 4_000, remainingRupiah: 4_000 });
    // A later issuance (HTTP, shadow) extends the same reservation to every issued bag.
    const more = await call("adminA", "POST", "/api/trash-bags", { tripId: trip.id, bagCount: 1 });
    expect(more.status).toBe(201);
    expect(await reservationOf(tripIssuanceKey(trip.id))).toMatchObject({ ceilingRupiah: 6_000, remainingRupiah: 6_000 });
    expect(await account()).toMatchObject({ confirmedRupiah: 10_000, heldRupiah: 6_000 });

    // Check-out: every bag GOOD at full compliance pays 3 x Rp2.000; the earning commits and the trip's residue is released.
    const bags = await f.db.trashBagAssignment.findMany({ where: { tripId: trip.id }, select: { id: true } });
    const checkout = await call("adminA", "POST", "/api/manual-validations", {
      tripId: trip.id, validationStage: "CHECK_OUT", appCompleted: true, bags: bags.map((bag) => ({ id: bag.id, status: "GOOD" })) });
    expect(checkout.status).toBe(201);
    expect(checkout.body.rewardAmount).toBe(6_000);
    expect(await commitOf(`trip:${trip.id}:return`)).toMatchObject({ heldRupiah: 6_000, uncoveredRupiah: 0, reviewPending: false });
    expect(await reservationOf(tripIssuanceKey(trip.id))).toMatchObject({ remainingRupiah: 0, status: "RELEASED", releaseReason: "TRIP_COMPLETED" });
    expect(await account()).toMatchObject({ confirmedRupiah: 10_000, heldRupiah: 6_000 });

    // A cancelled trip gives its whole reservation back.
    const cancelled = await f.trip({ bagCount: 0 });
    expect((await call("adminA", "POST", "/api/trash-bags", { tripId: cancelled.id, bagCount: 2 })).status).toBe(201);
    expect((await account()).heldRupiah).toBe(10_000);
    expect((await call("adminA", "PATCH", `/api/trips/${cancelled.id}`, { status: "CANCELLED" })).status).toBe(200);
    expect(await reservationOf(tripIssuanceKey(cancelled.id))).toMatchObject({ remainingRupiah: 0, status: "RELEASED", releaseReason: "TRIP_CANCELLED" });
    expect((await account()).heldRupiah).toBe(6_000);
  });
});

describe("accepted material turns the admission hold into an obligation hold", () => {
  it("an accepted item commits against the session's reservation without touching cash; a duplicate localEventId or a retried acceptance never consumes budget twice", async () => {
    await warmUp();
    await setMachineCeiling(f.ids.machineA, 10_000);
    await f.confirmFunding(10_000);
    const campaign = await moneyCampaign({ rewardBudgetRupiah: 50_000, maxRewardPerSessionRupiah: 10_000 });
    const started = await scan("userA", { campaignId: campaign.id });
    expect(started.status).toBe(201);
    const sessionId = started.body.session.id as string;
    expect(await f.db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ heldRupiah: 10_000, spentRupiah: 0 });

    const { item, ledger, events } = await deposit(sessionId);
    expect(ledger).toEqual([expect.objectContaining({ entryType: "EARN", status: "AVAILABLE", amount: 100 })]);
    expect(await commitOf(earnKey(item.id))).toMatchObject({
      userId: f.ids.userA, campaignId: campaign.id, heldRupiah: 100, paidRupiah: 0, uncoveredRupiah: 0, reviewPending: false });
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ remainingRupiah: 9_900 });
    expect(await account()).toMatchObject({ confirmedRupiah: 10_000, heldRupiah: 10_000 });
    expect(await f.db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ heldRupiah: 9_900, spentRupiah: 100 });

    // The same batch again: every event is a durable duplicate, nothing moves.
    const replay = await postBatch(events);
    expect(replay.body.results.map((r: Json) => r.status)).toEqual(events.map(() => "duplicate"));
    // A new localEventId for the same acceptance: accepted, but the item is already decided.
    const again = await postBatch([edgeEvent(sessionId, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true })]);
    expect(again.body.results[0].status).toBe("accepted");
    expect(await f.db.rewardLedger.count({ where: { depositItemId: item.id } })).toBe(1);
    expect(await f.db.rewardBudgetCommit.count()).toBe(1);
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ remainingRupiah: 9_900 });
    expect(await account()).toMatchObject({ heldRupiah: 10_000 });
  });

  it("a review hold commits the approvable ceiling (pending); approval keeps it, rejection releases the difference to the organization and the program", async () => {
    await warmUp();
    await setMachineCeiling(f.ids.machineA, 10_000);
    await f.confirmFunding(10_000);
    const campaign = await moneyCampaign({ rewardBudgetRupiah: 50_000, maxRewardPerSessionRupiah: 10_000 });
    const started = await scan("userA", { campaignId: campaign.id });
    const sessionId = started.body.session.id as string;

    const held = await deposit(sessionId, { anomaly: true });
    expect(held.item.status).toBe("REVIEW");
    expect(held.ledger).toEqual([expect.objectContaining({ entryType: "EARN", status: "PENDING", amount: 50 })]);
    expect(await commitOf(earnKey(held.item.id))).toMatchObject({ heldRupiah: 100, reviewPending: true });
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ remainingRupiah: 9_900 });
    expect(await account()).toMatchObject({ heldRupiah: 10_000 });

    const approved = await call("adminA", "PATCH", `/api/deposit-reviews/${held.item.id}`, { action: "approve" });
    expect(approved.status).toBe(200);
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 100, pending: 0 });
    expect(await commitOf(earnKey(held.item.id))).toMatchObject({ heldRupiah: 100, reviewPending: false });
    expect(await account()).toMatchObject({ heldRupiah: 10_000 });
    expect(await f.db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ heldRupiah: 9_900, spentRupiah: 100 });

    const rejected = await deposit(sessionId, { anomaly: true });
    expect((await call("adminA", "PATCH", `/api/deposit-reviews/${rejected.item.id}`, { action: "reject" })).status).toBe(200);
    expect(await commitOf(earnKey(rejected.item.id))).toMatchObject({ heldRupiah: 0, reviewPending: false });
    expect(await account()).toMatchObject({ heldRupiah: 9_900 });
    expect(await f.db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ heldRupiah: 9_800, spentRupiah: 100 });
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 100, pending: 0 });
  });

  it("material already accepted never silently loses its reward: beyond the ceiling or after a funding correction, the commit is held uncovered and reported", async () => {
    await warmUp();
    await setMachineCeiling(f.ids.machineA, 150);
    await f.confirmFunding(10_000);
    const started = await scan("userA");
    const sessionId = started.body.session.id as string;
    const first = await deposit(sessionId);
    const second = await deposit(sessionId);
    expect(first.ledger.map((row) => row.amount)).toEqual([100]);
    expect(second.ledger.map((row) => row.amount)).toEqual([100]);
    expect(await commitOf(earnKey(first.item.id))).toMatchObject({ heldRupiah: 100, uncoveredRupiah: 0 });
    expect(await commitOf(earnKey(second.item.id))).toMatchObject({ heldRupiah: 100, uncoveredRupiah: 50 });
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ remainingRupiah: 0 });
    expect(await account()).toMatchObject({ confirmedRupiah: 10_000, heldRupiah: 200 });

    // Funding reduced after admission (a correction) still never withholds an accepted item.
    const correction = await call("superadmin", "POST", `/api/organizations/${f.ids.orgA}/funding`, {
      kind: "CORRECTION", amount: -9_900, reference: "BANK-REVERSAL-1", note: "transfer ditarik kembali" });
    expect(correction.status).toBe(201);
    expect(await account()).toMatchObject({ confirmedRupiah: 100, heldRupiah: 200 });
    const third = await deposit(sessionId);
    expect(third.ledger.map((row) => row.amount)).toEqual([100]);
    expect(await commitOf(earnKey(third.item.id))).toMatchObject({ heldRupiah: 100, uncoveredRupiah: 100 });
    expect(await account()).toMatchObject({ confirmedRupiah: 100, heldRupiah: 300 });
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 300 });

    const view = await call("superadmin", "GET", `/api/organizations/${f.ids.orgA}/funding`);
    expect(view.status).toBe(200);
    expect(view.body.funding).toMatchObject({ confirmedRupiah: 100, heldRupiah: 300, capacityRupiah: -200, uncoveredRupiah: 150 });
  });

  it("an exception after the side effects rolls back the event, the ledger and the budget consumption together", async () => {
    await warmUp();
    await setMachineCeiling(f.ids.machineA, 10_000);
    await f.confirmFunding(10_000);
    const started = await scan("userA");
    const sessionId = started.body.session.id as string;
    const [detected, weighed, accepted] = await depositEvents(sessionId);
    const machine = await f.db.machine.findUniqueOrThrow({ where: { id: f.ids.machineA }, include: { organization: true } });
    const input = (event: EdgeEvent) => ({ ...event, machineCode: f.ids.machineCode }) as Parameters<typeof ingestMachineEvent>[0];
    await ingestMachineEvent(input(detected), { machine });
    await ingestMachineEvent(input(weighed), { machine });
    const before = await account();

    await expect(ingestMachineEvent(input(accepted), {
      machine,
      hooks: { afterSideEffects: async () => { throw new InjectedFault("SIDE_EFFECT_FAILED"); } },
    })).rejects.toThrow("SIDE_EFFECT_FAILED");
    expect(await f.db.machineEvent.count({ where: { localEventId: accepted.localEventId } })).toBe(0);
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA } })).toBe(0);
    expect(await f.db.rewardBudgetCommit.count()).toBe(0);
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ remainingRupiah: 10_000 });
    expect(await account()).toMatchObject({ heldRupiah: 10_000, version: before.version });

    const retried = await ingestMachineEvent(input(accepted), { machine });
    expect(retried.duplicate).toBe(false);
    const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId } });
    expect(await commitOf(earnKey(item.id))).toMatchObject({ heldRupiah: 100 });
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ remainingRupiah: 9_900 });
    expect((await ingestMachineEvent(input(accepted), { machine })).duplicate).toBe(true);
    expect(await f.db.rewardBudgetCommit.count()).toBe(1);
  });

  it("takes the funding account lock after the User and before the DepositSession and DepositItem rows", async () => {
    await warmUp();
    await setMachineCeiling(f.ids.machineA, 10_000);
    await f.confirmFunding(10_000);
    const started = await scan("userA");
    const sessionId = started.body.session.id as string;
    const [detected, weighed, accepted] = await depositEvents(sessionId);
    expect((await postBatch([detected, weighed])).status).toBe(200);
    const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId } });

    const observer = await f.connection();
    const holder = await holdLock(lockAccountRow(f.ids.orgA));
    let pending: Promise<{ status: number; body: Json }> | undefined;
    try {
      pending = postBatch([accepted]);
      pending.catch(() => {});
      await waitForBlockedBy(observer, { holderPid: holder.pid, timeoutMs: 15_000 });
      expect(await isStillPending(pending, 200)).toBe(true);
      // Waiting for the account row, the acceptance holds the User row but none of the later rows.
      expect(await rowLockFree(observer, "User", f.ids.userA)).toBe(false);
      expect(await rowLockFree(observer, "DepositSession", sessionId)).toBe(true);
      expect(await rowLockFree(observer, "DepositItem", item.id)).toBe(true);
      expect(await f.db.rewardBudgetCommit.count()).toBe(0);
    } finally {
      await holder.release();
    }
    expect((await pending!).body.results[0].status).toBe("accepted");
    expect(await commitOf(earnKey(item.id))).toMatchObject({ heldRupiah: 100 });
  });
});

describe("campaign and organization budget under two users", () => {
  it("concurrent acceptances of two users serialize on the organization's account; obligations, the program budget and a review from PENDING to AVAILABLE add up", async () => {
    await warmUp();
    const machineB = await createMachineB();
    await setMachineCeiling(f.ids.machineA, 5_000);
    await setMachineCeiling(machineB.id, 5_000);
    await f.confirmFunding(10_000);
    const campaign = await moneyCampaign({ rewardBudgetRupiah: 20_000 });
    const sessionA = (await scan("userA", { campaignId: campaign.id })).body.session.id as string;
    const sessionB = (await scan("userB", { campaignId: campaign.id, machineId: machineB.id })).body.session.id as string;
    expect(await account()).toMatchObject({ confirmedRupiah: 10_000, heldRupiah: 10_000 });
    expect(await f.db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ heldRupiah: 10_000, spentRupiah: 0 });

    // Both acceptances are proven to wait on the account row before either
    // commits: A behind the holder, B queued behind A on the same row.
    const [aDetected, aWeighed, aAccepted] = await depositEvents(sessionA);
    const [bDetected, bWeighed, bAccepted] = await depositEvents(sessionB, { anomaly: false });
    expect((await postBatch([aDetected, aWeighed])).status).toBe(200);
    expect((await postBatch([bDetected, bWeighed], machineB.id)).status).toBe(200);
    const [a, b] = await inOrder(lockAccountRow(f.ids.orgA),
      () => postBatch([aAccepted]), () => postBatch([bAccepted], machineB.id));
    expect(a.status).toBe("fulfilled");
    expect(b.status).toBe("fulfilled");
    expect((a as PromiseFulfilledResult<{ body: Json }>).value.body.results[0].status).toBe("accepted");
    expect((b as PromiseFulfilledResult<{ body: Json }>).value.body.results[0].status).toBe("accepted");
    const itemA = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: sessionA } });
    const itemB = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: sessionB } });
    expect(await commitOf(earnKey(itemA.id))).toMatchObject({ userId: f.ids.userA, heldRupiah: 100, uncoveredRupiah: 0 });
    expect(await commitOf(earnKey(itemB.id))).toMatchObject({ userId: f.ids.userB, heldRupiah: 100, uncoveredRupiah: 0 });
    expect(await reservationOf(sessionAdmissionKey(sessionA))).toMatchObject({ remainingRupiah: 4_900 });
    expect(await reservationOf(sessionAdmissionKey(sessionB))).toMatchObject({ remainingRupiah: 4_900 });
    expect(await account()).toMatchObject({ confirmedRupiah: 10_000, heldRupiah: 10_000 });
    expect(await f.db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ heldRupiah: 9_800, spentRupiah: 200 });

    // User B's next item is held for review: the program holds its approvable ceiling until the reviewer settles it.
    const held = await deposit(sessionB, { anomaly: true, machineId: machineB.id });
    expect(held.ledger).toEqual([expect.objectContaining({ status: "PENDING", amount: 50, userId: f.ids.userB })]);
    expect(await f.db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ heldRupiah: 9_700, spentRupiah: 300 });
    expect((await call("adminA", "PATCH", `/api/deposit-reviews/${held.item.id}`, { action: "approve" })).status).toBe(200);
    expect(await getWalletBalance(f.ids.userB)).toMatchObject({ available: 200, pending: 0 });
    expect(await commitOf(earnKey(held.item.id))).toMatchObject({ heldRupiah: 100, reviewPending: false });
    expect(await account()).toMatchObject({ heldRupiah: 10_000 });
    expect(await f.db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ heldRupiah: 9_700, spentRupiah: 300 });
    // Capacity never counts twice: held = both sessions' residue + the three obligations.
    const [reservedA, reservedB] = [await reservationOf(sessionAdmissionKey(sessionA)), await reservationOf(sessionAdmissionKey(sessionB))];
    const commits = await f.db.rewardBudgetCommit.aggregate({ _sum: { heldRupiah: true } });
    expect(reservedA.remainingRupiah + reservedB.remainingRupiah + (commits._sum.heldRupiah ?? 0)).toBe((await account()).heldRupiah);
  });

  it("a program cap refuses the second user; after the first session ends, its residue is visible with owner and reason and only an explicit operator release frees it", async () => {
    await warmUp();
    const machineB = await createMachineB();
    await setMachineCeiling(f.ids.machineA, 5_000);
    await setMachineCeiling(machineB.id, 5_000);
    await f.confirmFunding(100_000);
    const campaign = await moneyCampaign({ rewardBudgetRupiah: 8_000 });
    const userB = await actorOf(f.ids.userB);
    const sessionA = (await scan("userA", { campaignId: campaign.id })).body.session.id as string;
    await withEnforced(async () => {
      await expect(startOrResumeDeposit(userB, { machineCode: machineB.machineCode, token: machineB.qrToken!, campaignId: campaign.id }))
        .rejects.toMatchObject({ status: 409, message: CAMPAIGN_BUDGET_INSUFFICIENT });
    });

    // User A accepts one item (100) and finishes: the residue (4.900) stays held, never released by time.
    const { item } = await deposit(sessionA);
    expect((await finishSession("userA", sessionA)).status).toBe(200);
    expect(await reservationOf(sessionAdmissionKey(sessionA))).toMatchObject({ status: "ACTIVE", remainingRupiah: 4_900 });
    expect(await account()).toMatchObject({ heldRupiah: 5_000 });
    const report = await call("superadmin", "GET", "/api/reports/reconciliation");
    const org = report.body.report.funding.organizations.find((row: Json) => row.organizationId === f.ids.orgA);
    expect(report.body.report.funding.staleHoldCount).toBe(1);
    expect(org.staleHolds).toEqual([expect.objectContaining({
      sourceType: "SESSION", sourceId: sessionA, sourceStatus: "COMPLETED", userId: f.ids.userA, campaignId: campaign.id,
      remainingRupiah: 4_900, reasons: ["SOURCE_CLOSED_AWAITING_WATERMARK"] })]);
    expect(org.staleHolds[0].reconciliation).toMatch(/melepas sisa dana secara eksplisit/);
    expect(await withEnforced(() => startOrResumeDeposit(userB, { machineCode: machineB.machineCode, token: machineB.qrToken!, campaignId: campaign.id })
      .then(() => "admitted", (error) => error.message))).toBe(CAMPAIGN_BUDGET_INSUFFICIENT);

    // Releasing needs a superadmin, a reason, and an ended source; it is audited and idempotent.
    const reservation = await reservationOf(sessionAdmissionKey(sessionA));
    const asAdmin = await call("adminA", "POST", `/api/organizations/${f.ids.orgA}/funding`, {
      action: "release_reservation", reservationId: reservation.id, reason: "sesi selesai, event tersinkron" });
    expect(asAdmin.status).toBe(403);
    const noReason = await call("superadmin", "POST", `/api/organizations/${f.ids.orgA}/funding`, {
      action: "release_reservation", reservationId: reservation.id, reason: "" });
    expect(noReason.status).toBe(422);
    const released = await call("superadmin", "POST", `/api/organizations/${f.ids.orgA}/funding`, {
      action: "release_reservation", reservationId: reservation.id, reason: "sesi selesai, event tersinkron" });
    expect(released.status).toBe(200);
    expect(released.body).toMatchObject({ released: 4_900, idempotent: false });
    expect(await reservationOf(sessionAdmissionKey(sessionA))).toMatchObject({
      status: "RELEASED", remainingRupiah: 0, releasedById: f.ids.superadmin, releaseReason: "sesi selesai, event tersinkron" });
    expect(await account()).toMatchObject({ heldRupiah: 100 });
    expect(await f.db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ heldRupiah: 0, spentRupiah: 100 });
    const again = await call("superadmin", "POST", `/api/organizations/${f.ids.orgA}/funding`, {
      action: "release_reservation", reservationId: reservation.id, reason: "ulang" });
    expect(again.body).toMatchObject({ released: 0, idempotent: true });
    expect(await f.db.auditLog.count({ where: { action: "REWARD_RESERVATION_RELEASE", entityId: reservation.id } })).toBe(1);
    expect((await call("superadmin", "GET", "/api/reports/reconciliation")).body.report.funding.staleHoldCount).toBe(0);

    // Now user B fits under the program cap.
    const admitted = await withEnforced(() =>
      startOrResumeDeposit(userB, { machineCode: machineB.machineCode, token: machineB.qrToken!, campaignId: campaign.id }));
    expect(admitted.resumed).toBe(false);
    expect(await f.db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ heldRupiah: 5_000, spentRupiah: 100 });

    // A late acceptance of the released session still pays user A; the obligation is re-held uncovered, never lost.
    const lateDetected = edgeEvent(sessionA, "ITEM_DETECTED", { wasteTypeId: await fixtureWasteTypeId(), quantity: 1, inputBeam: true });
    const lateWeighed = edgeEvent(sessionA, "WEIGHT_MEASURED", { weightGrams: 25, stable: true });
    const lateAccepted = edgeEvent(sessionA, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true }, new Date());
    const late = await postBatch([lateDetected, lateWeighed, lateAccepted]);
    expect(late.body.results.map((r: Json) => r.status)).toEqual(["accepted", "accepted", "accepted"]);
    const lateItem = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: sessionA, id: { not: item.id } } });
    expect(lateItem.status).toBe("REVIEW");
    expect(await commitOf(earnKey(lateItem.id))).toMatchObject({ heldRupiah: 100, uncoveredRupiah: 100, reviewPending: true });
    // 100 (A's first item) + 5.000 (B's admission) + 100 re-held for the late item.
    expect(await account()).toMatchObject({ heldRupiah: 5_200 });
    expect((await call("adminA", "PATCH", `/api/deposit-reviews/${lateItem.id}`, { action: "approve" })).status).toBe(200);
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 200 });
  });
});

describe("confirmed funding (operator topup)", () => {
  it("topup is superadmin-only, needs a unique evidence reference, is idempotent by reference, and corrections are signed", async () => {
    await warmUp();
    const path = `/api/organizations/${f.ids.orgA}/funding`;
    expect((await call("adminA", "POST", path, { amount: 10_000, reference: "BANK-1" })).status).toBe(403);
    expect((await call("userA", "POST", path, { amount: 10_000, reference: "BANK-1" })).status).toBe(403);
    expect((await call("superadmin", "POST", path, { amount: 10_000 })).status).toBe(422);
    expect((await call("superadmin", "POST", path, { amount: 10_000, reference: "   " })).status).toBe(422);
    expect((await call("superadmin", "POST", path, { amount: 0, reference: "BANK-0" })).status).toBe(422);
    expect((await call("superadmin", "POST", path, { amount: 10.5, reference: "BANK-F" })).status).toBe(422);
    expect((await call("superadmin", "POST", path, { amount: -5, reference: "BANK-N" })).status).toBe(422);
    expect((await call("superadmin", "POST", `/api/organizations/missing-org/funding`, { amount: 1, reference: "X" })).status).toBe(404);
    expect(await f.db.fundingEntry.count()).toBe(0);

    const note = "Transfer BCA 14-10-2026 rek 1234567890 a.n. Yayasan";
    const first = await call("superadmin", "POST", path, { amount: 10_000, reference: "BANK-1", note });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ idempotent: false, account: { confirmedRupiah: 10_000, heldRupiah: 0 },
      entry: { kind: "CONFIRMED_TOPUP", amount: 10_000, reference: "BANK-1", note, verifiedById: f.ids.superadmin,
        businessKey: "cash:BANK-1" } });
    const replay = await call("superadmin", "POST", path, { amount: 10_000, reference: "BANK-1", note });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ idempotent: true, entry: { id: first.body.entry.id } });
    const conflict = await call("superadmin", "POST", path, { amount: 5_000, reference: "BANK-1", note });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toMatch(/Referensi ini sudah tercatat/);
    expect(await f.db.fundingEntry.count()).toBe(1);
    expect(await account()).toMatchObject({ confirmedRupiah: 10_000 });

    const correction = await call("superadmin", "POST", path, {
      kind: "CORRECTION", amount: -2_000, reference: "BANK-1", note: "Biaya administrasi bank atas transfer BANK-1" });
    expect(correction.status).toBe(201);
    expect(correction.body.entry).toMatchObject({ kind: "CORRECTION", amount: -2_000, businessKey: "correction:BANK-1" });
    expect(await account()).toMatchObject({ confirmedRupiah: 8_000 });
    expect(await f.db.auditLog.findMany({ where: { action: { in: ["REWARD_FUNDING_TOPUP", "REWARD_FUNDING_CORRECTION"] } }, select: { action: true } }))
      .toEqual(expect.arrayContaining([{ action: "REWARD_FUNDING_TOPUP" }, { action: "REWARD_FUNDING_CORRECTION" }]));

    // The view: the organization's own admin may read it, others may not.
    const view = await call("adminA", "GET", path);
    expect(view.status).toBe(200);
    expect(view.body.funding).toMatchObject({ confirmedRupiah: 8_000, heldRupiah: 0, capacityRupiah: 8_000, enforced: false });
    expect(view.body.funding.entries.map((entry: Json) => entry.kind)).toEqual(["CORRECTION", "CONFIRMED_TOPUP"]);
    expect((await call("adminB", "GET", path)).status).toBe(403);
    expect((await call("userA", "GET", path)).status).toBe(403);
  });
});

describe("payout success debits the funded source", () => {
  it("success writes one PAYOUT entry per source (oldest obligation first), reducing confirmed and held by the gross; cancel and fail keep the obligation", async () => {
    await warmUp();
    await setMachineCeiling(f.ids.machineA, 10_000);
    await f.confirmFunding(10_000);
    const started = await scan("userA");
    const sessionId = started.body.session.id as string;
    const { item } = await deposit(sessionId);
    expect(await account()).toMatchObject({ confirmedRupiah: 10_000, heldRupiah: 10_000 });

    // A legacy balance on top (no funding source): the funded 100 is attributed, the rest is legacy.
    await f.seedBalance(9_900);
    const redemptionId = await f.processingRedemption(10_000);
    const observer = await f.connection();
    const holder = await holdLock(lockAccountRow(f.ids.orgA));
    let pending: Promise<{ status: number; body: Json }> | undefined;
    try {
      pending = call("superadmin", "PATCH", `/api/redemptions/${redemptionId}`, { action: "success", providerReference: "REF-1" });
      pending.catch(() => {});
      await waitForBlockedBy(observer, { holderPid: holder.pid, timeoutMs: 15_000 });
      expect(await isStillPending(pending, 200)).toBe(true);
      // Waiting for the funding account: the User row is held, the Redemption row is still free.
      expect(await rowLockFree(observer, "User", f.ids.userA)).toBe(false);
      expect(await rowLockFree(observer, "Redemption", redemptionId)).toBe(true);
    } finally {
      await holder.release();
    }
    expect((await pending!).status).toBe(200);
    const acct = await account();
    expect(acct).toMatchObject({ confirmedRupiah: 9_900, heldRupiah: 9_900 });
    expect(await f.db.fundingEntry.findMany({ where: { kind: "PAYOUT" } })).toEqual([expect.objectContaining({
      businessKey: `redemption:${redemptionId}:payout:${acct.id}`, amount: -100, reference: redemptionId, verifiedById: f.ids.superadmin })]);
    expect(await commitOf(earnKey(item.id))).toMatchObject({ heldRupiah: 100, paidRupiah: 100 });
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 0, redeemed: 10_000 });
    const audit = await f.db.auditLog.findFirstOrThrow({ where: { action: "REDEMPTION_SUCCESS", entityId: redemptionId } });
    expect(audit.metadataJson).toMatchObject({ fundingAttributedRupiah: 100, fundingLegacyRupiah: 9_900 });
    // A replay of the success writes nothing twice.
    const replay = await call("superadmin", "PATCH", `/api/redemptions/${redemptionId}`, { action: "success", providerReference: "REF-1" });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
    expect(await f.db.fundingEntry.count({ where: { kind: "PAYOUT" } })).toBe(1);

    // A second funded earning (plus legacy balance up to the payout minimum); its
    // payout is cancelled by the user: spendable returns, the obligation stays funded.
    const { item: second } = await deposit(sessionId);
    await f.seedBalance(9_900);
    const cancelBody = await f.json("userA", "POST", "/api/redemptions", {
      amount: 10_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `audit-${randomUUID()}` });
    expect(cancelBody.status).toBe(201);
    const cancelId = ((await cancelBody.json()) as Json).redemption.id as string;
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 0, reserved: 10_000 });
    expect((await call("userA", "PATCH", `/api/redemptions/${cancelId}`, { action: "cancel" })).status).toBe(200);
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 10_000, reserved: 0 });
    expect(await f.db.fundingEntry.count({ where: { kind: "PAYOUT" } })).toBe(1);
    expect(await commitOf(earnKey(second.id))).toMatchObject({ heldRupiah: 100, paidRupiah: 0 });
    expect(await account()).toMatchObject({ confirmedRupiah: 9_900, heldRupiah: 9_900 });
    // Failing a processing payout likewise keeps the obligation.
    const failId = await f.processingRedemption(10_000);
    expect((await call("superadmin", "PATCH", `/api/redemptions/${failId}`, { action: "fail", note: "bank menolak" })).status).toBe(200);
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 10_000, reserved: 0 });
    expect(await f.db.fundingEntry.count({ where: { kind: "PAYOUT" } })).toBe(1);
    expect(await commitOf(earnKey(second.id))).toMatchObject({ heldRupiah: 100, paidRupiah: 0 });
    expect(await account()).toMatchObject({ confirmedRupiah: 9_900, heldRupiah: 9_900 });
  });
});

describe("fix round 1: enforcement bypasses on reopen, mode change and zero ceilings", () => {
  const NOTE = "Transfer BCA 14-10-2026 rek 1234567890 a.n. Yayasan";
  const checkIn = (tripId: string) =>
    call("adminA", "POST", "/api/manual-validations", { tripId, validationStage: "CHECK_IN", appCompleted: true });
  const checkOut = async (tripId: string) => {
    const bags = await f.db.trashBagAssignment.findMany({ where: { tripId }, select: { id: true } });
    return call("adminA", "POST", "/api/manual-validations", {
      tripId, validationStage: "CHECK_OUT", appCompleted: true, bags: bags.map((bag) => ({ id: bag.id, status: "GOOD" })) });
  };
  const staleHoldsOf = async (organizationId: string) => {
    const report = await call("superadmin", "GET", "/api/reports/reconciliation");
    expect(report.status).toBe(200);
    return report.body.report.funding.organizations.find((row: Json) => row.organizationId === organizationId);
  };

  it("I1: reopening a cancelled trip re-reserves its issued bags under the trip locks, so the check-out commits covered", async () => {
    await warmUp();
    await f.confirmFunding(10_000);
    const trip = await f.trip({ bagCount: 0, status: "PLANNED" });
    expect((await call("adminA", "POST", "/api/trash-bags", { tripId: trip.id, bagCount: 2 })).status).toBe(201);
    expect(await account()).toMatchObject({ heldRupiah: 4_000 });
    expect((await call("adminA", "PATCH", `/api/trips/${trip.id}`, { status: "CANCELLED" })).status).toBe(200);
    expect(await reservationOf(tripIssuanceKey(trip.id))).toMatchObject({ status: "RELEASED", remainingRupiah: 0 });
    expect(await account()).toMatchObject({ heldRupiah: 0 });

    const reopened = await call("adminA", "PATCH", `/api/trips/${trip.id}`, { status: "PLANNED" });
    expect(reopened.status).toBe(200);
    expect(await reservationOf(tripIssuanceKey(trip.id))).toMatchObject({ status: "ACTIVE", ceilingRupiah: 4_000, remainingRupiah: 4_000 });
    expect(await account()).toMatchObject({ heldRupiah: 4_000 });

    expect((await checkIn(trip.id)).status).toBe(201);
    const out = await checkOut(trip.id);
    expect(out.status).toBe(201);
    expect(out.body.rewardAmount).toBe(4_000);
    expect(await commitOf(`trip:${trip.id}:return`)).toMatchObject({ heldRupiah: 4_000, uncoveredRupiah: 0 });
    expect(await reservationOf(tripIssuanceKey(trip.id))).toMatchObject({ status: "RELEASED", remainingRupiah: 0 });
    expect(await account()).toMatchObject({ heldRupiah: 4_000 });
  });

  it("I1 (enforced): reopening is refused when capacity cannot cover the issued bags and the trip stays cancelled; it reserves again once it can", async () => {
    await warmUp();
    await f.confirmFunding(10_000);
    const trip = await f.trip({ bagCount: 0, status: "PLANNED" });
    const tripProgram = await f.db.trip.findUniqueOrThrow({ where: { id: trip.id }, select: { campaignId: true } });
    await f.db.campaign.update({ where: { id: tripProgram.campaignId }, data: { rewardBudgetRupiah: 1_000_000 } });
    expect((await call("adminA", "POST", "/api/trash-bags", { tripId: trip.id, bagCount: 2 })).status).toBe(201);
    expect((await call("adminA", "PATCH", `/api/trips/${trip.id}`, { status: "CANCELLED" })).status).toBe(200);
    // Other admissions consume the capacity the cancelled trip gave back.
    await f.reserveBudget({ businessKey: "other-admission", amount: 8_000 });
    expect(await account()).toMatchObject({ confirmedRupiah: 10_000, heldRupiah: 8_000 });

    await withEnforced(async () => {
      await expect(changeTripStatus(trip.id, "CANCELLED", "PLANNED")).rejects.toMatchObject({ status: 409, message: FUNDING_INSUFFICIENT });
      expect((await f.db.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe("CANCELLED");
      expect(await reservationOf(tripIssuanceKey(trip.id))).toMatchObject({ status: "RELEASED", remainingRupiah: 0 });
      expect(await account()).toMatchObject({ heldRupiah: 8_000 });

      await f.confirmFunding(2_000);
      expect((await changeTripStatus(trip.id, "CANCELLED", "PLANNED")).status).toBe("PLANNED");
      expect(await reservationOf(tripIssuanceKey(trip.id))).toMatchObject({ status: "ACTIVE", ceilingRupiah: 4_000, remainingRupiah: 4_000 });
      expect(await account()).toMatchObject({ confirmedRupiah: 12_000, heldRupiah: 12_000 });
    });
  });

  it("I2 (cutover): a source without a reservation created before the funding cutover is legacy (nothing held); after it, it is held late", async () => {
    await warmUp();
    await setMachineCeiling(f.ids.machineA, 10_000);
    await f.db.organization.update({ where: { id: f.ids.orgA }, data: { machineRewardMode: "COMPLIANCE_ONLY" } });
    const started = await scan("userA");
    const sessionId = started.body.session.id as string;
    await f.db.organization.update({ where: { id: f.ids.orgA }, data: { machineRewardMode: "MONEY_REWARD" } });
    const machine = await f.db.machine.findUniqueOrThrow({ where: { id: f.ids.machineA }, include: { organization: true } });
    const input = (event: EdgeEvent) => ({ ...event, machineCode: f.ids.machineCode }) as Parameters<typeof ingestMachineEvent>[0];

    // A session started before the funding cutover (the applied migration; a later setting can never move it, C3)
    // without a reservation is a legacy source: B02 backfills it, nothing is held here.
    const [{ finishedAt: migrationAt }] = await f.db.$queryRaw<{ finishedAt: Date }[]>`
      SELECT finished_at AS "finishedAt" FROM "_prisma_migrations" WHERE migration_name = '20261014150000_reward_funding'`;
    await f.db.depositSession.update({ where: { id: sessionId }, data: { startedAt: new Date(migrationAt.getTime() - 60_000) } });
    const [detected, weighed, accepted] = await depositEvents(sessionId);
    await ingestMachineEvent(input(detected), { machine });
    await ingestMachineEvent(input(weighed), { machine });
    const future = new Date(Date.now() + 24 * 3_600_000).toISOString();
    await withEnv(FUNDING_CUTOVER_ENV, future, () => ingestMachineEvent(input(accepted), { machine }));
    const legacyItem = await f.db.depositItem.findFirstOrThrow({ where: { sessionId } });
    expect(await f.db.rewardLedger.findMany({ where: { depositItemId: legacyItem.id } })).toEqual([expect.objectContaining({ amount: 100 })]);
    expect(await commitOf(earnKey(legacyItem.id))).toBeNull();
    expect(await f.db.rewardBudgetReservation.count()).toBe(0);
    expect(await account()).toMatchObject({ heldRupiah: 0 });

    // Cutover before the session (or unresolvable, which fails closed): the next earning is held late.
    const [detected2, weighed2, accepted2] = await depositEvents(sessionId);
    await ingestMachineEvent(input(detected2), { machine });
    await ingestMachineEvent(input(weighed2), { machine });
    await withEnv(FUNDING_CUTOVER_ENV, "bukan-tanggal", () => ingestMachineEvent(input(accepted2), { machine }));
    const lateItem = await f.db.depositItem.findFirstOrThrow({ where: { sessionId, id: { not: legacyItem.id } } });
    expect(await commitOf(earnKey(lateItem.id))).toMatchObject({ heldRupiah: 100, uncoveredRupiah: 100 });
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ lateReservation: true, ceilingRupiah: 0 });
    expect(await account()).toMatchObject({ heldRupiah: 100 });
  });

  it("I2 (guards, enforced): a program with open sources cannot turn to money or raise its multiplier; an organization with open campaign-less sessions cannot turn to money", async () => {
    await warmUp();
    await setMachineCeiling(f.ids.machineA, 10_000);
    await f.confirmFunding(100_000);
    type Shape = { rewardMode: string; rewardMultiplier: number | null; campaignType?: string; supportsMachine?: boolean };
    const guard = (campaignId: string, current: Shape, next: Shape, campaignType = "MACHINE_DEPOSIT") =>
      withEnforced(() => runWalletTransaction((tx) => guardProgramRewardChange(tx, {
        campaignId,
        current: { campaignType, supportsMachine: false, ...current },
        next: { campaignType, supportsMachine: false, ...next },
      })));

    // A compliance machine program with an open session: it cannot turn to money.
    const program = await moneyCampaign({ rewardMode: "COMPLIANCE_ONLY", rewardBudgetRupiah: 50_000, maxRewardPerSessionRupiah: 5_000 });
    const compliance = { rewardMode: "COMPLIANCE_ONLY", rewardMultiplier: null, campaignType: "MACHINE_DEPOSIT", supportsMachine: false };
    const money = { ...compliance, rewardMode: "MONEY_REWARD" };
    const session = (await scan("userA", { campaignId: program.id })).body.session.id as string;
    await expect(guard(program.id, compliance, money)).rejects.toMatchObject({ status: 409, message: PROGRAM_HAS_OPEN_SOURCES });
    // Shadow mode allows it (bookkept late at the first earning).
    await expect(runWalletTransaction((tx) => guardProgramRewardChange(tx, { campaignId: program.id, current: compliance, next: money }, { enforced: false }))).resolves.toBeUndefined();
    expect((await finishSession("userA", session)).status).toBe(200);
    await expect(guard(program.id, compliance, money)).resolves.toBeUndefined();

    // A money trip program with issued bags: the multiplier cannot rise, it can fall; without bags it can rise.
    const trips = await f.db.campaign.findFirstOrThrow({ where: { organizationId: f.ids.orgA, campaignType: "TRASH_BAG" } });
    const trip = await f.trip({ bagCount: 0 });
    const m1 = { rewardMode: "MONEY_REWARD", rewardMultiplier: 1 };
    const m2 = { rewardMode: "MONEY_REWARD", rewardMultiplier: 2 };
    await expect(guard(trips.id, m1, m2, "TRASH_BAG")).resolves.toBeUndefined();
    expect((await call("adminA", "POST", "/api/trash-bags", { tripId: trip.id, bagCount: 1 })).status).toBe(201);
    await expect(guard(trips.id, m1, m2, "TRASH_BAG")).rejects.toMatchObject({ status: 409, message: PROGRAM_HAS_OPEN_SOURCES });
    await expect(guard(trips.id, { ...m1, rewardMultiplier: null }, { ...m2, rewardMultiplier: 1.5 }, "TRASH_BAG")).rejects.toMatchObject({ status: 409 });
    await expect(guard(trips.id, m2, m1, "TRASH_BAG")).resolves.toBeUndefined();
    await expect(guard(trips.id, m1, { rewardMode: "COMPLIANCE_ONLY", rewardMultiplier: 5 }, "TRASH_BAG")).resolves.toBeUndefined();
    expect((await call("adminA", "PATCH", `/api/trips/${trip.id}`, { status: "CANCELLED" })).status).toBe(200);
    await expect(guard(trips.id, m1, m2, "TRASH_BAG")).resolves.toBeUndefined();

    // The organization's machine mode with an open campaign-less session.
    await f.db.organization.update({ where: { id: f.ids.orgA }, data: { machineRewardMode: "COMPLIANCE_ONLY" } });
    const plain = (await scan("userA")).body.session.id as string;
    const orgGuard = (next: string) => withEnforced(() => runWalletTransaction((tx) =>
      guardOrganizationModeChange(tx, { organizationId: f.ids.orgA, current: { machineRewardMode: "COMPLIANCE_ONLY" }, next: { machineRewardMode: next } })));
    await expect(orgGuard("MONEY_REWARD")).rejects.toMatchObject({ status: 409, message: ORGANIZATION_HAS_OPEN_SESSIONS });
    await expect(orgGuard("COMPLIANCE_ONLY")).resolves.toBeUndefined();
    expect((await finishSession("userA", plain)).status).toBe(200);
    await expect(orgGuard("MONEY_REWARD")).resolves.toBeUndefined();

    // Over HTTP (shadow) the change is allowed; under enforcement the route runs the same guard under the Campaign lock.
    const shadow = await call("adminA", "PATCH", `/api/campaigns/${trips.id}`, { rewardMultiplier: 3 });
    expect(shadow.status).toBe(200);
    expect(shadow.body.campaign.rewardMultiplier).toBe(3);
  });

  it("I2: a session admitted without money whose organization turns to money later is held at its first earning (late reservation, uncovered) and reported with its owner", async () => {
    await warmUp();
    await setMachineCeiling(f.ids.machineA, 10_000);
    await f.db.organization.update({ where: { id: f.ids.orgA }, data: { machineRewardMode: "COMPLIANCE_ONLY" } });
    const started = await scan("userA");
    expect(started.status).toBe(201);
    const sessionId = started.body.session.id as string;
    expect(await f.db.rewardBudgetReservation.count()).toBe(0);
    // Shadow mode allows the flip while the session is open; the hole must still be bookkept.
    await f.db.organization.update({ where: { id: f.ids.orgA }, data: { machineRewardMode: "MONEY_REWARD" } });

    const { item, ledger } = await deposit(sessionId);
    expect(ledger).toEqual([expect.objectContaining({ entryType: "EARN", status: "AVAILABLE", amount: 100 })]);
    expect(await commitOf(earnKey(item.id))).toMatchObject({ heldRupiah: 100, uncoveredRupiah: 100 });
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({
      ceilingRupiah: 0, remainingRupiah: 0, lateReservation: true, userId: f.ids.userA, status: "ACTIVE" });
    expect(await account()).toMatchObject({ heldRupiah: 100 });
    const org = await staleHoldsOf(f.ids.orgA);
    expect(org.uncoveredRupiah).toBe(100);
    expect(org.staleHolds).toEqual([expect.objectContaining({
      sourceType: "SESSION", sourceId: sessionId, userId: f.ids.userA, reasons: ["ADMITTED_WITHOUT_RESERVATION"] })]);
  });

  it("I2: a trip whose bags were issued without money and whose program turns to money before check-out is held at its return earning", async () => {
    await warmUp();
    const campaign = await f.db.campaign.findFirstOrThrow({ where: { organizationId: f.ids.orgA, campaignType: "TRASH_BAG" } });
    await f.db.campaign.update({ where: { id: campaign.id }, data: { rewardMode: "COMPLIANCE_ONLY" } });
    const trip = await f.trip({ bagCount: 0 });
    expect((await call("adminA", "POST", "/api/trash-bags", { tripId: trip.id, bagCount: 3 })).status).toBe(201);
    expect(await f.db.rewardBudgetReservation.count()).toBe(0);
    await f.db.campaign.update({ where: { id: campaign.id }, data: { rewardMode: "MONEY_REWARD" } });

    const out = await checkOut(trip.id);
    expect(out.status).toBe(201);
    expect(out.body.rewardAmount).toBe(6_000);
    expect(await commitOf(`trip:${trip.id}:return`)).toMatchObject({ heldRupiah: 6_000, uncoveredRupiah: 6_000 });
    expect(await reservationOf(tripIssuanceKey(trip.id))).toMatchObject({ ceilingRupiah: 0, lateReservation: true, userId: f.ids.userA });
    expect(await account()).toMatchObject({ heldRupiah: 6_000 });
  });

  it("I3: a zero per-session ceiling is not a configured ceiling: refused under enforcement, rejected by the config APIs", async () => {
    await warmUp();
    await f.confirmFunding(10_000);
    await setMachineCeiling(f.ids.machineA, 0);
    const userA = await actorOf(f.ids.userA);
    const token = await f.machineQrToken();
    await withEnforced(async () => {
      await expect(startOrResumeDeposit(userA, { machineCode: f.ids.machineCode, token }))
        .rejects.toMatchObject({ status: 409, message: FUNDING_INSUFFICIENT });
    });
    expect(await f.db.depositSession.count()).toBe(0);
    expect(await f.db.rewardBudgetReservation.count()).toBe(0);

    expect((await call("superadmin", "PATCH", `/api/machines/${f.ids.machineA}`, { maxRewardPerSessionRupiah: 0 })).status).toBe(422);
    const campaign = await moneyCampaign({ rewardBudgetRupiah: 50_000, maxRewardPerSessionRupiah: 5_000 });
    expect((await call("adminA", "PATCH", `/api/campaigns/${campaign.id}`, { maxRewardPerSessionRupiah: 0 })).status).toBe(422);
    expect((await call("adminA", "PATCH", `/api/campaigns/${campaign.id}`, { rewardBudgetRupiah: 0 })).status).toBe(422);
    expect(await f.db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).toMatchObject({ rewardBudgetRupiah: 50_000, maxRewardPerSessionRupiah: 5_000 });
  });

  it("C1: an ACTIVE money program without a budget admits nothing under enforcement and is reported in shadow mode", async () => {
    await warmUp();
    await f.confirmFunding(100_000);
    const campaign = await moneyCampaign({ rewardBudgetRupiah: null, maxRewardPerSessionRupiah: 5_000 });
    const userA = await actorOf(f.ids.userA);
    const token = await f.machineQrToken();
    await withEnforced(async () => {
      await expect(startOrResumeDeposit(userA, { machineCode: f.ids.machineCode, token, campaignId: campaign.id }))
        .rejects.toMatchObject({ status: 409, message: expect.stringMatching(/Kuota reward program belum diatur/) });
    });
    expect(await f.db.depositSession.count()).toBe(0);
    // Reported, together with the fixture's own budget-less money programs (machine and trash-bag).
    const org = await staleHoldsOf(f.ids.orgA);
    expect(org.programsWithoutBudget).toEqual(expect.arrayContaining([{ id: campaign.id, name: campaign.name }]));
    const budgetless = await f.db.campaign.findMany({ where: { organizationId: f.ids.orgA, status: "ACTIVE", rewardMode: "MONEY_REWARD", rewardBudgetRupiah: null }, select: { id: true } });
    expect(org.programsWithoutBudget.map((program: Json) => program.id).sort()).toEqual(budgetless.map((row) => row.id).sort());
    await f.db.campaign.update({ where: { id: campaign.id }, data: { rewardBudgetRupiah: 50_000 } });
    expect((await staleHoldsOf(f.ids.orgA)).programsWithoutBudget.map((program: Json) => program.id)).not.toContain(campaign.id);
  });

  it("C2: top-up evidence needs a reference of at least 6 characters that is unique per kind across organizations, and an evidence note", async () => {
    await warmUp();
    const pathA = `/api/organizations/${f.ids.orgA}/funding`;
    const pathB = `/api/organizations/${f.ids.orgB}/funding`;
    expect((await call("superadmin", "POST", pathA, { amount: 1_000, reference: "BANK1", note: NOTE })).status).toBe(422);
    expect((await call("superadmin", "POST", pathA, { amount: 1_000, reference: "BANK-001" })).status).toBe(422);
    expect((await call("superadmin", "POST", pathA, { amount: 1_000, reference: "BANK-001", note: "pendek" })).status).toBe(422);
    expect(await f.db.fundingEntry.count()).toBe(0);

    const first = await call("superadmin", "POST", pathA, { amount: 1_000, reference: "BANK-001", note: NOTE });
    expect(first.status).toBe(201);
    expect(first.body.entry).toMatchObject({ businessKey: "cash:BANK-001", note: NOTE });
    // The same bank transfer cannot confirm cash for a second organization.
    const elsewhere = await call("superadmin", "POST", pathB, { amount: 1_000, reference: "BANK-001", note: NOTE });
    expect(elsewhere.status).toBe(409);
    // Nothing was written for B (the refused transaction rolled back, account row included).
    expect((await f.db.rewardFundingAccount.findUnique({ where: { organizationId: f.ids.orgB } }))?.confirmedRupiah ?? 0).toBe(0);
    expect(await f.db.fundingEntry.count({ where: { account: { organizationId: f.ids.orgB } } })).toBe(0);
    expect((await call("superadmin", "POST", pathA, { amount: 2_000, reference: "BANK-001", note: NOTE })).status).toBe(409);
    const replay = await call("superadmin", "POST", pathA, { amount: 1_000, reference: "BANK-001", note: NOTE });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
    expect(await f.db.fundingEntry.count()).toBe(1);
    expect(await account()).toMatchObject({ confirmedRupiah: 1_000 });
  });
});

describe("fix round 2: effective reward mode, review late reservation, cutover and cash references", () => {
  const NOTE = "Transfer BCA 14-10-2026 rek 1234567890 a.n. Yayasan";
  type ProgramShape = { rewardMode: string; rewardMultiplier: number | null; campaignType: string; supportsMachine: boolean };
  const guard = (campaignId: string, current: ProgramShape, next: ProgramShape) =>
    withEnforced(() => runWalletTransaction((tx) => guardProgramRewardChange(tx, { campaignId, current, next })));

  it("I2-a: the guard follows the EFFECTIVE mode: a money trip program turned into an EVENT and back cannot bypass the reservation of its issued bags", async () => {
    await warmUp();
    await f.confirmFunding(1_000_000);
    const adminA = await actorOf(f.ids.adminA);
    const trip = await f.trip({ bagCount: 0 });
    const program = await f.db.campaign.findUniqueOrThrow({ where: { id: (await f.db.trip.findUniqueOrThrow({ where: { id: trip.id } })).campaignId } });
    await f.db.campaign.update({ where: { id: program.id }, data: { rewardBudgetRupiah: 1_000_000 } });
    const asTrashBag: ProgramShape = { rewardMode: "MONEY_REWARD", rewardMultiplier: null, campaignType: "TRASH_BAG", supportsMachine: false };
    const asEvent: ProgramShape = { ...asTrashBag, campaignType: "EVENT" };

    // 1. TRASH_BAG money -> EVENT: the raw mode is unchanged (money), the effective trip mode drops to compliance. Allowed.
    await expect(guard(program.id, asTrashBag, asEvent)).resolves.toBeUndefined();
    await f.db.campaign.update({ where: { id: program.id }, data: { campaignType: "EVENT" } });
    // 2. Issue 50 bags under the EVENT program: no money, so no reservation is taken.
    await withEnforced(async () => {
      expect(await issueTrashBags(adminA, { tripId: trip.id, bagCount: 50 })).toHaveLength(50);
    });
    expect(await f.db.rewardBudgetReservation.count()).toBe(0);
    // 3. EVENT -> TRASH_BAG while that trip holds 50 unreserved bags: the effective trip mode turns to money -> refused.
    await expect(guard(program.id, asEvent, asTrashBag)).rejects.toMatchObject({ status: 409, message: PROGRAM_HAS_OPEN_SOURCES });
    // A machine program the same way: MACHINE_DEPOSIT money -> EVENT (no machines) and back, with an open session.
    const machineProgram = await moneyCampaign({ rewardBudgetRupiah: 50_000, maxRewardPerSessionRupiah: 5_000 });
    await setMachineCeiling(f.ids.machineA, 5_000);
    const asMachine: ProgramShape = { rewardMode: "MONEY_REWARD", rewardMultiplier: null, campaignType: "MACHINE_DEPOSIT", supportsMachine: false };
    const asEventWithMachines: ProgramShape = { ...asMachine, campaignType: "EVENT", supportsMachine: true };
    const sessionId = (await scan("userA", { campaignId: machineProgram.id })).body.session.id as string;
    await expect(guard(machineProgram.id, asMachine, { ...asMachine, campaignType: "EVENT" })).resolves.toBeUndefined();
    await expect(guard(machineProgram.id, { ...asMachine, campaignType: "EVENT" }, asEventWithMachines)).rejects.toMatchObject({ status: 409 });
    await expect(guard(machineProgram.id, { ...asMachine, campaignType: "EVENT" }, asMachine)).rejects.toMatchObject({ status: 409 });
    expect((await finishSession("userA", sessionId)).status).toBe(200);
    // Once the trip is cancelled (its bags can no longer earn) the change is allowed again.
    expect((await call("adminA", "PATCH", `/api/trips/${trip.id}`, { status: "CANCELLED" })).status).toBe(200);
    await expect(guard(program.id, asEvent, asTrashBag)).resolves.toBeUndefined();
  });

  it("I2-b: a review approval of an item whose source was admitted without a reservation is held late (uncovered) like an acceptance", async () => {
    await warmUp();
    await setMachineCeiling(f.ids.machineA, 10_000);
    await f.db.organization.update({ where: { id: f.ids.orgA }, data: { machineRewardMode: "COMPLIANCE_ONLY" } });
    const sessionId = (await scan("userA")).body.session.id as string;
    const held = await deposit(sessionId, { anomaly: true });
    expect(held.item).toMatchObject({ status: "REVIEW", rewardAmount: 0 });
    expect(held.ledger).toEqual([]);
    expect(await f.db.rewardBudgetReservation.count()).toBe(0);
    await f.db.organization.update({ where: { id: f.ids.orgA }, data: { machineRewardMode: "MONEY_REWARD" } });

    const approved = await call("adminA", "PATCH", `/api/deposit-reviews/${held.item.id}`, { action: "approve" });
    expect(approved.status).toBe(200);
    expect(approved.body.targetAmount).toBe(100);
    expect(await getWalletBalance(f.ids.userA)).toMatchObject({ available: 100 });
    expect(await commitOf(earnKey(held.item.id))).toMatchObject({ heldRupiah: 100, uncoveredRupiah: 100, reviewPending: false });
    expect(await reservationOf(sessionAdmissionKey(sessionId))).toMatchObject({ lateReservation: true, ceilingRupiah: 0 });
    expect(await account()).toMatchObject({ heldRupiah: 100 });
    const org = (await call("superadmin", "GET", "/api/reports/reconciliation")).body.report.funding.organizations
      .find((row: Json) => row.organizationId === f.ids.orgA);
    expect(org.staleHolds).toEqual([expect.objectContaining({ sourceId: sessionId, reasons: ["ADMITTED_WITHOUT_RESERVATION"] })]);
  });

  it("C3: the funding cutover is the earlier of the setting and the applied migration, and fails closed on an unparsable setting", async () => {
    const applied = await f.db.$queryRaw<{ finishedAt: Date }[]>`
      SELECT finished_at AS "finishedAt" FROM "_prisma_migrations" WHERE migration_name = '20261014150000_reward_funding'`;
    const migrationAt = applied[0].finishedAt;
    expect(await resolveFundingCutover(f.db, {})).toEqual({ at: migrationAt, source: "migration" });
    const later = new Date(migrationAt.getTime() + 86_400_000).toISOString();
    expect((await resolveFundingCutover(f.db, { [FUNDING_CUTOVER_ENV]: later })).at).toEqual(migrationAt);
    const earlier = new Date(migrationAt.getTime() - 86_400_000);
    expect(await resolveFundingCutover(f.db, { [FUNDING_CUTOVER_ENV]: earlier.toISOString() })).toEqual({ at: earlier, source: "env" });
    expect((await resolveFundingCutover(f.db, { [FUNDING_CUTOVER_ENV]: "bukan-tanggal" })).at).toBeNull();
  });

  it("C4: every cash-confirming entry shares one case-normalised reference space across organizations, and a concurrent duplicate is a 409", async () => {
    await warmUp();
    const pathA = `/api/organizations/${f.ids.orgA}/funding`;
    const pathB = `/api/organizations/${f.ids.orgB}/funding`;
    const first = await call("superadmin", "POST", pathA, { amount: 1_000, reference: "BANK-C4", note: NOTE });
    expect(first.status).toBe(201);
    // A positive correction with the same reference (other case, other organization) confirms no cash twice.
    const reused = await call("superadmin", "POST", pathB, { kind: "CORRECTION", amount: 500, reference: " bank-c4 ", note: NOTE });
    expect(reused.status).toBe(409);
    expect(reused.body.error).toMatch(/organisasi lain/);
    expect(await f.db.fundingEntry.count()).toBe(1);
    // The same organization and amount, other case: idempotent.
    const replay = await call("superadmin", "POST", pathA, { amount: 1_000, reference: "bank-c4", note: NOTE });
    expect(replay.status).toBe(200);
    expect(replay.body.idempotent).toBe(true);
    // A negative correction references the transfer it reverses; it is not a cash confirmation.
    const reversal = await call("superadmin", "POST", pathA, { kind: "CORRECTION", amount: -200, reference: "BANK-C4", note: NOTE });
    expect(reversal.status).toBe(201);
    expect(await account()).toMatchObject({ confirmedRupiah: 800 });

    // Deterministic race: organization B's entry with the same reference is inserted but not yet committed by
    // another session; organization A's request waits on the unique index and ends as a 409, never a 500.
    const connection = await f.connection();
    const observer = await f.connection();
    const accountB = await f.db.rewardFundingAccount.upsert({
      where: { organizationId: f.ids.orgB }, update: {}, create: { organizationId: f.ids.orgB } });
    const locked = deferred<number>();
    const release = deferred();
    const holder = connection.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.fundingEntry.create({ data: {
        accountId: accountB.id, businessKey: fundingCashKey("BANK-RACE"), kind: "CONFIRMED_TOPUP", amount: 1_000,
        reference: "BANK-RACE", note: NOTE, verifiedById: f.ids.superadmin } });
      locked.resolve(pid);
      await release.promise;
    }, { maxWait: 10_000, timeout: 60_000 });
    holder.catch((error) => locked.reject(error));
    const holderPid = await locked.promise;
    const racing = call("superadmin", "POST", pathA, { amount: 1_000, reference: "BANK-RACE", note: NOTE });
    racing.catch(() => {});
    await waitForBlockedBy(observer, { holderPid, timeoutMs: 15_000 });
    expect(await isStillPending(racing, 100)).toBe(true);
    release.resolve();
    await holder;
    const raced = await racing;
    expect(raced.status).toBe(409);
    expect(raced.body.error).toMatch(/organisasi lain/);
    expect(await f.db.fundingEntry.count({ where: { reference: "BANK-RACE" } })).toBe(1);
    expect(await account()).toMatchObject({ confirmedRupiah: 800 });
  });
});

describe("funding visibility in the reconciliation report", () => {
  it("reports confirmed, held and capacity per organization in the v1 contract shape, keeping the M05 allocation invariant", async () => {
    await warmUp();
    await setMachineCeiling(f.ids.machineA, 10_000);
    await f.confirmFunding(25_000);
    const started = await scan("userA");
    await deposit(started.body.session.id);
    await f.seedCredit({ organization: "B", amount: 3_000 });

    const live = await call("superadmin", "GET", "/api/reports/reconciliation");
    expect(live.status).toBe(200);
    const parsed = reconciliationReportResponseV1.parse(live.body);
    const { funding } = parsed.report;
    expect(funding).toMatchObject({ enforced: false, totalConfirmedRupiah: 25_000, totalHeldRupiah: 10_000, staleHoldCount: 0 });
    expect(funding.organizations.map((org) => [org.organizationId, org.confirmedRupiah, org.heldRupiah, org.capacityRupiah, org.activeReservations]))
      .toEqual(expect.arrayContaining([[f.ids.orgA, 25_000, 10_000, 15_000, 1], [f.ids.orgB, 0, 0, 0, 0]]));
    // The user-side figures and the M05 allocation invariant are untouched by the program side.
    expect(parsed.report.availableLiability).toBe(3_100);
    expect(parsed.report.allocationStatus).toBe("NOT_ALLOCATED_UNTIL_B01");
    expect(parsed.report.organizations.reduce((sum, org) => sum + org.outstanding, 0) + parsed.report.unallocatedLegacyAmount).toBe(3_100);
    expect((await call("adminA", "GET", "/api/reports/reconciliation")).status).toBe(403);
  });
});
