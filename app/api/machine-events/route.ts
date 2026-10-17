import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyMachineRequest } from "@/lib/machine-auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { ingestMachineEvent, type IngestMachine } from "@/lib/machine-events";
import { createDepositItemCache } from "@/lib/machine-events/item-cache";
import {
  INVALID_EVENT,
  MACHINE_EVENTS_PROTOCOL_VERSION,
  classifyIngestFailure,
  eventFailure,
  failureTag,
  machineEventSchema,
  type MachineEventResult,
  type MachineEventsResponse,
} from "@/lib/machine-events/protocol";

// Envelope only: one malformed event must not reject the whole batch (it is
// answered per event as INVALID_EVENT), or a poison event would stall the
// machine's outbox.
const batchSchema = z.object({
  machineCode: z.string(),
  events: z.array(z.object({ localEventId: z.string() }).passthrough()),
});

/** Protocol v2: see lib/machine-events/protocol.ts and rvm/README.md. */
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
    // Sessions whose earlier event in this batch failed transiently. Their
    // later events wait (retryable) so the machine resends them in order: the
    // backend resolves "the item" of an event from the session's history.
    const heldSessions = new Set<string>();
    const results: MachineEventResult[] = [];
    for (const raw of body.events) {
      const duplicate = duplicateByLocalId.get(raw.localEventId);
      if (duplicate) {
        results.push({
          localEventId: raw.localEventId,
          status: "duplicate",
          eventId: duplicate.id,
        });
        continue;
      }

      const parsed = machineEventSchema.safeParse(raw);
      if (!parsed.success) {
        results.push(eventFailure(raw.localEventId, INVALID_EVENT));
        continue;
      }
      const evt = parsed.data;
      if (evt.sessionId && heldSessions.has(evt.sessionId)) {
        results.push(eventFailure(evt.localEventId, { error: "SESSION_HELD", retryable: true }));
        continue;
      }

      try {
        // Resolves only after the event and its reward committed.
        const result = await ingestMachineEvent(
          {
            machineCode: body.machineCode,
            localEventId: evt.localEventId,
            eventType: evt.eventType,
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
        duplicateByLocalId.set(evt.localEventId, {
          localEventId: evt.localEventId,
          id: result.eventId,
          depositItemId: result.depositItemId ?? null,
        });
      } catch (error) {
        const failure = classifyIngestFailure(error);
        if (evt.sessionId) {
          // The rolled-back attempt may have cached an item that never
          // committed; later events re-resolve it from the database.
          depositItemCache.delete(evt.sessionId);
          if (failure.retryable) heldSessions.add(evt.sessionId);
        }
        console.error("[machine-events] event not ingested", {
          machineId: machine.id,
          localEventId: evt.localEventId,
          eventType: evt.eventType,
          result: failure.error,
          cause: failureTag(error),
        });
        // Only a stable code reaches the machine: no message, stack or SQL.
        results.push(eventFailure(evt.localEventId, failure));
      }
    }

    const response: MachineEventsResponse = {
      protocolVersion: MACHINE_EVENTS_PROTOCOL_VERSION,
      received: results.length,
      results,
    };
    return jsonOk(response);
  } catch (error) {
    return handleApiError(error);
  }
}
