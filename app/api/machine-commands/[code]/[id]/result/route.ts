import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { verifyMachineSignature } from "@/lib/machine-auth";
import { prisma } from "@/lib/prisma";
import { publishRealtime } from "@/lib/realtime";

const resultSchema = z.object({
  success: z.boolean(),
  result: z.record(z.unknown()).optional(),
  error: z.string().max(1000).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ code: string; id: string }> },
) {
  const { code, id } = await params;
  const raw = await req.text();
  const machine = await prisma.machine.findUnique({
    where: { machineCode: code },
    select: { id: true, ingestSecret: true },
  });
  if (!machine) return jsonError(404, "Mesin tidak ditemukan");
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
  if (req.headers.get("x-reloop-machine") !== code) {
    return jsonError(401, "Header mesin tidak cocok");
  }

  const body = resultSchema.parse(JSON.parse(raw));
  const existing = await prisma.machineRemoteCommand.findFirst({
    where: { id, machineId: machine.id },
  });
  if (!existing) return jsonError(404, "Perintah tidak ditemukan");
  if (["SUCCEEDED", "FAILED", "EXPIRED"].includes(existing.status)) {
    return jsonOk({ command: existing, duplicate: true });
  }

  const command = await prisma.machineRemoteCommand.update({
    where: { id },
    data: {
      status: body.success ? "SUCCEEDED" : "FAILED",
      resultJson: body.result as Prisma.InputJsonValue | undefined,
      errorMessage: body.success ? null : body.error ?? "Perintah gagal",
      completedAt: new Date(),
    },
  });
  const runtimeState = String(body.result?.runtimeState ?? "");
  const machineStatus =
    runtimeState === "FULL"
      ? "FULL"
      : ["SAFE_STATE", "ERROR"].includes(runtimeState)
        ? "ERROR"
        : runtimeState === "MAINTENANCE"
          ? "MAINTENANCE"
          : runtimeState
            ? "ONLINE"
            : undefined;
  const sensors =
    body.result?.sensors && typeof body.result.sensors === "object"
      ? (body.result.sensors as Record<string, unknown>)
      : null;
  await prisma.machine.update({
    where: { id: machine.id },
    data: {
      status: machineStatus,
      fillLevelPercent:
        typeof sensors?.fill_percent === "number"
          ? sensors.fill_percent
          : undefined,
      lastHeartbeatAt: new Date(),
    },
  });
  await logAudit({
    actorId: existing.requestedById,
    action: body.success
      ? "RVM_REMOTE_COMMAND_SUCCEEDED"
      : "RVM_REMOTE_COMMAND_FAILED",
    entityType: "MachineRemoteCommand",
    entityId: id,
    metadata: {
      machineCode: code,
      command: existing.command,
      error: body.error,
    },
  });
  void publishRealtime({
    topic: "machine-state",
    machineCode: code,
    eventType: "REMOTE_COMMAND_COMPLETED",
    eventId: id,
  });
  return jsonOk({ command, duplicate: false });
}
