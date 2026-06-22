import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyMachineSignature } from "@/lib/machine-auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";

const eventsSchema = z.object({
  machineCode: z.string(),
  events: z.array(z.record(z.unknown())),
});

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.clone().text();
    const body = eventsSchema.parse(JSON.parse(rawBody));

    const machine = await prisma.machine.findUnique({
      where: { machineCode: body.machineCode },
      select: { id: true, ingestSecret: true },
    });

    if (!machine || !machine.ingestSecret) {
      return jsonError(404, "Mesin tidak ditemukan");
    }

    const timestamp = req.headers.get("x-reloop-timestamp");
    const nonce = req.headers.get("x-reloop-nonce");
    const signature = req.headers.get("x-reloop-signature");

    const verify = verifyMachineSignature({
      secret: machine.ingestSecret,
      timestamp: timestamp ?? undefined,
      nonce: nonce ?? undefined,
      rawBody,
      signature: signature ?? undefined,
    });

    if (!verify.ok) {
      return jsonError(401, verify.reason ?? "Unauthorised");
    }

    for (const event of body.events) {
      const record = event as Record<string, unknown>;
      let payload = record;
      if (typeof record.payload_json === 'string') {
        try { payload = JSON.parse(record.payload_json); } catch (_) {}
      }
      const eventTypeVal = (record.event_type as string) || (record.eventType as string) || 'UNKNOWN';
      const localId = (record.local_event_id as string) || (record.localEventId as string) || 'unknown';

      try {
        await prisma.machineEvent.create({
          data: {
            machineId: machine.id,
            localEventId: localId,
            eventType: eventTypeVal as any,
            payloadJson: payload as any,
            occurredAt: record.occurred_at ? new Date(record.occurred_at as string) : undefined,
          },
        });
      } catch (_) {
        // Skip duplicate events gracefully
      }
    }

    return jsonOk({ received: body.events.length });
  } catch (error) {
    return handleApiError(error);
  }
}
