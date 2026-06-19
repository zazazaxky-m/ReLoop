import { z } from "zod";
import { MachineEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { ingestMachineEvent } from "@/lib/machine-events";
import { verifyMachineSignature } from "@/lib/machine-auth";
import { publishRealtime } from "@/lib/realtime";

const eventFields = z.object({
  localEventId: z.string().min(1),
  eventType: z.nativeEnum(MachineEventType),
  payload: z.record(z.unknown()).optional(),
  sessionId: z.string().transform((v) => (v === "" ? null : v)).optional().nullable(),
  depositItemId: z.string().transform((v) => (v === "" ? null : v)).optional().nullable(),
  occurredAt: z.string().optional().nullable(),
});

const singleSchema = eventFields.extend({
  machineCode: z.string().min(1),
});

const batchSchema = z.object({
  machineCode: z.string().min(1),
  events: z.array(eventFields).min(1).max(50),
});

const bodySchema = z.union([singleSchema, batchSchema]);

/**
 * HMAC-authenticated machine ingestion.
 * Supports a single event or a compact batch of up to 50 events to reduce
 * cellular data and TLS/header overhead.
 */
export async function POST(req: Request) {
  try {
    const raw = await req.text();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return jsonError(400, "Body bukan JSON valid");
    }
    const body = bodySchema.parse(parsed);

    const machine = await prisma.machine.findUnique({
      where: { machineCode: body.machineCode },
      select: { id: true, ingestSecret: true },
    });
    if (!machine) return jsonError(404, "Mesin tidak ditemukan");
    if (!machine.ingestSecret) {
      return jsonError(401, "Mesin belum dikonfigurasi secret ingest");
    }

    const headerCode = req.headers.get("x-reloop-machine");
    if (headerCode && headerCode !== body.machineCode) {
      return jsonError(401, "Header mesin tidak cocok dengan body");
    }

    const verdict = verifyMachineSignature({
      secret: machine.ingestSecret,
      timestamp: req.headers.get("x-reloop-timestamp"),
      nonce: req.headers.get("x-reloop-nonce"),
      signature: req.headers.get("x-reloop-signature"),
      rawBody: raw,
    });
    if (!verdict.ok) {
      return jsonError(401, `Tanda tangan tidak valid (${verdict.reason})`);
    }

    const inputs =
      "events" in body
        ? body.events.map((event) => ({ ...event, machineCode: body.machineCode }))
        : [body];
    const results = [];

    for (const input of inputs) {
      const result = await ingestMachineEvent(input);
      results.push(result);

      if (!result.duplicate) {
        const security = ["FRAUD_DETECTED", "VANDALISM_DETECTED", "SAFE_STATE_ENTERED"].includes(
          input.eventType,
        );
        void publishRealtime({
          topic: security ? "security-alert" : "machine-event",
          machineCode: input.machineCode,
          eventType: input.eventType,
          eventId: result.eventId,
          occurredAt: input.occurredAt ?? new Date().toISOString(),
        });
      }
    }

    return jsonOk(
      "events" in body
        ? {
            accepted: results.length,
            duplicates: results.filter((result) => result.duplicate).length,
            results,
          }
        : results[0],
      results.every((result) => result.duplicate) ? 200 : 201,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Mesin tidak ditemukan") {
      return jsonError(404, error.message);
    }
    return handleApiError(error);
  }
}
