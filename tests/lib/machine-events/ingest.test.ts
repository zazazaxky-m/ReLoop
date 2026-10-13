import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { ingestMachineEvent } from "@/lib/machine-events/ingest";
import { prisma } from "@/lib/prisma";
import * as sideEffects from "@/lib/machine-events/side-effects";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findUnique: vi.fn() },
    machineEvent: { findUnique: vi.fn(), create: vi.fn() },
    depositSession: { findFirst: vi.fn() },
    depositItem: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/machine-events/side-effects", () => ({
  processEventSideEffects: vi.fn(),
}));

describe("ingestMachineEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseMachine = { id: "m1", machineCode: "RVM-1", organization: { id: "org1" } };

  it("throws if machine not found", async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    await expect(ingestMachineEvent({ machineCode: "RVM-1", localEventId: "ev1", eventType: "HEARTBEAT" }))
      .rejects.toThrow("Mesin tidak ditemukan");
  });

  it("returns duplicate if event exists", async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(baseMachine as any);
    vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue({ id: "event1", depositItemId: "d1" } as any);
    
    const res = await ingestMachineEvent({ machineCode: "RVM-1", localEventId: "ev1", eventType: "HEARTBEAT" });
    expect(res.duplicate).toBe(true);
    expect(res.eventId).toBe("event1");
    expect(res.depositItemId).toBe("d1");
  });

  it("clears orphaned sessionId", async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(baseMachine as any);
    vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.depositSession.findFirst).mockResolvedValue(null); // not found
    vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
      return (cb as any)({
        machineEvent: { create: vi.fn().mockResolvedValue({ id: "e1" }) }
      });
    });

    const res = await ingestMachineEvent({ 
      machineCode: "RVM-1", localEventId: "ev1", eventType: "HEARTBEAT", sessionId: "sess1", depositItemId: "item1"
    });
    
    expect(res.message).toBe("Referensi sesi/item lokal tidak ditemukan dan dilepas");
    // it cleared depositItemId too because sessionId was missing
    expect(res.depositItemId).toBeNull(); 
  });

  it("clears orphaned depositItemId if item not found", async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(baseMachine as any);
    vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.depositSession.findFirst).mockResolvedValue({ id: "sess1" } as any);
    vi.mocked(prisma.depositItem.findFirst).mockResolvedValue(null); // not found
    
    let createdData: any;
    vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
      return (cb as any)({
        machineEvent: { create: vi.fn().mockImplementation(args => {
          createdData = args.data;
          return { id: "e1" };
        }) }
      });
    });

    const res = await ingestMachineEvent({ 
      machineCode: "RVM-1", localEventId: "ev1", eventType: "HEARTBEAT", sessionId: "sess1", depositItemId: "item1"
    });

    expect(res.message).toBe("Referensi sesi/item lokal tidak ditemukan dan dilepas");
    expect(res.depositItemId).toBeNull();
    expect(createdData.payloadJson.orphanedReferences.depositItemId).toBe("item1");
  });

  it("clears orphaned depositItemId if item sessionId mismatch", async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(baseMachine as any);
    vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.depositSession.findFirst).mockResolvedValue({ id: "sess1" } as any);
    vi.mocked(prisma.depositItem.findFirst).mockResolvedValue({ id: "item1", sessionId: "sess2" } as any); // mismatch!
    
    let createdData: any;
    vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
      return (cb as any)({
        machineEvent: { create: vi.fn().mockImplementation(args => {
          createdData = args.data;
          return { id: "e1" };
        }) }
      });
    });

    const res = await ingestMachineEvent({ 
      machineCode: "RVM-1", localEventId: "ev1", eventType: "HEARTBEAT", sessionId: "sess1", depositItemId: "item1", payload: { some: "data" }
    });

    expect(res.message).toBe("Referensi sesi/item lokal tidak ditemukan dan dilepas");
    expect(res.depositItemId).toBeNull();
    expect(createdData.payloadJson.some).toBe("data");
    expect(createdData.payloadJson.orphanedReferences.depositItemId).toBe("item1");
  });

  it("processes event normally with occurredAt string", async () => {
    vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue(null);
    
    let createdData: any;
    vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
      return (cb as any)({
        machineEvent: { create: vi.fn().mockImplementation(args => {
          createdData = args.data;
          return { id: "e1" };
        }) }
      });
    });

    vi.mocked(sideEffects.processEventSideEffects).mockImplementation(async (tx, m, input, eid, setItem) => {
      setItem?.("newItem1");
    });

    const res = await ingestMachineEvent(
      { machineCode: "RVM-1", localEventId: "ev1", eventType: "HEARTBEAT", occurredAt: "2026-07-10T02:00:00Z" },
      { machine: baseMachine as any }
    );

    expect(res.duplicate).toBe(false);
    expect(res.depositItemId).toBe("newItem1");
    expect(createdData.occurredAt.toISOString()).toBe("2026-07-10T02:00:00.000Z");
  });
});

describe("ingestMachineEvent retries and commit boundary (R02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const machine = { id: "m1", machineCode: "RVM-1", organization: { id: "org1" } } as any;
  const input = { machineCode: "RVM-1", localEventId: "ev1", eventType: "ITEM_ACCEPTED_POINT" as const };
  const uniqueViolation = () => new Prisma.PrismaClientKnownRequestError(
    "Unique constraint failed on the fields: (`machineId`,`localEventId`)",
    { code: "P2002", clientVersion: "6.19.0", meta: { target: ["machineId", "localEventId"] } },
  );

  it("re-reads the committed winner after a concurrent unique collision and reports duplicate", async () => {
    vi.mocked(prisma.machineEvent.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "winner", depositItemId: "d9" } as any);
    vi.mocked(prisma.$transaction).mockRejectedValue(uniqueViolation());

    const res = await ingestMachineEvent(input, { machine });
    expect(res).toMatchObject({ duplicate: true, eventId: "winner", depositItemId: "d9" });
    expect(prisma.machineEvent.findUnique).toHaveBeenLastCalledWith({
      where: { machineId_localEventId: { machineId: "m1", localEventId: "ev1" } },
    });
  });

  it("rethrows a unique collision when no committed event exists, so it is retried", async () => {
    vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue(null);
    const collision = uniqueViolation();
    vi.mocked(prisma.$transaction).mockRejectedValue(collision);
    await expect(ingestMachineEvent(input, { machine })).rejects.toBe(collision);
    expect(prisma.machineEvent.findUnique).toHaveBeenCalledTimes(2);
  });

  it("does not re-read on other failures", async () => {
    vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue(null);
    const down = new Prisma.PrismaClientKnownRequestError("down", { code: "P1001", clientVersion: "6.19.0" });
    vi.mocked(prisma.$transaction).mockRejectedValue(down);
    await expect(ingestMachineEvent(input, { machine })).rejects.toBe(down);
    expect(prisma.machineEvent.findUnique).toHaveBeenCalledTimes(1);
  });

  it("runs deferred notifications only after the event transaction commits", async () => {
    vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue(null);
    const order: string[] = [];
    vi.mocked(sideEffects.processEventSideEffects).mockImplementation(
      async (_tx, _m, _input, _eid, _setItem, _cache, afterCommit) => {
        afterCommit?.(async () => { order.push("notify"); });
        order.push("side-effects");
      },
    );
    vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
      const created = await (cb as any)({ machineEvent: { create: vi.fn().mockResolvedValue({ id: "e1" }) } });
      order.push("commit");
      return created;
    });

    const res = await ingestMachineEvent(input, { machine });
    expect(res).toMatchObject({ duplicate: false, eventId: "e1" });
    expect(order).toEqual(["side-effects", "commit", "notify"]);
  });

  it("never runs deferred notifications when the transaction rolls back", async () => {
    vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue(null);
    const notify = vi.fn();
    vi.mocked(sideEffects.processEventSideEffects).mockImplementation(
      async (_tx, _m, _input, _eid, _setItem, _cache, afterCommit) => {
        afterCommit?.(notify);
      },
    );
    const conflict = new Prisma.PrismaClientKnownRequestError("deadlock", { code: "P2034", clientVersion: "6.19.0" });
    vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
      await (cb as any)({ machineEvent: { create: vi.fn().mockResolvedValue({ id: "e1" }) } });
      throw conflict;
    });

    await expect(ingestMachineEvent(input, { machine })).rejects.toBe(conflict);
    expect(notify).not.toHaveBeenCalled();
  });

  it("still reports accepted when a post-commit notification fails", async () => {
    vi.mocked(prisma.machineEvent.findUnique).mockResolvedValue(null);
    vi.mocked(sideEffects.processEventSideEffects).mockImplementation(
      async (_tx, _m, _input, _eid, _setItem, _cache, afterCommit) => {
        afterCommit?.(async () => { throw new Error("push provider down"); });
      },
    );
    vi.mocked(prisma.$transaction).mockImplementation(async (cb) =>
      (cb as any)({ machineEvent: { create: vi.fn().mockResolvedValue({ id: "e1" }) } }));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(ingestMachineEvent(input, { machine })).resolves.toMatchObject({ duplicate: false, eventId: "e1" });
    } finally {
      errorLog.mockRestore();
    }
  });
});
