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

export type DepositReviewRow = {
  id: string;
  quantity: number;
  measuredWeightGrams: number | null;
  aiDetectedType: string | null;
  aiConfidence: number | null;
  validationReasonCode: string | null;
  createdAt: Date;
  wasteType: { id: string; name: string; unit: string };
  pendingLedgerAmount: number;
  session: {
    id: string;
    startedAt: Date;
    user: { id: string; name: string; email: string };
    machine: {
      id: string;
      machineCode: string;
      name: string;
      organizationId: string;
      organization: { id: string; name: string };
    };
  };
};

/**
 * Deposit items awaiting manual resolution: sensor/fraud anomalies (50%
 * reward already reserved as EARN/PENDING) and the unknown-waste-type
 * fallback (0 reward, no ledger entry yet). Shared by the review API route
 * and the superadmin/admin security page so both read the same query.
 */
export async function getDepositReviewQueue(options?: {
  organizationId?: string;
  skip?: number;
  take?: number;
}): Promise<{ items: DepositReviewRow[]; total: number }> {
  const where: Prisma.DepositItemWhereInput = {
    status: "REVIEW",
    session: options?.organizationId
      ? { machine: { organizationId: options.organizationId } }
      : undefined,
  };

  const [total, rows] = await Promise.all([
    prisma.depositItem.count({ where }),
    prisma.depositItem.findMany({
      where,
      orderBy: { createdAt: "asc" },
      skip: options?.skip,
      take: options?.take,
      include: {
        wasteType: { select: { id: true, name: true, unit: true } },
        ledgerEntries: {
          where: { entryType: "EARN" },
          select: { amount: true, status: true },
        },
        session: {
          select: {
            id: true,
            startedAt: true,
            user: { select: { id: true, name: true, email: true } },
            machine: {
              select: {
                id: true,
                machineCode: true,
                name: true,
                organizationId: true,
                organization: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    }),
  ]);

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      quantity: row.quantity,
      measuredWeightGrams: row.measuredWeightGrams,
      aiDetectedType: row.aiDetectedType,
      aiConfidence: row.aiConfidence,
      validationReasonCode: row.validationReasonCode,
      createdAt: row.createdAt,
      wasteType: row.wasteType,
      pendingLedgerAmount: row.ledgerEntries[0]?.amount ?? 0,
      session: row.session,
    })),
  };
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
