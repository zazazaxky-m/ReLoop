import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getWalletBalance } from "@/lib/ledger";
import { signMachinePayload } from "@/lib/machine-auth";
import type { CurrentUser } from "@/lib/rbac";
import type { AppRole } from "@/lib/roles";
import { f, type ActorKey } from "../support/audit-fixture";
import { scanSessionResponseV1 } from "../support/contracts";
import { deferred, isStillPending } from "../support/race-probe";

/**
 * R03 (SEC-09, EX-04) against the real Next server, PostgreSQL and Redis:
 * one active deposit session per machine, decided under User -> Machine row
 * locks; a session leaves the machine only through finish/cancel (never while
 * the machine is still deciding an item) or the timeout policy (after every
 * lease issued for it expired; undecided items go to review); the machine
 * lease never picks one of several live sessions; machine nonces outlive the
 * whole signature window.
 */

const ROOT = path.resolve(__dirname, "../..");
const ACTIVE = ["RESERVED", "ACTIVE", "PROCESSING_ITEM", "REVIEW"] as const;
const ENFORCE_MIGRATION = "prisma/migrations/20261014120100_one_active_machine_session_enforce/migration.sql";
const ACTIVE_INDEX = "DepositSession_one_active_per_machine";

const MACHINE_IN_USE = "Mesin sedang digunakan. Silakan coba lagi nanti atau gunakan mesin lain.";
const MACHINE_UNAVAILABLE = "Mesin sedang tidak dapat digunakan. Silakan gunakan mesin lain.";
const ITEM_STILL_PROCESSING = "Mesin masih memproses item terakhir Anda. Tunggu sebentar, lalu coba lagi.";

type Json = Record<string, any>;
type EdgeEvent = {
  localEventId: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  sessionId: string | null;
  depositItemId: string | null;
  occurredAt: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(actor: ActorKey, method: string, urlPath: string, body?: unknown) {
  const response = await f.json(actor, method, urlPath, body);
  return { status: response.status, body: (await response.json().catch(() => null)) as Json };
}

const scan = (actor: ActorKey, body: Record<string, unknown>) => call(actor, "POST", "/api/scan", body);
const patchSession = (actor: ActorKey, id: string, action: "finish" | "cancel") =>
  call(actor, "PATCH", `/api/sessions/${id}`, { action });

async function ingestSecret(): Promise<string> {
  const machine = await f.db.machine.findUniqueOrThrow({ where: { id: f.ids.machineA } });
  if (!machine.ingestSecret) throw new Error("fixture machine has no ingest secret");
  return machine.ingestSecret;
}

function signedHeaders(secret: string, raw: string, nonce = randomUUID().replaceAll("-", "")) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    "x-reloop-machine": f.ids.machineCode,
    "x-reloop-timestamp": timestamp,
    "x-reloop-nonce": nonce,
    "x-reloop-signature": signMachinePayload(secret, timestamp, nonce, raw),
  };
}

/** The RVM's session-bridge poll (rvm/sync.py fetch_machine_session). */
async function machineSession(nonce?: string) {
  const response = await fetch(new URL(`/api/machine-session/${f.ids.machineCode}`, process.env.AUDIT_BASE_URL), {
    headers: signedHeaders(await ingestSecret(), "", nonce),
  });
  return { status: response.status, body: (await response.json()) as Json };
}

/** Signs and sends an event batch exactly like rvm/sync.py does. */
async function postEvents(events: EdgeEvent[]) {
  const raw = JSON.stringify({ machineCode: f.ids.machineCode, events });
  const response = await fetch(new URL("/api/machine-events", process.env.AUDIT_BASE_URL), {
    method: "POST",
    headers: { "content-type": "application/json", ...signedHeaders(await ingestSecret(), raw) },
    body: raw,
  });
  const body = (await response.json()) as Json;
  expect(response.status).toBe(200);
  expect(body.results.map((r: Json) => r.status)).toEqual(events.map(() => "accepted"));
  return body;
}

function edgeEvent(sessionId: string | null, eventType: string, payload: Record<string, unknown> = {},
  depositItemId: string | null = null): EdgeEvent {
  return { localEventId: randomUUID(), eventType, payload, sessionId, depositItemId, occurredAt: new Date().toISOString() };
}

async function wasteTypeId() {
  const link = await f.db.machineWasteType.findFirstOrThrow({ where: { machineId: f.ids.machineA, active: true } });
  return link.wasteTypeId;
}

const activeCount = () => f.db.depositSession.count({ where: { machineId: f.ids.machineA, status: { in: [...ACTIVE] } } });

async function actorOf(userId: string): Promise<CurrentUser> {
  const user = await f.db.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role as AppRole,
    organizationId: user.organizationId, organizationName: null, payoutEligible: false, status: user.status,
  };
}

/** Compiles the routes in `next dev` before a test holds locks or races requests. */
async function warmUp() {
  expect((await scan("userA", { machineCode: f.ids.machineCode, token: "warm-up" })).status).toBe(401);
  expect((await machineSession()).status).toBe(200);
  const raw = JSON.stringify({ machineCode: f.ids.machineCode, events: [] });
  const events = await fetch(new URL("/api/machine-events", process.env.AUDIT_BASE_URL), {
    method: "POST", headers: { "content-type": "application/json", ...signedHeaders(await ingestSecret(), raw) }, body: raw,
  });
  expect(events.status).toBe(200);
  expect((await patchSession("userA", "missing-session", "finish")).status).toBe(404);
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

/** FOR UPDATE conflicts with both the scan's machine lock and a session insert's foreign-key check. */
const lockMachineRow = (tx: Prisma.TransactionClient) =>
  tx.$queryRaw`SELECT id FROM "Machine" WHERE id = ${f.ids.machineA} FOR UPDATE`;

/** Backends blocked by `holderPid`, directly or behind another waiter. */
async function waitForWaiters(observer: PrismaClient, holderPid: number, count: number, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await observer.$queryRaw<{ pid: number }[]>`
      WITH RECURSIVE chain(pid) AS (
        SELECT pid FROM pg_stat_activity WHERE ${holderPid}::int = ANY(pg_blocking_pids(pid))
        UNION
        SELECT a.pid FROM pg_stat_activity a JOIN chain c ON c.pid = ANY(pg_blocking_pids(a.pid))
      )
      SELECT pid FROM chain`;
    if (rows.length >= count) return rows.map((row) => row.pid);
    await sleep(25);
  }
  throw new Error(`fewer than ${count} backend(s) were blocked by ${holderPid} within ${timeoutMs}ms`);
}

/**
 * Deterministic ordering: the machine row is held, `first` is proven blocked
 * on it, then `second` is proven blocked too, then the row is released.
 */
async function inOrder<A, B>(first: () => Promise<A>, second: () => Promise<B>): Promise<[A, B]> {
  const observer = await f.connection();
  const holder = await holdLock(lockMachineRow);
  let a: Promise<A> | undefined;
  let b: Promise<B> | undefined;
  try {
    a = first();
    a.catch(() => {});
    await waitForWaiters(observer, holder.pid, 1);
    b = second();
    b.catch(() => {});
    await waitForWaiters(observer, holder.pid, 2);
    expect(await isStillPending(a, 100)).toBe(true);
  } finally {
    await holder.release();
  }
  return [await a!, await b!];
}

function expectNoOwnerDetails(body: Json, owner: { userId: string; sessionId: string }, ownerUser: { name: string; email: string }) {
  const text = JSON.stringify(body);
  for (const secret of [owner.userId, owner.sessionId, ownerUser.name, ownerUser.email]) {
    expect(text).not.toContain(secret);
  }
}

describe("one active deposit session per machine (EX-04)", () => {
  it("only one user gets a session on one machine",async()=>{
    const body={machineCode:f.ids.machineCode,token:await f.machineQrToken()};
    const responses=await Promise.all([
      f.json("userA","POST","/api/scan",body),
      f.json("userB","POST","/api/scan",body),
    ]);
    expect(responses.map(r=>r.status).sort()).toEqual([201,409]);
    expect(await f.db.depositSession.count({where:{machineId:f.ids.machineA,
      status:{in:["RESERVED","ACTIVE","PROCESSING_ITEM","REVIEW"]}}})).toBe(1);
  });

  it("serializes concurrent scans on the machine row: the first user starts, the other gets a neutral 409 (deterministic)", async () => {
    await warmUp();
    const body = { machineCode: f.ids.machineCode, token: await f.machineQrToken() };
    const [a, b] = await inOrder(() => scan("userA", body), () => scan("userB", body));
    expect([a.status, b.status]).toEqual([201, 409]);
    expect(scanSessionResponseV1.parse(a.body).resumed).toBe(false);
    expect(a.body.session.userId).toBe(f.ids.userA);
    expect(b.body).toEqual({ error: MACHINE_IN_USE });
    const owner = await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } });
    expectNoOwnerDetails(b.body, { userId: f.ids.userA, sessionId: a.body.session.id }, owner);
    expect(await activeCount()).toBe(1);
  });

  it("two scans by the same user resume one session (deterministic)", async () => {
    await warmUp();
    const body = { machineCode: f.ids.machineCode, token: await f.machineQrToken() };
    const [first, second] = await inOrder(() => scan("userA", body), () => scan("userA", body));
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(first.body.resumed).toBe(false);
    expect(second.body.resumed).toBe(true);
    expect(second.body.session.id).toBe(first.body.session.id);
    // A resume returns the same machine summary and changes nothing.
    expect(scanSessionResponseV1.parse(second.body).machine).toEqual(scanSessionResponseV1.parse(first.body).machine);
    const row = await f.db.depositSession.findUniqueOrThrow({ where: { id: first.body.session.id } });
    expect(row.timeoutAt?.toISOString()).toBe(first.body.session.timeoutAt);
    expect(await activeCount()).toBe(1);
  });

  it("re-reads the token, machine state and campaign under the locks before creating", async () => {
    await warmUp();
    const token = await f.machineQrToken();
    // Token rotated (the machine screen shows a new QR) between the user's scan and the decision.
    await f.machineQrToken();
    expect((await scan("userA", { machineCode: f.ids.machineCode, token })).status).toBe(401);
    const fresh = await f.machineQrToken();
    await f.db.machine.update({ where: { id: f.ids.machineA }, data: { status: "MAINTENANCE" } });
    expect(await scan("userA", { machineCode: f.ids.machineCode, token: fresh }))
      .toEqual({ status: 409, body: { error: "Mesin tidak menerima setoran saat ini" } });
    await f.db.machine.update({ where: { id: f.ids.machineA }, data: { status: "ONLINE" } });
    // M04 guard stays: a trip program can never bind a machine session.
    const trashBag = await f.db.campaign.findFirstOrThrow({ where: { organizationId: f.ids.orgA, campaignType: "TRASH_BAG" } });
    expect(await scan("userA", { machineCode: f.ids.machineCode, token: fresh, campaignId: trashBag.id }))
      .toEqual({ status: 422, body: { error: "Campaign ini tidak berlaku untuk setoran mesin" } });
    const program = await f.db.campaign.findFirstOrThrow({ where: { organizationId: f.ids.orgA, campaignType: "MACHINE_DEPOSIT" } });
    const started = await scan("userA", { machineCode: f.ids.machineCode, token: fresh, campaignId: program.id });
    expect(started.status).toBe(201);
    expect(started.body.session.campaignId).toBe(program.id);
    expect(await activeCount()).toBe(1);
  });

  it("maps a unique-index race (a writer that skipped the machine lock) to 409 for another user and to a resume for the owner", async () => {
    const { startOrResumeDeposit } = await import("@/lib/deposit-session-service");
    const other = await f.connection();
    const later = () => new Date(Date.now() + 5 * 60_000);

    let injected = "";
    const token = await f.machineQrToken();
    await expect(startOrResumeDeposit(await actorOf(f.ids.userB), { machineCode: f.ids.machineCode, token }, {
      beforeCreate: async () => {
        injected = (await other.depositSession.create({
          data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE", timeoutAt: later() } })).id;
      },
    })).rejects.toMatchObject({ status: 409, message: MACHINE_IN_USE });
    expect(injected).not.toBe("");
    expect(await f.db.depositSession.findMany({ where: { machineId: f.ids.machineA }, select: { id: true } }))
      .toEqual([{ id: injected }]);

    await f.db.depositSession.update({ where: { id: injected }, data: { status: "COMPLETED", completedAt: new Date() } });
    let mine = "";
    const resumed = await startOrResumeDeposit(await actorOf(f.ids.userA), { machineCode: f.ids.machineCode, token }, {
      beforeCreate: async () => {
        mine = (await other.depositSession.create({
          data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE", timeoutAt: later() } })).id;
      },
    });
    expect(resumed.resumed).toBe(true);
    expect(resumed.session.id).toBe(mine);
    expect(await activeCount()).toBe(1);
  });

  it("gives the owner a read-only active-session summary and another user nothing", async () => {
    const { getActiveDepositForUser } = await import("@/lib/deposit-session-service");
    const started = await scan("userA", { machineCode: f.ids.machineCode, token: await f.machineQrToken() });
    expect(started.status).toBe(201);
    const before = await f.db.depositSession.findUniqueOrThrow({ where: { id: started.body.session.id } });

    const owned = await getActiveDepositForUser(f.ids.userA, f.ids.machineCode);
    expect(owned.session).toMatchObject({
      id: before.id, status: "ACTIVE", machine: { id: f.ids.machineA, machineCode: f.ids.machineCode }, items: [] });
    expect(owned.sessions.map((s) => s.id)).toEqual([before.id]);
    expect((await getActiveDepositForUser(f.ids.userA)).session?.id).toBe(before.id);

    const stranger = await getActiveDepositForUser(f.ids.userB, f.ids.machineCode);
    expect(stranger).toEqual({ session: null, sessions: [] });
    expect(await getActiveDepositForUser(f.ids.userB)).toEqual({ session: null, sessions: [] });

    // Several active sessions (two machines) without a machine code: never pick one silently.
    const second = await f.db.machine.create({ data: {
      organizationId: f.ids.orgA, machineCode: `AUDIT-R03-${randomUUID().slice(0, 8)}`, name: "Mesin Audit R03", status: "ONLINE" } });
    await f.db.depositSession.create({ data: {
      userId: f.ids.userA, machineId: second.id, status: "ACTIVE", timeoutAt: new Date(Date.now() + 60_000) } });
    const both = await getActiveDepositForUser(f.ids.userA);
    expect(both.session).toBeNull();
    expect(both.sessions).toHaveLength(2);

    // No new lease, no timeout extension, no write.
    const after = await f.db.depositSession.findUniqueOrThrow({ where: { id: before.id } });
    expect(after).toEqual(before);
  });
});

describe("session release only through finish/cancel or the timeout policy", () => {
  it("finish and cancel wait while the machine still decides an item; the decided item then lets the session end", async () => {
    await warmUp();
    const started = await scan("userA", { machineCode: f.ids.machineCode, token: await f.machineQrToken() });
    expect(started.status).toBe(201);
    const sessionId = started.body.session.id as string;
    await postEvents([edgeEvent(sessionId, "ITEM_DETECTED", { wasteTypeId: await wasteTypeId(), quantity: 1 })]);
    const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId } });
    expect(item.status).toBe("PENDING");

    expect(await patchSession("userA", sessionId, "finish")).toEqual({ status: 409, body: { error: ITEM_STILL_PROCESSING } });
    expect(await patchSession("userA", sessionId, "cancel")).toEqual({ status: 409, body: { error: ITEM_STILL_PROCESSING } });
    expect((await f.db.depositSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("PROCESSING_ITEM");
    // The machine stays exclusive meanwhile.
    expect((await scan("userB", { machineCode: f.ids.machineCode, token: await f.machineQrToken() })).status).toBe(409);

    // The machine returns the item: decided, nothing in transit any more.
    await postEvents([edgeEvent(sessionId, "ITEM_REJECTED", { reason: "ABNORMAL_WEIGHT" })]);
    expect((await f.db.depositItem.findUniqueOrThrow({ where: { id: item.id } })).status).toBe("REJECTED");
    const finished = await patchSession("userA", sessionId, "finish");
    expect(finished.status).toBe(200);
    expect(finished.body.session).toMatchObject({ id: sessionId, status: "COMPLETED" });
    expect(await activeCount()).toBe(0);

    // An item held for review before its acceptance point never blocks the end of a session.
    const next = await scan("userA", { machineCode: f.ids.machineCode, token: await f.machineQrToken() });
    expect(next.status).toBe(201);
    await postEvents([edgeEvent(next.body.session.id, "ITEM_DETECTED", { quantity: 1 })]); // unknown type -> REVIEW
    expect((await f.db.depositItem.findFirstOrThrow({ where: { sessionId: next.body.session.id } })).status).toBe("REVIEW");
    const cancelled = await patchSession("userA", next.body.session.id, "cancel");
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.session.status).toBe("CANCELLED");
  });

  it("once every lease expired, the owner's finish closes a session stuck on an undecided item through the timeout policy", async () => {
    await warmUp();
    const started = await scan("userA", { machineCode: f.ids.machineCode, token: await f.machineQrToken() });
    const sessionId = started.body.session.id as string;
    await postEvents([edgeEvent(sessionId, "ITEM_DETECTED", { wasteTypeId: await wasteTypeId(), quantity: 1 })]);
    const item = await f.db.depositItem.findFirstOrThrow({ where: { sessionId } });
    // The machine died mid-item: nothing decides it, and its last lease ran out.
    await f.db.depositSession.update({ where: { id: sessionId }, data: { timeoutAt: new Date(Date.now() - 1_000) } });

    const closed = await patchSession("userA", sessionId, "finish");
    expect(closed.status).toBe(200);
    expect(closed.body.session).toMatchObject({ id: sessionId, status: "EXPIRED" });
    expect(await f.db.depositItem.findUniqueOrThrow({ where: { id: item.id } }))
      .toMatchObject({ status: "REVIEW", validationReasonCode: "SESSION_TIMEOUT", acceptanceEventId: null });
    expect(await f.db.rewardLedger.count({ where: { sessionId } })).toBe(0);
    expect(await activeCount()).toBe(0);
    const audit = await f.db.auditLog.findFirst({ where: { action: "DEPOSIT_SESSION_EXPIRE", entityId: sessionId } });
    expect(audit?.metadataJson).toMatchObject({ reason: "TIMEOUT", closedBy: "owner", heldItemIds: [item.id] });
  });

  it("an item the machine reports after the session ended is held for review in that session, never in a later one", async () => {
    await warmUp();
    const started = await scan("userA", { machineCode: f.ids.machineCode, token: await f.machineQrToken() });
    const sessionId = started.body.session.id as string;
    const timeoutAt = started.body.session.timeoutAt as string;
    expect((await patchSession("userA", sessionId, "finish")).status).toBe(200);

    await postEvents([edgeEvent(sessionId, "ITEM_DETECTED", { wasteTypeId: await wasteTypeId(), quantity: 1 })]);
    const late = await f.db.depositItem.findFirstOrThrow({ where: { sessionId } });
    expect(late).toMatchObject({ status: "REVIEW", validationReasonCode: "SESSION_CLOSED", acceptanceEventId: null });
    const closed = await f.db.depositSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(closed.status).toBe("COMPLETED");
    expect(closed.timeoutAt?.toISOString()).toBe(timeoutAt); // a closed session is never extended
  });

  it("timeout policy: the lease never outlives the deadline; an expired session closes on the next poll and its undecided item goes to review", async () => {
    await warmUp();
    const started = await scan("userA", { machineCode: f.ids.machineCode, token: await f.machineQrToken() });
    const s1 = started.body.session.id as string;
    await postEvents([
      edgeEvent(s1, "ITEM_DETECTED", { wasteTypeId: await wasteTypeId(), quantity: 1 }),
      edgeEvent(s1, "WEIGHT_MEASURED", { weightGrams: 25 }),
    ]);
    const i1 = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: s1 } });

    const leased = await machineSession();
    expect(leased.body.lease.sessionId).toBe(s1);
    const deadline = (await f.db.depositSession.findUniqueOrThrow({ where: { id: s1 } })).timeoutAt!;
    expect(leased.body.lease.expiresAt * 1000).toBeLessThanOrEqual(deadline.getTime());

    // Not yet timed out: another user is refused and the session is not touched.
    const untouched = await f.db.depositSession.findUniqueOrThrow({ where: { id: s1 } });
    expect((await scan("userB", { machineCode: f.ids.machineCode, token: await f.machineQrToken() })).status).toBe(409);
    expect(await f.db.depositSession.findUniqueOrThrow({ where: { id: s1 } })).toEqual(untouched);

    // Every lease issued for s1 expired: the next machine poll closes it.
    await f.db.depositSession.update({ where: { id: s1 }, data: { timeoutAt: new Date(Date.now() - 1_000) } });
    const ended = await machineSession();
    expect(ended.body).toMatchObject({ lease: null, session: null });
    expect(await f.db.depositSession.findUniqueOrThrow({ where: { id: s1 } })).toMatchObject({ status: "EXPIRED" });
    expect(await f.db.depositItem.findUniqueOrThrow({ where: { id: i1.id } }))
      .toMatchObject({ status: "REVIEW", validationReasonCode: "SESSION_TIMEOUT", acceptanceEventId: null, rewardAmount: 0 });
    expect(await f.db.rewardLedger.count({ where: { sessionId: s1 } })).toBe(0);
    const audit = await f.db.auditLog.findFirst({ where: { action: "DEPOSIT_SESSION_EXPIRE", entityId: s1 } });
    expect(audit?.metadataJson).toMatchObject({ reason: "TIMEOUT", heldItemIds: [i1.id] });
  });

  it("a late acceptance event of the previous session pays that session's item and owner, never the next user's", async () => {
    await warmUp();
    const typeId = await wasteTypeId();
    const s1 = (await scan("userA", { machineCode: f.ids.machineCode, token: await f.machineQrToken() })).body.session.id as string;
    await postEvents([edgeEvent(s1, "ITEM_DETECTED", { wasteTypeId: typeId, quantity: 1 }), edgeEvent(s1, "WEIGHT_MEASURED", { weightGrams: 25 })]);
    const i1 = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: s1 } });
    // The machine went quiet (offline); its lease ran out and s1 timed out.
    await f.db.depositSession.update({ where: { id: s1 }, data: { timeoutAt: new Date(Date.now() - 1_000) } });

    // The next user scans: the timeout policy closes s1 (never overwrites it) and starts s2.
    const second = await scan("userB", { machineCode: f.ids.machineCode, token: await f.machineQrToken() });
    expect(second.status).toBe(201);
    const s2 = second.body.session.id as string;
    expect((await f.db.depositSession.findUniqueOrThrow({ where: { id: s1 } })).status).toBe("EXPIRED");
    expect((await f.db.depositItem.findUniqueOrThrow({ where: { id: i1.id } })).status).toBe("REVIEW");
    expect((await machineSession()).body.lease.sessionId).toBe(s2);
    await postEvents([edgeEvent(s2, "ITEM_DETECTED", { wasteTypeId: typeId, quantity: 1 })]);
    const i2 = await f.db.depositItem.findFirstOrThrow({ where: { sessionId: s2 } });

    // An inconsistent late event (s1 naming s2's item) is recorded but touches no item.
    const crossed = edgeEvent(s1, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true }, i2.id);
    await postEvents([crossed]);
    expect(await f.db.depositItem.findUniqueOrThrow({ where: { id: i1.id } })).toMatchObject({ status: "REVIEW", acceptanceEventId: null });
    expect(await f.db.depositItem.findUniqueOrThrow({ where: { id: i2.id } })).toMatchObject({ status: "PENDING", acceptanceEventId: null });
    const crossedRow = await f.db.machineEvent.findFirstOrThrow({ where: { localEventId: crossed.localEventId } });
    expect(crossedRow.depositItemId).toBeNull();
    expect(crossedRow.payloadJson).toMatchObject({ orphanedReferences: { depositItemId: i2.id } });

    // The queued acceptance point of s1 arrives: s1's item and s1's owner.
    const before = { a: await getWalletBalance(f.ids.userA), b: await getWalletBalance(f.ids.userB) };
    const accepted = edgeEvent(s1, "ITEM_ACCEPTED_POINT", { acceptanceBeam: true });
    await postEvents([accepted]);
    const acceptedRow = await f.db.machineEvent.findFirstOrThrow({ where: { localEventId: accepted.localEventId } });
    const priced = await f.db.depositItem.findUniqueOrThrow({ where: { id: i1.id } });
    expect(priced).toMatchObject({ status: "ACCEPTED", acceptanceEventId: acceptedRow.id });
    const earn = await f.db.rewardLedger.findMany({ where: { depositItemId: i1.id } });
    expect(earn).toHaveLength(1);
    expect(earn[0]).toMatchObject({ userId: f.ids.userA, sessionId: s1, entryType: "EARN", status: "AVAILABLE" });
    expect((await getWalletBalance(f.ids.userA)).available).toBe(before.a.available + earn[0].amount);
    expect(await getWalletBalance(f.ids.userB)).toEqual(before.b);
    expect(await f.db.depositItem.findUniqueOrThrow({ where: { id: i2.id } })).toMatchObject({ status: "PENDING", acceptanceEventId: null });
    expect(await f.db.rewardLedger.count({ where: { sessionId: s2 } })).toBe(0);
    expect((await f.db.depositSession.findUniqueOrThrow({ where: { id: s1 } })).status).toBe("EXPIRED");
  });

  it("a REVIEW session without timeoutAt stops blocking the machine once idle; items and money are kept", async () => {
    await warmUp();
    const machine = await f.db.machine.findUniqueOrThrow({ where: { id: f.ids.machineA } });
    const idleMs = machine.sessionIdleTimeoutMinutes * 60_000;
    const typeId = await wasteTypeId();
    const reviewSession = async (updatedAt: Date) => {
      const session = await f.db.depositSession.create({ data: {
        userId: f.ids.userA, machineId: f.ids.machineA, status: "REVIEW", timeoutAt: null, startedAt: updatedAt, updatedAt } });
      const item = await f.db.depositItem.create({ data: {
        sessionId: session.id, wasteTypeId: typeId, quantity: 1, measuredWeightGrams: 25, status: "REVIEW",
        validationReasonCode: "REVERSE_MOTION", acceptedAt: updatedAt, acceptanceEventId: `evt-${randomUUID()}`,
        complianceMultiplier: 0.5, baseRewardAmount: 100, rewardAmount: 50, source: "MACHINE" } });
      await f.db.rewardLedger.create({ data: {
        userId: f.ids.userA, organizationId: f.ids.orgA, sessionId: session.id, depositItemId: item.id, entryType: "EARN",
        amount: 50, status: "PENDING", reasonCode: "REVERSE_MOTION", referenceType: "DepositItem", referenceId: item.id,
        businessKey: `deposit-item:${item.id}:earn` } });
      return { session, item };
    };

    // Recently active: still the owner's, leased only up to updatedAt + idle.
    const fresh = await reviewSession(new Date(Date.now() - 30_000));
    expect((await scan("userB", { machineCode: f.ids.machineCode, token: await f.machineQrToken() })).status).toBe(409);
    const lease = (await machineSession()).body.lease;
    expect(lease.sessionId).toBe(fresh.session.id);
    expect(lease.expiresAt * 1000).toBeLessThanOrEqual(fresh.session.updatedAt.getTime() + idleMs);

    // Idle past the machine's idle timeout: the poll closes it through the timeout policy.
    await f.db.depositSession.update({ where: { id: fresh.session.id }, data: { updatedAt: new Date(Date.now() - idleMs - 1_000) } });
    expect((await machineSession()).body).toMatchObject({ lease: null, session: null });
    expect((await f.db.depositSession.findUniqueOrThrow({ where: { id: fresh.session.id } })).status).toBe("EXPIRED");
    expect(await f.db.depositItem.findUniqueOrThrow({ where: { id: fresh.item.id } }))
      .toMatchObject({ status: "REVIEW", validationReasonCode: "REVERSE_MOTION", rewardAmount: 50 });
    expect(await f.db.rewardLedger.findMany({ where: { depositItemId: fresh.item.id }, select: { amount: true, status: true } }))
      .toEqual([{ amount: 50, status: "PENDING" }]);

    // The same through the scan path: another user's scan closes a stale one and starts.
    const stale = await reviewSession(new Date(Date.now() - idleMs - 60_000));
    const started = await scan("userB", { machineCode: f.ids.machineCode, token: await f.machineQrToken() });
    expect(started.status).toBe(201);
    expect((await f.db.depositSession.findUniqueOrThrow({ where: { id: stale.session.id } })).status).toBe("EXPIRED");
    expect(await f.db.depositItem.count({ where: { sessionId: stale.session.id } })).toBe(1);
    expect(await f.db.rewardLedger.count({ where: { depositItemId: stale.item.id } })).toBe(1);
  });
});

describe("legacy duplicates: no ambiguous lease, dry-run reconcile, guarded enforce", () => {
  function enforceSql() {
    const sql = readFileSync(path.join(ROOT, ENFORCE_MIGRATION), "utf8");
    const guard = sql.match(/DO \$\$[\s\S]*?END \$\$;/)![0];
    const createIndex = sql.match(/CREATE UNIQUE INDEX "DepositSession_one_active_per_machine"[\s\S]*?;/)![0];
    return { sql, guard, createIndex };
  }

  it("the enforce migration is guarded, never writes rows, and builds exactly the brief's partial unique index", async () => {
    const { sql, guard } = enforceSql();
    const statements = sql.replace(/--.*$/gm, "");
    expect(statements).not.toMatch(/\b(UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/i);
    expect(sql).toContain("scripts/reconcile-active-sessions.ts");
    const [index] = await f.db.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = ${ACTIVE_INDEX}`;
    expect(index.indexdef).toBe(
      `CREATE UNIQUE INDEX "${ACTIVE_INDEX}" ON public."DepositSession" USING btree ("machineId") WHERE ` +
      `(status = ANY (ARRAY['RESERVED'::"SessionStatus", 'ACTIVE'::"SessionStatus", 'PROCESSING_ITEM'::"SessionStatus", 'REVIEW'::"SessionStatus"]))`);
    // Clean database: the guard passes.
    await f.db.$executeRawUnsafe(guard);
    // A second active session on the machine is refused by the database itself.
    await f.db.depositSession.create({ data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE" } });
    await expect(f.db.depositSession.create({ data: { userId: f.ids.userB, machineId: f.ids.machineA, status: "REVIEW" } }))
      .rejects.toMatchObject({ code: "P2002" });
    await f.db.depositSession.create({ data: { userId: f.ids.userB, machineId: f.ids.machineA, status: "COMPLETED" } });
  });

  it("expand phase (no index yet): the machine row lock alone keeps concurrent scans exclusive", async () => {
    await warmUp();
    const { createIndex } = enforceSql();
    await f.db.$executeRawUnsafe(`DROP INDEX "${ACTIVE_INDEX}"`);
    try {
      const body = { machineCode: f.ids.machineCode, token: await f.machineQrToken() };
      const [a, b] = await inOrder(() => scan("userA", body), () => scan("userB", body));
      expect([a.status, b.status]).toEqual([201, 409]);
      expect(b.body).toEqual({ error: MACHINE_IN_USE });
      const [c, d] = await inOrder(() => scan("userA", body), () => scan("userA", body));
      expect([c.status, d.status]).toEqual([200, 200]);
      expect([c.body.session.id, d.body.session.id]).toEqual([a.body.session.id, a.body.session.id]);
      expect(await activeCount()).toBe(1);
    } finally {
      // Test cleanup only: if the lock failed, keep the first session so the index can be rebuilt.
      const open = await f.db.depositSession.findMany({
        where: { machineId: f.ids.machineA, status: { in: [...ACTIVE] } }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] });
      await f.db.depositSession.updateMany({ where: { id: { in: open.slice(1).map((s) => s.id) } }, data: { status: "CANCELLED" } });
      await f.db.$executeRawUnsafe(createIndex);
    }
  });

  it("stops the lease and refuses scans for a machine with two live sessions, lists them read-only, and lets the timeout policy resolve them", async () => {
    await warmUp();
    const { collectActiveSessionConflicts } = await import("@/scripts/reconcile-active-sessions");
    const { guard, createIndex } = enforceSql();
    const created: string[] = [];
    // Simulate a database from before the enforce migration (restored in finally).
    await f.db.$executeRawUnsafe(`DROP INDEX "${ACTIVE_INDEX}"`);
    try {
      const soon = new Date(Date.now() + 2 * 60_000);
      const older = await f.db.depositSession.create({ data: {
        userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE", startedAt: new Date(Date.now() - 60_000), timeoutAt: soon } });
      const newer = await f.db.depositSession.create({ data: {
        userId: f.ids.userB, machineId: f.ids.machineA, status: "PROCESSING_ITEM", startedAt: new Date(), timeoutAt: soon } });
      created.push(older.id, newer.id);
      const pending = await f.db.depositItem.create({ data: { sessionId: newer.id, wasteTypeId: await wasteTypeId(), status: "PENDING" } });
      const evidence = await f.db.machineEvent.create({ data: {
        machineId: f.ids.machineA, sessionId: newer.id, depositItemId: pending.id, localEventId: `evt-${randomUUID()}`,
        eventType: "ITEM_DETECTED", occurredAt: new Date() } });

      // No lease for either: the machine stops instead of picking the newest.
      const poll = await machineSession();
      expect(poll.status).toBe(200);
      expect(poll.body).toMatchObject({ lease: null, session: null, sessionConflict: true });
      for (const actor of ["userA", "userB"] as const) {
        expect(await scan(actor, { machineCode: f.ids.machineCode, token: await f.machineQrToken() }))
          .toEqual({ status: 409, body: { error: MACHINE_UNAVAILABLE } });
      }

      const inventory = await f.db.$transaction(async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        return collectActiveSessionConflicts(tx);
      }, { isolationLevel: "RepeatableRead" });
      expect(inventory.snapshot).toEqual({ readOnly: "on", isolation: "repeatable read" });
      expect(inventory.summary).toMatchObject({ machinesWithDuplicates: 1, duplicateActiveSessions: 2, blocksEnforcement: 1 });
      expect(inventory.clean).toBe(false);
      const [group] = inventory.duplicateActiveSessions;
      expect(group).toMatchObject({ machineId: f.ids.machineA, machineCode: f.ids.machineCode });
      expect(group.sessions.map((s) => [s.sessionId, s.userId, s.status])).toEqual([
        [older.id, f.ids.userA, "ACTIVE"], [newer.id, f.ids.userB, "PROCESSING_ITEM"]]);
      expect(group.sessions[1]).toMatchObject({
        undecidedItemIds: [pending.id], eventCount: 1,
        lastEvent: { id: evidence.id, eventType: "ITEM_DETECTED", localEventId: evidence.localEventId } });

      // The enforce guard refuses with counts and the reconcile pointer, and changes nothing.
      const rowsBefore = await f.db.depositSession.findMany({ where: { machineId: f.ids.machineA }, orderBy: { id: "asc" } });
      await expect(f.db.$executeRawUnsafe(guard)).rejects.toThrow(
        /1 machine\(s\) with more than one active deposit session \(2 sessions\)[\s\S]*scripts\/reconcile-active-sessions\.ts/);
      expect(await f.db.depositSession.findMany({ where: { machineId: f.ids.machineA }, orderBy: { id: "asc" } })).toEqual(rowsBefore);

      // Resolution never picks the newest: the session whose lease expired closes by the timeout policy.
      await f.db.depositSession.update({ where: { id: older.id }, data: { timeoutAt: new Date(Date.now() - 1_000) } });
      const resolved = await machineSession();
      expect(resolved.body.lease.sessionId).toBe(newer.id);
      expect((await f.db.depositSession.findUniqueOrThrow({ where: { id: older.id } })).status).toBe("EXPIRED");
    } finally {
      // Test cleanup only: restore the enforced state for the rest of the run.
      await f.db.depositSession.updateMany({
        where: { id: { in: created }, status: { in: [...ACTIVE] } }, data: { status: "CANCELLED" } });
      await f.db.$executeRawUnsafe(createIndex);
    }
  });
});

describe("machine replay window across app instances (SEC-09)", () => {
  it("a nonce is fresh exactly once across two app instances sharing Redis and lives 2 * skew + 60 s", async () => {
    const { createRedisNonceStore } = await import("@/lib/machine-nonce");
    const serverA = createRedisNonceStore(process.env.REDIS_URL!);
    const serverB = createRedisNonceStore(process.env.REDIS_URL!);
    try {
      const machineId = `audit-${randomUUID()}`;
      const nonce = randomUUID();
      const results = await Promise.all([serverA.consume(machineId, nonce), serverB.consume(machineId, nonce)]);
      expect(results.sort()).toEqual([false, true]);
      expect(await serverA.consume(machineId, nonce)).toBe(false);
      const ttl = await f.redis.pttl(`machine-nonce:${machineId}:${nonce}`);
      expect(ttl).toBeGreaterThan(600_000);
      expect(ttl).toBeLessThanOrEqual(660_000);
    } finally {
      await serverA.close();
      await serverB.close();
    }
  });

  it("the Next server shares the nonce space: a nonce one instance consumed is a replay on the server, and the server stores 660 s TTLs", async () => {
    const { createRedisNonceStore } = await import("@/lib/machine-nonce");
    await warmUp();
    const other = createRedisNonceStore(process.env.REDIS_URL!);
    try {
      const used = randomUUID().replaceAll("-", "");
      expect(await other.consume(f.ids.machineA, used)).toBe(true);
      expect(await machineSession(used)).toMatchObject({ status: 401 });
    } finally {
      await other.close();
    }
    const fresh = randomUUID().replaceAll("-", "");
    expect((await machineSession(fresh)).status).toBe(200);
    expect((await machineSession(fresh)).status).toBe(401);
    const ttl = await f.redis.pttl(`machine-nonce:${f.ids.machineA}:${fresh}`);
    expect(ttl).toBeGreaterThan(600_000);
    expect(ttl).toBeLessThanOrEqual(660_000);
  });

  it("fails closed in production when Redis is unreachable", async () => {
    const { createRedisNonceStore } = await import("@/lib/machine-nonce");
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;
    env.NODE_ENV = "production";
    const down = createRedisNonceStore("redis://127.0.0.1:1");
    try {
      expect(await down.consume("audit-down", randomUUID())).toBe(false);
      expect(await down.consume("audit-down", randomUUID())).toBe(false);
    } finally {
      env.NODE_ENV = previous;
      await down.close();
    }
  });
});
