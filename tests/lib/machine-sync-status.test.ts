import { beforeEach, describe, expect, it, vi } from "vitest";
import { getMachineSyncStatus, parseSyncHeartbeat } from "@/lib/machine-sync-status";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: { machineEvent: { findFirst: vi.fn() } },
}));

describe("machine sync status (R02 operator view)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads pending, dead-letter and last success from the latest heartbeat", async () => {
    const reportedAt = new Date("2026-10-13T08:05:00Z");
    const receivedAt = new Date("2026-10-13T08:05:02Z");
    vi.mocked(prisma.machineEvent.findFirst)
      .mockResolvedValueOnce({
        occurredAt: reportedAt,
        payloadJson: { status: "ONLINE", queueDepth: 3, deadLetterDepth: 1, lastSyncSuccessAt: "2026-10-13T08:04:58.120000Z" },
      } as any)
      .mockResolvedValueOnce({ receivedAt } as any);

    expect(await getMachineSyncStatus("m1")).toEqual({
      reportedAt,
      pending: 3,
      deadLetter: 1,
      lastSuccessAt: new Date("2026-10-13T08:04:58.120Z"),
      lastReceivedAt: receivedAt,
    });
    expect(prisma.machineEvent.findFirst).toHaveBeenCalledWith({
      where: { machineId: "m1", eventType: "HEARTBEAT" },
      orderBy: { occurredAt: "desc" },
      select: { payloadJson: true, occurredAt: true },
    });
  });

  it("reports unknown (null) instead of guessing for machines without data", async () => {
    vi.mocked(prisma.machineEvent.findFirst).mockResolvedValue(null);
    expect(await getMachineSyncStatus("m1")).toEqual({
      reportedAt: null, pending: null, deadLetter: null, lastSuccessAt: null, lastReceivedAt: null,
    });
  });

  it("ignores malformed or pre-R02 heartbeat fields", () => {
    expect(parseSyncHeartbeat({ queueDepth: 2 })).toEqual({ pending: 2, deadLetter: null, lastSuccessAt: null });
    expect(parseSyncHeartbeat({ queueDepth: -1, deadLetterDepth: 1.5, lastSyncSuccessAt: "kemarin" }))
      .toEqual({ pending: null, deadLetter: null, lastSuccessAt: null });
    expect(parseSyncHeartbeat(["queueDepth", 3])).toEqual({ pending: null, deadLetter: null, lastSuccessAt: null });
    expect(parseSyncHeartbeat(null)).toEqual({ pending: null, deadLetter: null, lastSuccessAt: null });
  });
});
