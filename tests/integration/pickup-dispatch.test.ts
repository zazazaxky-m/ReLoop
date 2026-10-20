import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth";
import { signMachinePayload } from "@/lib/machine-auth";
import { f, type ActorKey, type FixtureActor } from "../support/audit-fixture";
import { deferred, isStillPending, waitForBlockedBy } from "../support/race-probe";

/**
 * B05 (BIZ-04): pickup is admin dispatch. ADMIN/SUPERADMIN assign one ACTIVE
 * partner; the assigned PENGEPUL runs the task. Every decision is a
 * compare-and-set on PickupRequest.version, taken under the pickup row lock.
 */

type Json = Record<string, any>;
const ROOT = path.resolve(__dirname, "../..");

async function call(actor: ActorKey, method: string, route: string, body?: unknown) {
  const response = await f.json(actor, method, route, body);
  return { status: response.status, body: (await response.json().catch(() => null)) as Json };
}

const patch = (actor: ActorKey, id: string, body: Record<string, unknown>) =>
  call(actor, "PATCH", `/api/pickups/${id}`, body);

const row = (id: string) => f.db.pickupRequest.findUniqueOrThrow({ where: { id } });

async function assign(id: string, collector: "collectorA" | "collectorB", extra: Record<string, unknown> = {}) {
  const { version } = await row(id);
  const res = await patch("adminA", id, {
    action: "assign", collectorUserId: f.ids[collector], expectedVersion: version, ...extra,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.pickup as Json;
}

async function step(actor: ActorKey, id: string, action: string, extra: Record<string, unknown> = {}) {
  const { version } = await row(id);
  return patch(actor, id, { action, expectedVersion: version, ...extra });
}

/** Notifications per recipient for one pickup (type filter optional). */
async function noticesFor(pickupId: string, type?: string) {
  const rows = await f.db.notification.findMany({ where: type ? { type: type as never } : {}, orderBy: { createdAt: "asc" } });
  return rows.filter((n) => (n.dataJson as Json | null)?.pickupId === pickupId);
}

async function recipients(pickupId: string, type: string) {
  const counts: Record<string, number> = {};
  for (const notice of await noticesFor(pickupId, type)) counts[notice.userId] = (counts[notice.userId] ?? 0) + 1;
  return counts;
}

async function extraUser(role: "ADMIN" | "PENGEPUL", status: "ACTIVE" | "SUSPENDED", organizationId: string | null) {
  return f.db.user.create({
    data: { name: `Extra ${role} ${status}`, email: `extra-${randomUUID()}@reloop-audit.test`, role, status, organizationId },
  });
}

async function page(actor: FixtureActor, route: string) {
  const response = await fetch(new URL(route, process.env.AUDIT_BASE_URL), {
    headers: { accept: "text/html", cookie: `${SESSION_COOKIE}=${await f.sessionCookie(actor)}` },
    redirect: "manual",
  });
  return { status: response.status, html: await response.text() };
}

function escalationRunner(args: string[] = []) {
  const run = spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), ["scripts/process-pickup-escalations.ts", ...args], {
    cwd: ROOT, env: process.env, encoding: "utf8", timeout: 90_000,
  });
  let output: Json | null = null;
  try {
    output = run.stdout ? (JSON.parse(run.stdout) as Json) : null;
  } catch {
    throw new Error(`runner stdout is not one JSON document: ${JSON.stringify(run.stdout)} stderr: ${JSON.stringify(run.stderr)}`);
  }
  return { status: run.status, output, stderr: run.stderr };
}

const recordItem = (actor: ActorKey, id: string) =>
  call(actor, "POST", `/api/pickups/${id}/items`, { itemCount: 12, actualWeightKg: 3.5, source: "MANUAL_WEIGHING" });

/** Signs and sends one machine HEARTBEAT exactly like rvm/sync.py does (fixture machine A). */
async function heartbeat(fillLevelPercent: number) {
  const machine = await f.db.machine.findUniqueOrThrow({ where: { id: f.ids.machineA } });
  const raw = JSON.stringify({ machineCode: f.ids.machineCode, events: [{
    localEventId: randomUUID(), eventType: "HEARTBEAT", payload: { status: "ONLINE", fillLevelPercent },
    sessionId: null, depositItemId: null, occurredAt: new Date().toISOString(),
  }] });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replaceAll("-", "");
  const response = await fetch(new URL("/api/machine-events", process.env.AUDIT_BASE_URL), {
    method: "POST",
    headers: {
      "content-type": "application/json", "x-reloop-machine": f.ids.machineCode, "x-reloop-timestamp": timestamp,
      "x-reloop-nonce": nonce, "x-reloop-signature": signMachinePayload(machine.ingestSecret!, timestamp, nonce, raw),
    },
    body: raw,
  });
  const body = (await response.json()) as Json;
  expect(response.status).toBe(200);
  expect(body.results[0]).toMatchObject({ status: "accepted" });
}

/** A second database session holding the pickup row lock until released. */
async function holdPickupLock(id: string) {
  const connection = await f.connection();
  const locked = deferred<number>();
  const release = deferred();
  const done = connection.$transaction(async (tx: Prisma.TransactionClient) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx.$queryRaw`SELECT id FROM "PickupRequest" WHERE id = ${id} FOR UPDATE`;
    locked.resolve(pid);
    await release.promise;
  }, { maxWait: 10_000, timeout: 90_000 });
  done.catch((error) => locked.reject(error));
  const pid = await locked.promise;
  return { pid, async release() { release.resolve(); await done; } };
}

/**
 * Deterministic order: `first` is proven blocked on the held pickup row, then
 * `second` is proven blocked behind `first`, then the row is released.
 */
async function inOrder<A, B>(id: string, first: () => Promise<A>, second: () => Promise<B>): Promise<[A, B]> {
  const observer = await f.connection();
  const holder = await holdPickupLock(id);
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

describe("pickup dispatch (B05)", () => {
  it("a stale dispatch cannot replace a newer assignment",async()=>{
    const pickup=await f.pickup();
    const first=await f.json("adminA","PATCH",`/api/pickups/${pickup.id}`,{
      action:"assign",collectorUserId:f.ids.collectorA,expectedVersion:0,
    });
    expect(first.status).toBe(200);
    const stale=await f.json("adminA","PATCH",`/api/pickups/${pickup.id}`,{
      action:"assign",collectorUserId:f.ids.collectorB,expectedVersion:0,
    });
    expect(stale.status).toBe(409);
  });

  it("keeps the newer owner, version and notification after a stale dispatch", async () => {
    const pickup = await f.pickup();
    const deadline = new Date(Date.now() + 3_600_000).toISOString();
    const first = await patch("adminA", pickup.id, {
      action: "assign", collectorUserId: f.ids.collectorA, expectedVersion: 0, expectedStartAt: deadline,
    });
    expect(first.status).toBe(200);
    expect(first.body.pickup).toMatchObject({
      status: "ASSIGNED", version: 1, assignedCollectorId: f.ids.collectorA, expectedStartAt: deadline,
      dispatch: { nextStatus: "ON_THE_WAY", nextActor: "COLLECTOR", overdue: false },
    });
    expect(first.body.pickup.assignedAt).toEqual(expect.any(String));

    const stale = await patch("adminA", pickup.id, {
      action: "assign", collectorUserId: f.ids.collectorB, expectedVersion: 0,
    });
    expect(stale).toEqual({ status: 409, body: { error: "Tugas telah diperbarui; muat ulang", code: "PICKUP_VERSION_CONFLICT" } });
    expect(await row(pickup.id)).toMatchObject({
      status: "ASSIGNED", version: 1, assignedCollectorId: f.ids.collectorA, expectedStartAt: new Date(deadline),
    });
    expect(await recipients(pickup.id, "PICKUP_ASSIGNED")).toEqual({ [f.ids.collectorA]: 1 });
    expect(await f.db.auditLog.count({ where: { entityId: pickup.id, action: "PICKUP_ASSIGN" } })).toBe(1);
  });

  it("refuses dispatch decisions without expectedVersion and keeps the upgrade window narrow", async () => {
    const pickup = await f.pickup();
    const legacyAssign = await patch("adminA", pickup.id, { action: "assign", collectorUserId: f.ids.collectorA });
    expect(legacyAssign.status).toBe(409);
    expect(legacyAssign.body).toEqual({
      error: "Versi tugas tidak dikirim. Muat ulang halaman atau perbarui aplikasi ReLoop, lalu coba lagi.",
      code: "PICKUP_VERSION_REQUIRED",
    });
    expect(await row(pickup.id)).toMatchObject({ status: "REQUESTED", version: 0, assignedCollectorId: null });

    await assign(pickup.id, "collectorA");
    expect((await patch("adminA", pickup.id, { action: "cancel", reason: "Tanpa versi" })).body.code)
      .toBe("PICKUP_VERSION_REQUIRED");
    expect((await patch("collectorA", pickup.id, { action: "fail", reason: "Tanpa versi" })).body.code)
      .toBe("PICKUP_VERSION_REQUIRED");
    // A stale version is refused for field actions too.
    expect((await patch("collectorA", pickup.id, { action: "start", expectedVersion: 0 })).body.code)
      .toBe("PICKUP_VERSION_CONFLICT");
    expect(await row(pickup.id)).toMatchObject({ status: "ASSIGNED", version: 1 });

    // The window is for old collector apps only: a SUPERADMIN field step always carries the version.
    expect((await patch("superadmin", pickup.id, { action: "start" })).body.code).toBe("PICKUP_VERSION_REQUIRED");
    expect(await row(pickup.id)).toMatchObject({ status: "ASSIGNED", version: 1 });

    // Upgrade window: the current assignee's forward step at its from-status, without a version.
    const legacyStart = await patch("collectorA", pickup.id, { action: "start" });
    expect(legacyStart.status).toBe(200);
    expect(await row(pickup.id)).toMatchObject({ status: "ON_THE_WAY", version: 2 });
    const audit = await f.db.auditLog.findFirstOrThrow({ where: { entityId: pickup.id, action: "PICKUP_START" } });
    expect(audit.metadataJson).toMatchObject({ expectedVersionProvided: false, version: 2 });
    // ...and the window never applies a step the current state does not allow.
    expect((await patch("collectorA", pickup.id, { action: "start" })).status).toBe(409);
    expect((await patch("collectorB", pickup.id, { action: "arrive" })).status).toBe(403);
  });

  it("two dispatchers assigning at once: one expectedVersion wins and the task has one owner", async () => {
    const pickup = await f.pickup();
    // Compile the route before holding locks.
    expect((await patch("adminA", "missing-pickup", { action: "assign", collectorUserId: f.ids.collectorA, expectedVersion: 0 })).status).toBe(404);

    const [winner, loser] = await inOrder(pickup.id,
      () => patch("adminA", pickup.id, { action: "assign", collectorUserId: f.ids.collectorA, expectedVersion: 0 }),
      () => patch("superadmin", pickup.id, { action: "assign", collectorUserId: f.ids.collectorB, expectedVersion: 0 }));

    expect(winner.status).toBe(200);
    expect(loser).toEqual({ status: 409, body: { error: "Tugas telah diperbarui; muat ulang", code: "PICKUP_VERSION_CONFLICT" } });
    expect(await row(pickup.id)).toMatchObject({ status: "ASSIGNED", version: 1, assignedCollectorId: f.ids.collectorA });
    expect(await recipients(pickup.id, "PICKUP_ASSIGNED")).toEqual({ [f.ids.collectorA]: 1 });
    expect(await noticesFor(pickup.id, "PICKUP_STATUS")).toEqual([]);
    expect(await f.db.auditLog.count({ where: { entityId: pickup.id, action: "PICKUP_ASSIGN" } })).toBe(1);
  });

  it("a reassignment racing an old app's version-less start: the start re-reads the owner and is refused", async () => {
    const pickup = await f.pickup();
    await assign(pickup.id, "collectorA");
    // Compile the route before holding locks.
    expect((await patch("collectorA", "missing-pickup", { action: "start" })).status).toBe(404);

    const [reassign, legacyStart] = await inOrder(pickup.id,
      () => patch("adminA", pickup.id, { action: "assign", collectorUserId: f.ids.collectorB, expectedVersion: 1 }),
      () => patch("collectorA", pickup.id, { action: "start" }));

    expect(reassign.status).toBe(200);
    expect(legacyStart).toEqual({ status: 403, body: { error: "Tugas ini tidak lagi ditugaskan kepada Anda. Muat ulang daftar tugas." } });
    expect(await row(pickup.id)).toMatchObject({ status: "ASSIGNED", version: 2, assignedCollectorId: f.ids.collectorB });
    expect(await f.db.auditLog.count({ where: { entityId: pickup.id, action: "PICKUP_START" } })).toBe(0);
  });

  it("the previous collector cannot start or complete after reassignment", async () => {
    const pickup = await f.pickup();
    await assign(pickup.id, "collectorA");
    await assign(pickup.id, "collectorB");
    expect(await row(pickup.id)).toMatchObject({ assignedCollectorId: f.ids.collectorB, version: 2 });
    const moved = await noticesFor(pickup.id, "PICKUP_STATUS");
    expect(moved.map((n) => [n.userId, n.title])).toEqual([[f.ids.collectorA, "Tugas pickup dialihkan"]]);

    const notYours = "Tugas ini tidak lagi ditugaskan kepada Anda. Muat ulang daftar tugas.";
    expect(await step("collectorA", pickup.id, "start")).toEqual({ status: 403, body: { error: notYours } });
    expect((await patch("collectorA", pickup.id, { action: "start" })).status).toBe(403);
    expect((await call("collectorA", "GET", `/api/pickups/${pickup.id}`)).status).toBe(403);

    for (const action of ["start", "arrive", "collect"]) {
      expect((await step("collectorB", pickup.id, action)).status).toBe(200);
    }
    expect(await step("collectorA", pickup.id, "complete")).toEqual({ status: 403, body: { error: notYours } });
    expect(await row(pickup.id)).toMatchObject({ status: "COLLECTED", version: 5 });
    expect((await step("collectorB", pickup.id, "complete")).body.pickup).toMatchObject({ status: "COMPLETED", version: 6 });

    // Field work started: no reassignment, only cancel/fail and a replacement task.
    const started = await f.pickup();
    await assign(started.id, "collectorA");
    expect((await step("collectorA", started.id, "start")).status).toBe(200);
    const late = await step("adminA", started.id, "assign", { collectorUserId: f.ids.collectorB });
    expect(late).toEqual({ status: 409, body: {
      error: "Pengepul sudah memulai pekerjaan lapangan. Batalkan atau tandai gagal dengan alasan, lalu buat tugas pengganti.",
    } });
    expect(await row(started.id)).toMatchObject({ status: "ON_THE_WAY", assignedCollectorId: f.ids.collectorA, version: 2 });
  });

  it("refuses a collector whose partnership was revoked, before any action", async () => {
    const pickup = await f.pickup();
    const other = await f.pickup();
    await assign(pickup.id, "collectorA");
    await assign(other.id, "collectorA");
    expect((await step("collectorA", other.id, "start")).status).toBe(200);
    expect((await step("collectorA", other.id, "arrive")).status).toBe(200);
    expect((await recordItem("collectorA", other.id)).status).toBe(201);

    const partnership = await f.db.organizationCollectorPartner.findUniqueOrThrow({
      where: { organizationId_collectorUserId: { organizationId: f.ids.orgA, collectorUserId: f.ids.collectorA } },
    });
    expect((await call("adminA", "PATCH", `/api/partnerships/${partnership.id}`, { action: "suspend" })).status).toBe(200);

    const inactive = { status: 403, body: { error: "Kemitraan pengepul belum aktif untuk organisasi ini" } };
    expect(await step("collectorA", pickup.id, "start")).toEqual(inactive);
    expect(await step("collectorA", pickup.id, "fail", { reason: "Mobil mogok" })).toEqual(inactive);
    expect(await step("collectorA", other.id, "collect")).toEqual(inactive);
    // Material records are an action too (they feed the B04 settlement).
    expect(await recordItem("collectorA", other.id)).toEqual(inactive);
    expect(await f.db.pickupItem.count({ where: { pickupRequestId: other.id } })).toBe(1);
    expect(await row(pickup.id)).toMatchObject({ status: "ASSIGNED", version: 1 });
    expect(await row(other.id)).toMatchObject({ status: "ARRIVED", version: 3 });

    // A suspended partner cannot be dispatched either; the admin reassigns the untouched task.
    const third = await f.pickup();
    expect(await step("adminA", third.id, "assign", { collectorUserId: f.ids.collectorA })).toEqual(inactive);
    expect((await row(third.id)).assignedCollectorId).toBeNull();
    await assign(pickup.id, "collectorB");
    expect((await step("collectorB", pickup.id, "start")).status).toBe(200);
  });

  it("a cancel and a material record on the same task are decided in pickup-lock order", async () => {
    const pickup = await f.pickup();
    await assign(pickup.id, "collectorA");
    for (const action of ["start", "arrive"]) expect((await step("collectorA", pickup.id, action)).status).toBe(200);
    // Compile the items route before holding locks.
    expect((await recordItem("collectorA", "missing-pickup")).status).toBe(404);

    const [cancelled, recorded] = await inOrder(pickup.id,
      () => patch("adminA", pickup.id, { action: "cancel", expectedVersion: 3, reason: "Lokasi ditutup sementara" }),
      () => recordItem("collectorA", pickup.id));

    expect(cancelled.status).toBe(200);
    expect(recorded).toEqual({ status: 409, body: { error: "Material hanya dapat dicatat setelah tiba di lokasi" } });
    expect(await f.db.pickupItem.count({ where: { pickupRequestId: pickup.id } })).toBe(0);
    expect(await row(pickup.id)).toMatchObject({ status: "CANCELLED", version: 4 });
  });

  it("a heartbeat between a fail and its replacement keeps the replacement recorded", async () => {
    const created = await call("adminA", "POST", "/api/pickups", { machineId: f.ids.machineA, reason: "FULL" });
    expect(created.status).toBe(201);
    const failedId = created.body.pickup.id as string;
    await assign(failedId, "collectorB");
    expect((await step("collectorB", failedId, "start")).status).toBe(200);
    expect((await step("collectorB", failedId, "fail", { reason: "Truk mogok di jalan" })).status).toBe(200);

    // The machine is still full: its next heartbeat raises the FULL pickup, which replaces the failed task.
    await heartbeat(95);
    const auto = await f.db.pickupRequest.findFirstOrThrow({ where: { machineId: f.ids.machineA, status: "REQUESTED" } });
    expect(auto).toMatchObject({ reason: "FULL", replacesPickupId: failedId, version: 0 });
    await heartbeat(96);
    expect(await f.db.pickupRequest.count({ where: { machineId: f.ids.machineA } })).toBe(2);

    const listed = (await call("adminA", "GET", "/api/pickups")).body.pickups.find((p: Json) => p.id === failedId);
    expect(listed.dispatch).toMatchObject({ needsReplacement: false, nextActor: null });
    expect(listed.replacedBy).toMatchObject({ id: auto.id });
    // The admin's "Buat pengganti" (e.g. from a stale page) returns that task instead of failing.
    expect(await call("adminA", "POST", "/api/pickups", { replacesPickupId: failedId }))
      .toMatchObject({ status: 200, body: { existing: true, pickup: { id: auto.id } } });

    // After a completed task, the next FULL pickup replaces nothing.
    await assign(auto.id, "collectorB");
    for (const action of ["start", "arrive", "collect", "complete"]) {
      expect((await step("collectorB", auto.id, action)).status).toBe(200);
    }
    await heartbeat(97);
    const next = await f.db.pickupRequest.findFirstOrThrow({ where: { machineId: f.ids.machineA, status: "REQUESTED" } });
    expect(next.replacesPickupId).toBeNull();
  });

  it("escalates an overdue start once per version, only to the organization's active admins", async () => {
    const adminA2 = await extraUser("ADMIN", "ACTIVE", f.ids.orgA);
    const adminA3 = await extraUser("ADMIN", "SUSPENDED", f.ids.orgA);
    const pickup = await f.pickup();
    const soon = () => new Date(Date.now() + 60_000).toISOString();
    expect((await step("adminA", pickup.id, "assign", { collectorUserId: f.ids.collectorA, expectedStartAt: new Date(Date.now() - 1_000).toISOString() })).status)
      .toBe(422);
    await assign(pickup.id, "collectorA", { expectedStartAt: soon() });
    // The deadline the operator chose passes without a start (the clock is moved by editing the deadline).
    await f.db.pickupRequest.update({ where: { id: pickup.id }, data: { expectedStartAt: new Date(Date.now() - 60_000) } });

    // Another organization's admin read never escalates organization A's tasks.
    expect((await call("adminB", "GET", "/api/pickups")).status).toBe(200);
    expect((await row(pickup.id)).lastEscalatedAt).toBeNull();

    const list = await call("adminA", "GET", "/api/pickups");
    const listed = list.body.pickups.find((p: Json) => p.id === pickup.id);
    expect(listed.dispatch).toMatchObject({ overdue: true, nextActor: "COLLECTOR", nextLabel: "Terlambat: pengepul belum berangkat" });
    expect((await call("adminA", "GET", "/api/pickups")).status).toBe(200);
    expect((await call("adminA", "GET", `/api/pickups/${pickup.id}`)).body.pickup.dispatch.overdue).toBe(true);
    expect((await page("adminA", "/dashboard/admin/pickups")).status).toBe(200);
    const again = escalationRunner();
    expect(again.status, again.stderr).toBe(0);
    expect(again.output).toMatchObject({ escalated: [] });

    // Exactly the two active org-A admins: not the suspended org-A admin, adminB, superadmin or collectors.
    expect(await recipients(pickup.id, "PICKUP_OVERDUE")).toEqual({ [f.ids.adminA]: 1, [adminA2.id]: 1 });
    expect(adminA3.status).toBe("SUSPENDED");
    const audits = await f.db.auditLog.findMany({ where: { entityId: pickup.id, action: "PICKUP_ESCALATE" } });
    expect(audits.map((a) => (a.metadataJson as Json).version)).toEqual([1]);
    expect((await row(pickup.id)).lastEscalatedAt).not.toBeNull();
    expect((await noticesFor(pickup.id, "PICKUP_OVERDUE")).map((n) => (n.dataJson as Json).version)).toEqual([1, 1]);

    // A new dispatch is a new version: one more escalation, from the runner this time, never a reassignment.
    await assign(pickup.id, "collectorB", { expectedStartAt: soon() });
    expect((await row(pickup.id)).lastEscalatedAt).toBeNull();
    await f.db.pickupRequest.update({ where: { id: pickup.id }, data: { expectedStartAt: new Date(Date.now() - 60_000) } });
    const pass = escalationRunner(["--limit", "10"]);
    expect(pass.status, pass.stderr).toBe(0);
    expect(pass.output!.escalated).toEqual([{ pickupId: pickup.id, version: 2, organizationId: f.ids.orgA }]);
    expect(escalationRunner().output!.escalated).toEqual([]);
    expect(await recipients(pickup.id, "PICKUP_OVERDUE")).toEqual({ [f.ids.adminA]: 2, [adminA2.id]: 2 });
    expect(await row(pickup.id)).toMatchObject({ status: "ASSIGNED", assignedCollectorId: f.ids.collectorB, version: 2 });

    // Started work is not overdue; a task dispatched without a deadline is never escalated.
    expect((await step("collectorB", pickup.id, "start")).status).toBe(200);
    const noDeadline = await f.pickup();
    await assign(noDeadline.id, "collectorA");
    expect(escalationRunner().output!.escalated).toEqual([]);
    expect(await recipients(pickup.id, "PICKUP_OVERDUE")).toEqual({ [f.ids.adminA]: 2, [adminA2.id]: 2 });
    expect(await noticesFor(noDeadline.id, "PICKUP_OVERDUE")).toEqual([]);
    expect(escalationRunner(["--limit", "0"]).status).toBe(2);
  });

  it("records the cancel/fail reason, notifies only the people concerned, and opens one replacement task", async () => {
    const adminA2 = await extraUser("ADMIN", "ACTIVE", f.ids.orgA);
    const pickup = await f.pickup();
    await assign(pickup.id, "collectorA");

    const missing = await step("adminA", pickup.id, "cancel");
    expect(missing).toEqual({ status: 422, body: { error: "Alasan wajib diisi (3-500 karakter)" } });
    const cancelled = await step("adminA", pickup.id, "cancel", { reason: "  Mesin dipindahkan ke gudang  " });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.pickup).toMatchObject({
      status: "CANCELLED", version: 2, closedReason: "Mesin dipindahkan ke gudang",
      dispatch: { needsReplacement: true, nextActor: "ADMIN", nextLabel: "Menunggu admin membuat tugas pengganti" },
    });
    const audit = await f.db.auditLog.findFirstOrThrow({ where: { entityId: pickup.id, action: "PICKUP_CANCEL" } });
    expect(audit).toMatchObject({ actorId: f.ids.adminA });
    expect(audit.metadataJson).toMatchObject({ from: "ASSIGNED", to: "CANCELLED", version: 2, reason: "Mesin dipindahkan ke gudang" });
    // The assigned collector learns of the cancel; no admin (the actor's own organization) is paged.
    const notices = await noticesFor(pickup.id);
    expect(notices.map((n) => [n.userId, n.type])).toEqual([
      [f.ids.collectorA, "PICKUP_ASSIGNED"], [f.ids.collectorA, "PICKUP_STATUS"],
    ]);
    expect(notices[1]).toMatchObject({ title: "Tugas pickup dibatalkan" });
    expect(notices[1].body).toContain("Mesin dipindahkan ke gudang");
    expect((await step("collectorA", pickup.id, "start")).status).toBe(409);

    // The recorded reassignment path: one replacement per closed task, retry-safe.
    const replacement = await call("adminA", "POST", "/api/pickups", { replacesPickupId: pickup.id });
    expect(replacement.status).toBe(201);
    expect(replacement.body.pickup).toMatchObject({ status: "REQUESTED", version: 0, replacesPickupId: pickup.id, assignedCollectorId: null });
    const retry = await call("adminA", "POST", "/api/pickups", { replacesPickupId: pickup.id });
    expect(retry).toMatchObject({ status: 200, body: { existing: true, pickup: { id: replacement.body.pickup.id } } });
    expect((await call("adminB", "POST", "/api/pickups", { replacesPickupId: pickup.id })).status).toBe(403);
    expect((await call("adminA", "POST", "/api/pickups", { replacesPickupId: replacement.body.pickup.id })).status).toBe(409);
    const createAudit = await f.db.auditLog.findFirstOrThrow({ where: { entityId: replacement.body.pickup.id, action: "PICKUP_CREATE" } });
    expect(createAudit.metadataJson).toMatchObject({ replacesPickupId: pickup.id, replacedStatus: "CANCELLED" });
    const listed = (await call("adminA", "GET", "/api/pickups")).body.pickups.find((p: Json) => p.id === pickup.id);
    expect(listed.dispatch).toMatchObject({ needsReplacement: false, nextActor: null });

    // Fail (the collector, field work started): reason recorded, the organization's admins alerted.
    const machinePickup = await call("adminA", "POST", "/api/pickups", { machineId: f.ids.machineA, reason: "FULL" });
    expect(machinePickup.status).toBe(201);
    const failing = machinePickup.body.pickup.id as string;
    await assign(failing, "collectorB");
    expect((await step("collectorB", failing, "start")).status).toBe(200);
    expect((await step("collectorB", failing, "fail")).status).toBe(422);
    const failed = await step("collectorB", failing, "fail", { reason: "Akses jalan ditutup" });
    expect(failed.body.pickup).toMatchObject({ status: "FAILED", closedReason: "Akses jalan ditutup" });
    expect(await recipients(failing, "PICKUP_STATUS")).toEqual({ [f.ids.adminA]: 1, [adminA2.id]: 1 });
    const machineReplacement = await call("adminA", "POST", "/api/pickups", { replacesPickupId: failing });
    expect(machineReplacement.body.pickup).toMatchObject({ machineId: f.ids.machineA, replacesPickupId: failing });
  });

  it("offers collectors no self-claim: empty available pool, no self-assign, waiting-for-admin empty state", async () => {
    const pickup = await f.pickup();
    const pool = await call("collectorA", "GET", "/api/pickups?scope=available");
    expect(pool.status).toBe(200);
    expect(pool.body.pickups).toEqual([]);
    expect(await patch("collectorA", pickup.id, { action: "assign", collectorUserId: f.ids.collectorA, expectedVersion: 0 }))
      .toEqual({ status: 403, body: { error: "Penugasan pengepul dilakukan oleh admin organisasi" } });
    expect((await patch("collectorA", pickup.id, { action: "assign", collectorUserId: f.ids.collectorA })).status).toBe(403);
    expect(await row(pickup.id)).toMatchObject({ status: "REQUESTED", version: 0, assignedCollectorId: null });

    const empty = await page("collectorA", "/dashboard/pengepul/tasks");
    expect(empty.status).toBe(200);
    expect(empty.html).toContain("Menunggu penugasan admin");
    expect(empty.html).not.toMatch(/Ambil Tugas|ambil sendiri|klaim/i);

    // Once dispatched, the collector's task shows who acts next and the operator's deadline.
    await assign(pickup.id, "collectorA", { expectedStartAt: new Date(Date.now() + 3_600_000).toISOString() });
    const task = await page("collectorA", "/dashboard/pengepul/tasks");
    expect(task.html).toContain("Menunggu pengepul berangkat");
    expect(task.html).toContain("Tenggat mulai");
    const admin = await page("adminA", "/dashboard/admin/pickups");
    expect(admin.html).toContain("Pengepul Audit A");
    expect(admin.html).toContain("Menunggu pengepul berangkat");
  });
});
