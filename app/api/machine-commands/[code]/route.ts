import type { Prisma } from "@prisma/client";
import { jsonError, jsonOk } from "@/lib/api";
import { verifyMachineRequest } from "@/lib/machine-auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  const { code } = await params;
  const machine = await prisma.machine.findUnique({
    where: { machineCode: code },
    select: { id: true, ingestSecret: true },
  });
  if (!machine) return jsonError(404, "Mesin tidak ditemukan");
  const verdict = await verifyMachineRequest({
    machineId: machine.id,
    secret: machine.ingestSecret,
    timestamp: req.headers.get("x-reloop-timestamp"),
    nonce: req.headers.get("x-reloop-nonce"),
    signature: req.headers.get("x-reloop-signature"),
    rawBody: "",
  });
  if (!verdict.ok) {
    return jsonError(401, `Tanda tangan tidak valid (${verdict.reason})`);
  }
  if (req.headers.get("x-reloop-machine") !== code) {
    return jsonError(401, "Header mesin tidak cocok");
  }

  await prisma.machineRemoteCommand.updateMany({
    where: {
      machineId: machine.id,
      status: { in: ["QUEUED", "DISPATCHED"] },
      expiresAt: { lte: new Date() },
    },
    data: {
      status: "EXPIRED",
      completedAt: new Date(),
      errorMessage: "Perintah kedaluwarsa",
    },
  });

  const command = await prisma.$transaction(async (tx) => {
    const pendingWhere = {
      machineId: machine.id,
      status: { in: ["QUEUED", "DISPATCHED"] },
      expiresAt: { gt: new Date() },
    } satisfies Prisma.MachineRemoteCommandWhereInput;
    // A pending STOP_ALL is handed out before any other pending command,
    // even one already DISPATCHED (e.g. a slow SYNC_NOW still running on the
    // machine). Otherwise commands are handed out oldest first.
    const pending =
      (await tx.machineRemoteCommand.findFirst({
        where: { ...pendingWhere, command: "STOP_ALL" },
        orderBy: { createdAt: "asc" },
      })) ??
      (await tx.machineRemoteCommand.findFirst({
        where: pendingWhere,
        orderBy: { createdAt: "asc" },
      }));
    if (!pending) return null;
    if (pending.status === "DISPATCHED") return pending;
    return tx.machineRemoteCommand.update({
      where: { id: pending.id },
      data: { status: "DISPATCHED", dispatchedAt: new Date() },
    });
  });

  return jsonOk({
    command: command
      ? {
          id: command.id,
          command: command.command,
          payload: command.payloadJson,
          expiresAt: command.expiresAt,
        }
      : null,
  });
}
