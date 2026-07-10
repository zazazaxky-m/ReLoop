import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyMachineRequest } from "@/lib/machine-auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { ingestMachineEvent, type IngestMachine } from "@/lib/machine-events";
import { createDepositItemCache } from "@/lib/machine-events/item-cache";

const batchSchema = z.object({
  machineCode: z.string(),
  events: z.array(z.object({
    localEventId: z.string(),
    eventType: z.string(),
    payload: z.record(z.unknown()).optional().nullable(),
    sessionId: z.string().optional().nullable(),
    depositItemId: z.string().optional().nullable(),
    occurredAt: z.string().optional().nullable(),
  })),
});

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.clone().text();
    const body = batchSchema.parse(JSON.parse(rawBody));

    const machine = await prisma.machine.findUnique({
      where: { machineCode: body.machineCode },
      include: { organization: true },
    });
    if (!machine?.ingestSecret) {
      return jsonError(404, "Mesin tidak ditemukan");
    }

    const verify = await verifyMachineRequest({
      machineId: machine.id,
      secret: machine.ingestSecret,
      timestamp: req.headers.get("x-reloop-timestamp"),
      nonce: req.headers.get("x-reloop-nonce"),
      rawBody,
      signature: req.headers.get("x-reloop-signature"),
    });
    if (!verify.ok) {
      return jsonError(401, verify.reason || "Unauthorised");
    }

    const ingestMachine = machine as IngestMachine;
    const localEventIds = body.events.map((evt) => evt.localEventId);
    const existingEvents = localEventIds.length
      ? await prisma.machineEvent.findMany({
          where: {
            machineId: machine.id,
            localEventId: { in: localEventIds },
          },
          select: { localEventId: true, id: true, depositItemId: true },
        })
      : [];
    const duplicateByLocalId = new Map(
      existingEvents.map((evt) => [evt.localEventId, evt]),
    );

    const depositItemCache = createDepositItemCache();
    const results = [];
    for (const evt of body.events) {
      const duplicate = duplicateByLocalId.get(evt.localEventId);
      if (duplicate) {
        results.push({
          localEventId: evt.localEventId,
          status: "duplicate",
          eventId: duplicate.id,
        });
        continue;
      }

      try {
        const result = await ingestMachineEvent(
          {
            machineCode: body.machineCode,
            localEventId: evt.localEventId,
            eventType: evt.eventType as any,
            payload: evt.payload ?? null,
            sessionId: evt.sessionId ?? null,
            depositItemId: evt.depositItemId ?? null,
            occurredAt: evt.occurredAt ?? null,
          },
          { machine: ingestMachine, depositItemCache },
        );
        results.push({
          localEventId: evt.localEventId,
          status: result.duplicate ? "duplicate" : "accepted",
          eventId: result.eventId,
        });
        if (!result.duplicate) {
          duplicateByLocalId.set(evt.localEventId, {
            localEventId: evt.localEventId,
            id: result.eventId,
            depositItemId: result.depositItemId ?? null,
          });
        }
      } catch {
        results.push({
          localEventId: evt.localEventId,
          status: "error",
          error: "EVENT_REJECTED",
        });
      }
    }

    return jsonOk({ received: results.length, results });
  } catch (error) {
    return handleApiError(error);
  }
}
