import { z } from "zod";
import { MachineEventType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { ingestMachineEvent } from "@/lib/machine-events";
import { verifyMachineSignature } from "@/lib/machine-auth";

const eventSchema = z.object({
  machineCode: z.string().min(1),
  localEventId: z.string().min(1),
  eventType: z.nativeEnum(MachineEventType),
  payload: z.record(z.unknown()).optional(),
  sessionId: z.string().optional().nullable(),
  depositItemId: z.string().optional().nullable(),
  occurredAt: z.string().optional().nullable(),
});

/**
 * Machine -> server ingestion secured with a per-machine HMAC handshake.
 * The machine signs `${timestamp}.${nonce}.${rawBody}` with its own secret;
 * the server recomputes and compares (timing-safe), rejecting stale timestamps.
 * Replay is further bounded by the unique (machineId, localEventId) constraint.
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
    const body = eventSchema.parse(parsed);

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

    const result = await ingestMachineEvent(body);
    return jsonOk(result, result.duplicate ? 200 : 201);
  } catch (error) {
    if (error instanceof Error && error.message === "Mesin tidak ditemukan") {
      return jsonError(404, error.message);
    }
    return handleApiError(error);
  }
}
