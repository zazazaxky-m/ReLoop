import { readFileSync } from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/machine-events/route";
import * as mAuth from "@/lib/machine-auth";
import * as me from "@/lib/machine-events";
import { InvalidSessionTransitionError } from "@/lib/machine-state";
import { prisma } from "@/lib/prisma";
import { machineEventsContractV2, machineEventsResponseV2 } from "../support/contracts";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findUnique: vi.fn() },
    machineEvent: { findMany: vi.fn() },
  },
}));
vi.mock("@/lib/machine-auth", () => ({ verifyMachineRequest: vi.fn() }));
vi.mock("@/lib/machine-events", () => ({ ingestMachineEvent: vi.fn() }));

/** Shared with tests/test_rvm_sync_contract.py (the RVM worker side). */
const fixturePath = path.resolve(__dirname, "../fixtures/contracts/machine-events.v2.json");
const document = JSON.parse(readFileSync(fixturePath, "utf8"));
const [E1, E2, E3] = document.request.events.map((e: { localEventId: string }) => e.localEventId);
const CLIENT_VERSION = "6.19.0";
const LEAKY = /hunter2|db\.internal|5432|stack|\.ts:\d+|P\d{4}|Transisi|Argument/;

const post = (body: unknown) => POST(new NextRequest("http://localhost/api/machine-events", {
  method: "POST",
  body: JSON.stringify(body),
  headers: { "x-reloop-timestamp": "1", "x-reloop-nonce": "n", "x-reloop-signature": "s" },
}));

const known = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError(
  `Invalid \`prisma.machineEvent.create()\` invocation: Can't reach database server at \`db.internal:5432\` password=hunter2 (${code})`,
  { code, clientVersion: CLIENT_VERSION, meta },
);

function event(localEventId: string, extra: Record<string, unknown> = {}) {
  return { localEventId, eventType: "HEARTBEAT", payload: { status: "ONLINE" }, occurredAt: "2026-10-13T08:00:00Z", ...extra };
}

describe("machine-events v2 contract fixture", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: "cmauditmachine000000000001", ingestSecret: "secret", organization: { id: "org" },
    } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true });
    vi.mocked(prisma.machineEvent.findMany).mockResolvedValue([]);
  });

  it("is versioned and its responses satisfy the v2 schema", () => {
    const contract = machineEventsContractV2.parse(document);
    expect(path.basename(fixturePath)).toBe(`${contract.contract}.v${contract.version}.json`);
    expect(contract.response.protocolVersion).toBe(2);
    // Every request event gets exactly one result, and the worker outcome
    // partitions the batch.
    const ids = contract.request.events.map((e) => e.localEventId);
    expect(contract.response.results.map((r) => r.localEventId)).toEqual(ids);
    const { acked, pending, deadLetter } = contract.workerOutcome;
    expect([...acked, ...pending, ...deadLetter].sort()).toEqual([...ids].sort());
    // The legacy v1 body is exactly what the v2 worker must refuse.
    expect(machineEventsResponseV2.safeParse(contract.compatibility.legacyV1.response).success).toBe(false);
  });

  it("rejects a response that drifted without a version bump", () => {
    for (const drift of [
      (d: any) => { d.response.protocolVersion = 1; },
      (d: any) => { d.response.results[3].retryable = "false"; },
      (d: any) => { d.response.results[0].status = "ok"; },
      (d: any) => { d.response.results[2].error = "Error: connect ECONNREFUSED db.internal:5432"; },
      (d: any) => { d.response.received = 3; },
      (d: any) => { delete d.response.results[0].eventId; },
    ]) {
      const drifted = structuredClone(document);
      drift(drifted);
      expect(machineEventsContractV2.safeParse(drifted).success).toBe(false);
    }
  });

  it("answers the fixture request with exactly the fixture response, without leaking error detail", async () => {
    vi.mocked(prisma.machineEvent.findMany).mockResolvedValue([
      { localEventId: E2, id: "cmauditevent00000000000002", depositItemId: null },
    ] as any);
    vi.mocked(me.ingestMachineEvent).mockImplementation(async (input) => {
      if (input.localEventId === E1) return { duplicate: false, eventId: "cmauditevent00000000000001" };
      if (input.localEventId === E3) throw known("P1001");
      throw new Error(`unexpected ingest of ${input.localEventId}`);
    });

    const res = await post(document.request);
    expect(res.status).toBe(document.status);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(document.response);
    expect(machineEventsResponseV2.parse(JSON.parse(text)).results).toHaveLength(4);
    expect(text).not.toMatch(LEAKY);
    // Unknown event types never reach the ingest/reward path.
    expect(vi.mocked(me.ingestMachineEvent).mock.calls.map(([input]) => input.localEventId)).toEqual([E1, E3]);
  });

  it("keeps HTTP 200 and per-event results for an empty batch", async () => {
    const res = await post({ machineCode: "AUDIT-A-01", events: [] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ protocolVersion: 2, received: 0, results: [] });
  });
});

describe("machine-events v2 error classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: "cmauditmachine000000000001", ingestSecret: "secret", organization: { id: "org" },
    } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true });
    vi.mocked(prisma.machineEvent.findMany).mockResolvedValue([]);
  });

  const transient: [string, () => unknown][] = [
    ["database unreachable (P1001)", () => known("P1001")],
    ["connection closed (P1017)", () => known("P1017")],
    ["pool timeout (P2024)", () => known("P2024")],
    ["interactive transaction expired (P2028)", () => known("P2028")],
    ["write conflict or deadlock (P2034)", () => known("P2034")],
    ["unique collision without a committed winner (P2002)", () => known("P2002", { target: ["businessKey"] })],
    ["serialization failure in raw SQL (40001)", () => known("P2010", { code: "40001" })],
    ["lock timeout in raw SQL (55P03)", () => known("P2010", { code: "55P03" })],
    ["client initialization", () => new Prisma.PrismaClientInitializationError("db.internal:5432 down", CLIENT_VERSION)],
    ["engine panic", () => new Prisma.PrismaClientRustPanicError("panic at db.internal:5432", CLIENT_VERSION)],
    ["unclassified error", () => new Error("boom password=hunter2")],
  ];
  const permanent: [string, () => unknown][] = [
    ["value too long (P2000)", () => known("P2000")],
    ["foreign key (P2003)", () => known("P2003")],
    ["record to update missing (P2025)", () => known("P2025")],
    ["invalid text representation in raw SQL (22P02)", () => known("P2010", { code: "22P02" })],
    ["query validation", () => new Prisma.PrismaClientValidationError("Argument `occurredAt` is invalid", { clientVersion: CLIENT_VERSION })],
    ["invalid session transition", () => new InvalidSessionTransitionError("COMPLETED", "ITEM_DONE")],
  ];

  async function classify(error: () => unknown) {
    vi.mocked(me.ingestMachineEvent).mockImplementation(async (input) => {
      if (input.localEventId === "boom") throw error();
      return { duplicate: false, eventId: `srv-${input.localEventId}` };
    });
    const res = await post({ machineCode: "AUDIT-A-01", events: [event("boom"), event("after")] });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(LEAKY);
    const body = machineEventsResponseV2.parse(JSON.parse(text));
    // One failing event never fails or reorders the rest of the batch.
    expect(body.results[1]).toEqual({ localEventId: "after", status: "accepted", eventId: "srv-after" });
    return body.results[0];
  }

  it.each(transient)("reports %s as TEMPORARY_FAILURE, retryable", async (_name, error) => {
    expect(await classify(error)).toEqual({ localEventId: "boom", status: "error", error: "TEMPORARY_FAILURE", retryable: true });
  });

  it.each(permanent)("reports %s as EVENT_REJECTED, not retryable", async (_name, error) => {
    expect(await classify(error)).toEqual({ localEventId: "boom", status: "error", error: "EVENT_REJECTED", retryable: false });
  });

  it("rejects malformed events one by one as INVALID_EVENT without touching the ingest path", async () => {
    vi.mocked(me.ingestMachineEvent).mockResolvedValue({ duplicate: false, eventId: "srv-ok" });
    const res = await post({
      machineCode: "AUDIT-A-01",
      events: [
        event("ok-1"),
        event("bad-type", { eventType: "NOT_REAL" }),
        event("bad-date", { occurredAt: "kemarin sore" }),
        event("bad-payload", { payload: ["not", "an", "object"] }),
        event("bad-session", { sessionId: 42 }),
        event(""),
      ],
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const rejected = (localEventId: string) => ({ localEventId, status: "error", error: "INVALID_EVENT", retryable: false });
    expect(body).toEqual({
      protocolVersion: 2,
      received: 6,
      results: [
        { localEventId: "ok-1", status: "accepted", eventId: "srv-ok" },
        rejected("bad-type"),
        rejected("bad-date"),
        rejected("bad-payload"),
        rejected("bad-session"),
        rejected(""),
      ],
    });
    expect(me.ingestMachineEvent).toHaveBeenCalledTimes(1);
  });

  it("answers a retried event that already committed as duplicate before validating it again", async () => {
    vi.mocked(prisma.machineEvent.findMany).mockResolvedValue([
      { localEventId: "committed", id: "evt-committed", depositItemId: null },
    ] as any);
    const res = await post({ machineCode: "AUDIT-A-01", events: [event("committed", { eventType: "RETIRED_TYPE" })] });
    expect((await res.json()).results).toEqual([{ localEventId: "committed", status: "duplicate", eventId: "evt-committed" }]);
    expect(me.ingestMachineEvent).not.toHaveBeenCalled();
  });

  it("holds later events of a session behind its transiently failed event so they are resent in order", async () => {
    vi.mocked(me.ingestMachineEvent).mockImplementation(async (input) => {
      if (input.localEventId === "s1-detect") throw known("P2034");
      return { duplicate: false, eventId: `srv-${input.localEventId}` };
    });
    const res = await post({
      machineCode: "AUDIT-A-01",
      events: [
        event("s1-detect", { eventType: "ITEM_DETECTED", sessionId: "s1" }),
        event("s2-detect", { eventType: "ITEM_DETECTED", sessionId: "s2" }),
        event("s1-accept", { eventType: "ITEM_ACCEPTED_POINT", sessionId: "s1" }),
        event("heartbeat"),
      ],
    });
    const retry = (localEventId: string) => ({ localEventId, status: "error", error: "TEMPORARY_FAILURE", retryable: true });
    // Held events get their own code so the machine never counts them toward
    // its retry limit: only the failing event itself does (rvm/sync.py).
    const held = (localEventId: string) => ({ localEventId, status: "error", error: "SESSION_HELD", retryable: true });
    expect((await res.json()).results).toEqual([
      retry("s1-detect"),
      { localEventId: "s2-detect", status: "accepted", eventId: "srv-s2-detect" },
      held("s1-accept"),
      { localEventId: "heartbeat", status: "accepted", eventId: "srv-heartbeat" },
    ]);
    // The held event never reached the reward path out of order.
    expect(vi.mocked(me.ingestMachineEvent).mock.calls.map(([input]) => input.localEventId))
      .toEqual(["s1-detect", "s2-detect", "heartbeat"]);
  });

  it("does not hold a session behind a permanent rejection, and drops the rolled-back item from the batch cache", async () => {
    const cacheSeen: boolean[] = [];
    vi.mocked(me.ingestMachineEvent).mockImplementation(async (input, options) => {
      if (input.localEventId === "s1-detect") {
        options?.depositItemCache?.set("s1", "item-that-rolled-back");
        throw known("P2003");
      }
      cacheSeen.push(options?.depositItemCache?.has("s1") ?? false);
      return { duplicate: false, eventId: `srv-${input.localEventId}` };
    });
    const res = await post({
      machineCode: "AUDIT-A-01",
      events: [
        event("s1-detect", { eventType: "ITEM_DETECTED", sessionId: "s1" }),
        event("s1-weight", { eventType: "WEIGHT_MEASURED", sessionId: "s1" }),
      ],
    });
    expect((await res.json()).results).toEqual([
      { localEventId: "s1-detect", status: "error", error: "EVENT_REJECTED", retryable: false },
      { localEventId: "s1-weight", status: "accepted", eventId: "srv-s1-weight" },
    ]);
    expect(cacheSeen).toEqual([false]);
  });

  it("still rejects a broken envelope as a whole", async () => {
    const res = await post({ machineCode: "AUDIT-A-01", events: [{ eventType: "HEARTBEAT" }] });
    expect(res.status).toBe(422);
    expect(me.ingestMachineEvent).not.toHaveBeenCalled();
  });
});
