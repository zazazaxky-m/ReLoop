import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export const SECURITY_EVENT_TYPES = [
  "FRAUD_DETECTED",
  "VANDALISM_DETECTED",
  "SAFE_STATE_ENTERED",
] as const;

export type SecurityEventRow = {
  id: string;
  eventType: string;
  occurredAt: Date;
  receivedAt: Date;
  payload: Record<string, unknown> | null;
  sessionId: string | null;
  depositItemId: string | null;
  machine: {
    id: string;
    machineCode: string;
    name: string;
    status: string;
    organization: { id: string; name: string };
  };
};

export async function getSecurityEvents(options?: {
  take?: number;
  machineId?: string;
  since?: Date;
}) {
  const where: Prisma.MachineEventWhereInput = {
    eventType: { in: [...SECURITY_EVENT_TYPES] },
    machineId: options?.machineId,
    occurredAt: options?.since ? { gte: options.since } : undefined,
  };

  const rows = await prisma.machineEvent.findMany({
    where,
    orderBy: { occurredAt: "desc" },
    take: options?.take ?? 100,
    include: {
      machine: {
        select: {
          id: true,
          machineCode: true,
          name: true,
          status: true,
          organization: { select: { id: true, name: true } },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    occurredAt: row.occurredAt,
    receivedAt: row.receivedAt,
    payload: (row.payloadJson ?? null) as Record<string, unknown> | null,
    sessionId: row.sessionId,
    depositItemId: row.depositItemId,
    machine: row.machine,
  })) satisfies SecurityEventRow[];
}

export async function getSecuritySummary() {
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [alerts24h, fraud7d, vandalism7d, affectedMachines] =
    await Promise.all([
      prisma.machineEvent.count({
        where: {
          eventType: { in: [...SECURITY_EVENT_TYPES] },
          occurredAt: { gte: since24h },
        },
      }),
      prisma.machineEvent.count({
        where: {
          eventType: "FRAUD_DETECTED",
          occurredAt: { gte: since7d },
        },
      }),
      prisma.machineEvent.count({
        where: {
          eventType: "VANDALISM_DETECTED",
          occurredAt: { gte: since7d },
        },
      }),
      prisma.machineEvent.findMany({
        where: {
          eventType: { in: [...SECURITY_EVENT_TYPES] },
          occurredAt: { gte: since7d },
        },
        distinct: ["machineId"],
        select: { machineId: true },
      }),
    ]);

  return {
    alerts24h,
    fraud7d,
    vandalism7d,
    affectedMachines7d: affectedMachines.length,
  };
}
