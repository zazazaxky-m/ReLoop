import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyMachineSignature } from "@/lib/machine-auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { ingestMachineEvent } from "@/lib/machine-events";

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
      select: { id: true, ingestSecret: true },
    });
    if (!machine || !machine.ingestSecret) {
      return jsonError(404, "Mesin tidak ditemukan");
    }

    const verify = verifyMachineSignature({
      secret: machine.ingestSecret,
      timestamp: req.headers.get("x-reloop-timestamp"),
      nonce: req.headers.get("x-reloop-nonce"),
      rawBody,
      signature: req.headers.get("x-reloop-signature"),
    });
    if (!verify.ok) {
      return jsonError(401, verify.reason ?? "Unauthorised");
    }

    const results = [];
    for (const evt of body.events) {
      try {
        const result = await ingestMachineEvent({
          machineCode: body.machineCode,
          localEventId: evt.localEventId,
          eventType: evt.eventType as any,
          payload: evt.payload ?? null,
          sessionId: evt.sessionId ?? null,
          depositItemId: evt.depositItemId ?? null,
          occurredAt: evt.occurredAt ?? null,
        });
        results.push({ localEventId: evt.localEventId, status: result.duplicate ? "duplicate" : "accepted", eventId: result.eventId });
      } catch (err) {
        results.push({ localEventId: evt.localEventId, status: "error", error: (err as Error).message });
      }
    }

    return jsonOk({ received: results.length, results });
  } catch (error) {
    return handleApiError(error);
  }
}
