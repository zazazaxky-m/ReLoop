import { prisma } from "./prisma";

/**
 * Edge outbox health for the machine dashboard (R02). The machine reports its
 * own numbers in every HEARTBEAT payload (`queueDepth`, `deadLetterDepth`,
 * `lastSyncSuccessAt`); the server adds when it last stored an event.
 * Dead-lettered events stay on the machine and are retried from the kiosk
 * maintenance panel (PIN), never edited.
 */
export interface MachineSyncStatus {
  /** When the machine produced the reported numbers (its latest heartbeat). */
  reportedAt: Date | null;
  /** Events waiting on the machine; null when not reported (older runtime). */
  pending: number | null;
  /** Events the server rejected permanently, kept on the machine. */
  deadLetter: number | null;
  /** The machine's last durable acknowledgement from the server. */
  lastSuccessAt: Date | null;
  /** When the server stored this machine's most recent event. */
  lastReceivedAt: Date | null;
}

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

const instant = (value: unknown): Date | null => {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/** Reads the outbox fields of a HEARTBEAT payload, ignoring anything malformed. */
export function parseSyncHeartbeat(payload: unknown): Pick<MachineSyncStatus, "pending" | "deadLetter" | "lastSuccessAt"> {
  const data = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
  return {
    pending: count(data.queueDepth),
    deadLetter: count(data.deadLetterDepth),
    lastSuccessAt: instant(data.lastSyncSuccessAt),
  };
}

export async function getMachineSyncStatus(machineId: string): Promise<MachineSyncStatus> {
  // Both lookups walk the (machineId, occurredAt) index backwards.
  const [heartbeat, latest] = await Promise.all([
    prisma.machineEvent.findFirst({
      where: { machineId, eventType: "HEARTBEAT" },
      orderBy: { occurredAt: "desc" },
      select: { payloadJson: true, occurredAt: true },
    }),
    prisma.machineEvent.findFirst({
      where: { machineId },
      orderBy: { occurredAt: "desc" },
      select: { receivedAt: true },
    }),
  ]);
  return {
    reportedAt: heartbeat?.occurredAt ?? null,
    ...parseSyncHeartbeat(heartbeat?.payloadJson),
    lastReceivedAt: latest?.receivedAt ?? null,
  };
}
