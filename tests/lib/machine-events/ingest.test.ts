import { describe, expect, it, vi, beforeEach } from "vitest";
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
