import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CLOSE_SESSION_EXPIRED,
  CLOSE_SESSION_REVOKED,
  REVALIDATE_INTERVAL_MS,
  createGateway,
  parsePublishedEvent,
} from "@/realtime/server.mjs";
import { GatewaySocket } from "../../support/ws-client";

const SECRET = "test-internal";
const T0 = 1_900_000_000_000;

/** Timers the test controls: they fire only through `fireDue()`. */
function manualTimers(clock: () => number) {
  const active = new Map<object, { fn: () => unknown; dueAt: number }>();
  return {
    active,
    dueTimes: () => [...active.values()].map((timer) => timer.dueAt),
    async fireDue() {
      for (const [handle, timer] of [...active]) {
        if (timer.dueAt > clock() || !active.has(handle)) continue;
        active.delete(handle);
        await timer.fn();
      }
    },
    setTimeout(fn: () => unknown, ms: number) {
      const handle = { unref: () => handle };
      active.set(handle, { fn, dueAt: clock() + ms });
      return handle;
    },
    clearTimeout(handle: object) {
      active.delete(handle);
    },
  };
}

type Answer = { status: number; body?: unknown };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

/** `advance` moves the injected clock while the verifier "works" (round-trip). */
async function setup(answer: (token: string, advance: (ms: number) => void) => Answer) {
  let calls = 0;
  let clock = T0;
  const verifier: Server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    calls += 1;
    if (req.headers.authorization !== `Bearer ${SECRET}`) return void res.writeHead(401).end();
    const { status, body } = answer(JSON.parse(raw).token, (ms) => { clock += ms; });
    res.writeHead(status, { "content-type": "application/json" }).end(body === undefined ? "" : JSON.stringify(body));
  });
  verifier.listen(0, "127.0.0.1");
  await once(verifier, "listening");
  const timers = manualTimers(() => clock);
  const gateway = createGateway({
    internalSecret: SECRET,
    wsSessionUrl: `http://127.0.0.1:${(verifier.address() as { port: number }).port}/`,
    now: () => clock,
    timers,
  });
  gateway.server.listen(0, "127.0.0.1");
  await once(gateway.server, "listening");
  const port = (gateway.server.address() as { port: number }).port;
  const sockets: GatewaySocket[] = [];
  cleanups.push(async () => {
    for (const socket of sockets) socket.close();
    await gateway.close();
    await new Promise<void>((resolve) => verifier.close(() => resolve()));
  });
  return {
    gateway,
    timers,
    calls: () => calls,
    advance: (ms: number) => { clock += ms; },
    async connect(cookie: string | null) {
      const socket = await GatewaySocket.open(port, cookie);
      sockets.push(socket);
      return socket;
    },
    async publish(event: unknown) {
      const response = await fetch(`http://127.0.0.1:${port}/publish`, {
        method: "POST", headers: { authorization: `Bearer ${SECRET}` }, body: JSON.stringify(event),
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
  };
}

const identity = (overrides: Record<string, unknown> = {}) => ({
  userId: "admin-1", role: "ADMIN", organizationId: "org-a", tokenVersion: 0,
  expiresAt: T0 / 1000 + 3_600, ...overrides,
});
const alert = (organizationId = "org-a") => ({
  topic: "security-alert", organizationId, machineCode: "M-1", eventType: "FRAUD_DETECTED",
});

describe("realtime gateway session authorization (R04)", () => {
  it("revalidates a stale privileged identity before a restricted broadcast even when no timer fired", async () => {
    let current: Answer = { status: 200, body: identity() };
    const t = await setup(() => current);
    const admin = await t.connect("admin-cookie");
    expect((await t.publish(alert())).body).toEqual({ delivered: 1 });
    expect(t.calls()).toBe(1);

    // Still fresh: no verifier round-trip.
    t.advance(REVALIDATE_INTERVAL_MS - 1);
    expect((await t.publish(alert())).body).toEqual({ delivered: 1 });
    expect(t.calls()).toBe(1);

    // Stale: revalidated first, and the revocation wins.
    t.advance(1);
    current = { status: 200, body: null };
    expect((await t.publish(alert())).body).toEqual({ delivered: 0 });
    expect(t.calls()).toBe(2);
    expect(await admin.closed()).toBe(true);
    expect(admin.closeCode).toBe(CLOSE_SESSION_REVOKED);
  });

  it("closes the socket exactly at expiresAt", async () => {
    const expiresAt = T0 / 1000 + 10;
    const t = await setup(() => ({ status: 200, body: identity({ expiresAt }) }));
    const admin = await t.connect("admin-cookie");
    expect(t.timers.dueTimes()).toContain(expiresAt * 1000);

    t.advance(10_000 - 1);
    await t.timers.fireDue();
    expect(await admin.closed(100)).toBe(false);

    t.advance(1);
    await t.timers.fireDue();
    expect(await admin.closed()).toBe(true);
    expect(admin.closeCode).toBe(CLOSE_SESSION_EXPIRED);
  });

  it("keeps an ADMIN to its organization while SUPERADMIN receives every organization", async () => {
    const t = await setup((token) => ({
      status: 200,
      body: token === "super-cookie" ? identity({ userId: "super-1", role: "SUPERADMIN", organizationId: null }) : identity(),
    }));
    const admin = await t.connect("admin-cookie");
    const superadmin = await t.connect("super-cookie");

    expect((await t.publish(alert("org-b"))).body).toEqual({ delivered: 1 });
    expect((await t.publish(alert("org-a"))).body).toEqual({ delivered: 2 });
    expect((await admin.events()).map((event) => event.organizationId)).toEqual(["org-a"]);
    expect((await superadmin.events()).map((event) => event.organizationId)).toEqual(["org-b", "org-a"]);
  });

  it("withholds a restricted topic past expiry even if the expiry timer never fired", async () => {
    const t = await setup(() => ({ status: 200, body: identity({ expiresAt: T0 / 1000 + 10 }) }));
    const admin = await t.connect("admin-cookie");
    t.advance(10_000);
    expect((await t.publish(alert())).body).toEqual({ delivered: 0 });
    expect(await admin.eventCount()).toBe(0);
  });

  it.each([
    ["a pre-R04 { role } answer", { status: 200, body: { role: "ADMIN" } }],
    ["an identity without organization or expiry", { status: 200, body: { userId: "admin-1", role: "ADMIN", tokenVersion: 0 } }],
    ["an unknown role", { status: 200, body: identity({ role: "OWNER" }) }],
    ["an expired identity", { status: 200, body: identity({ expiresAt: T0 / 1000 }) }],
    ["a verifier error", { status: 503 }],
  ])("grants no private role for %s but keeps public topics", async (_case, answer) => {
    const t = await setup(() => answer as Answer);
    const socket = await t.connect("cookie");
    expect((await t.publish(alert())).body).toEqual({ delivered: 0 });
    expect((await t.publish({ topic: "machine-state", machineCode: "M-1", eventType: "REMOTE_COMMAND_QUEUED" })).body)
      .toEqual({ delivered: 1 });
    expect(await socket.eventCount()).toBe(1);
  });

  it("keeps the cookie only for privileged sockets and arms nothing for anonymous ones", async () => {
    const t = await setup((token) => ({
      status: 200, body: token === "user-cookie" ? identity({ userId: "user-1", role: "USER", organizationId: null }) : identity(),
    }));
    const heartbeatOnly = t.timers.active.size;
    await t.connect(null);
    expect(t.timers.active.size).toBe(heartbeatOnly);
    await t.connect("user-cookie");
    expect(t.timers.active.size).toBe(heartbeatOnly + 1); // expiry only, never revalidated
    await t.connect("admin-cookie");
    expect(t.timers.active.size).toBe(heartbeatOnly + 3); // expiry + revalidation

    t.advance(REVALIDATE_INTERVAL_MS);
    await t.publish(alert());
    expect(t.calls()).toBe(3); // admin revalidated; user and guest never
  });

  it("close() clears every timer it armed and drops every socket", async () => {
    const t = await setup(() => ({ status: 200, body: identity() }));
    const sockets = [await t.connect("admin-cookie"), await t.connect("admin-cookie"), await t.connect(null)];
    expect(t.timers.active.size).toBeGreaterThan(1);

    await t.gateway.close();

    expect(t.timers.active.size).toBe(0);
    for (const socket of sockets) expect(await socket.closed()).toBe(true);
  });
});

describe("realtime gateway fix round 1 (R04 review)", () => {
  it("measures identity age from the verifier request start, so revocation lands within 30 s despite the round-trip", async () => {
    const RTT_MS = 3_000;
    let current: Answer = { status: 200, body: identity() };
    // The verifier reads the database when the request arrives (clock T0) and
    // its answer reaches the gateway RTT_MS later on the injected clock.
    const t = await setup((_token, advance) => {
      advance(RTT_MS);
      return current;
    });
    const admin = await t.connect("admin-cookie");
    expect(t.timers.dueTimes()).toContain(T0 + REVALIDATE_INTERVAL_MS);

    // Revoked right after the verifier's database read.
    current = { status: 200, body: null };
    t.advance(REVALIDATE_INTERVAL_MS - RTT_MS); // exactly 30 s after that read

    expect((await t.publish(alert())).body).toEqual({ delivered: 0 });
    expect(await admin.closed()).toBe(true);
    expect(admin.closeCode).toBe(CLOSE_SESSION_REVOKED);
  });

  it("keeps a revalidated identity fresh for 30 s from that request's start", async () => {
    const RTT_MS = 2_000;
    const t = await setup((_token, advance) => {
      advance(RTT_MS);
      return { status: 200, body: identity() };
    });
    await t.connect("admin-cookie"); // request at T0, answer at T0 + 2 s
    t.advance(REVALIDATE_INTERVAL_MS - RTT_MS); // T0 + 30 s: stale, revalidated (request at T0 + 30 s)
    expect((await t.publish(alert())).body).toEqual({ delivered: 1 });
    expect(t.calls()).toBe(2);
    t.advance(REVALIDATE_INTERVAL_MS - RTT_MS - 1); // T0 + 60 s - 1 ms: still fresh
    expect((await t.publish(alert())).body).toEqual({ delivered: 1 });
    expect(t.calls()).toBe(2);
  });

  it("warns about verifier failures with status/reason only, throttled, never with the cookie", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cookie = "cookie-SECRET-r04-abc123";
    let answer: Answer = { status: 503 };
    const t = await setup(() => answer);

    await t.connect(cookie);
    await t.connect(cookie);
    expect(warn).toHaveBeenCalledTimes(1); // second failure inside the window is throttled
    expect(String(warn.mock.calls[0][0])).toContain("503");

    t.advance(60_000);
    answer = { status: 200, body: { role: "ADMIN" } }; // pre-R04 verifier: unusable answer
    await t.connect(cookie);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toMatch(/malformed/);
    expect(String(warn.mock.calls[1][0])).toMatch(/1 suppressed/);

    for (const call of warn.mock.calls) expect(call.map(String).join(" ")).not.toContain(cookie);
  });

  it("does not warn when the verifier answers normally or revokes", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = await setup((token) => ({ status: 200, body: token === "admin-cookie" ? identity() : null }));
    await t.connect("admin-cookie");
    await t.connect("revoked-cookie");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("parsePublishedEvent", () => {
  it("rejects a restricted topic without an organization instead of treating it as global", () => {
    for (const organizationId of [undefined, null, "", 42]) {
      expect(parsePublishedEvent({ ...alert(), organizationId })).toEqual({ error: "organization_required" });
    }
  });

  it("rejects unknown topics and malformed fields", () => {
    expect(parsePublishedEvent({ ...alert(), topic: "billing" })).toEqual({ error: "unknown_topic" });
    expect(parsePublishedEvent(null)).toEqual({ error: "invalid_event" });
    expect(parsePublishedEvent({ ...alert(), machineCode: "" })).toEqual({ error: "invalid_machine_code" });
    expect(parsePublishedEvent({ ...alert(), eventType: "Ditolak oleh Budi" })).toEqual({ error: "invalid_event_type" });
  });

  it("forwards occurredAt only as a normalized ISO timestamp and drops anything else", () => {
    const state = { topic: "machine-state", machineCode: "M-1", eventType: "REMOTE_COMMAND_QUEUED" };
    expect(parsePublishedEvent({ ...state, occurredAt: "2026-10-14T10:00:00+07:00" }))
      .toEqual({ restricted: false, event: { ...state, occurredAt: "2026-10-14T03:00:00.000Z" } });

    // V8's Date.parse accepts parenthesised text: it must never reach a socket.
    const smuggled = "2026-10-14 (Budi Santoso 081234567890)";
    expect(Number.isFinite(Date.parse(smuggled))).toBe(true);
    const parsed = parsePublishedEvent({ ...state, occurredAt: smuggled });
    expect(parsed.event?.occurredAt).toBe(new Date(Date.parse(smuggled)).toISOString());
    expect(JSON.stringify(parsed)).not.toContain("Budi");

    for (const occurredAt of ["yesterday", 1_760_000_000_000, "", "x".repeat(65)]) {
      expect(parsePublishedEvent({ ...state, occurredAt })).toEqual({ restricted: false, event: state });
      expect(parsePublishedEvent({ ...alert(), occurredAt })).toEqual({ restricted: true, event: alert() });
    }
  });

  it("whitelists the payload per topic", () => {
    const extra = { eventId: "evt-1", occurredAt: "2026-10-14T03:00:00.000Z", userId: "u-1", amount: 5_000, payload: { iban: "x" } };
    expect(parsePublishedEvent({ ...alert(), ...extra })).toEqual({
      restricted: true,
      event: { ...alert(), eventId: "evt-1", occurredAt: "2026-10-14T03:00:00.000Z" },
    });
    expect(parsePublishedEvent({ topic: "machine-event", machineCode: "M-1", eventType: "ITEM_ACCEPTED", organizationId: "org-a", ...extra }))
      .toEqual({
        restricted: false,
        event: { topic: "machine-event", machineCode: "M-1", eventType: "ITEM_ACCEPTED", occurredAt: "2026-10-14T03:00:00.000Z" },
      });
  });
});
