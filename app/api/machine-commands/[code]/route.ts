import { jsonError, jsonOk } from "@/lib/api";
import { verifyMachineSignature } from "@/lib/machine-auth";
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
  const verdict = verifyMachineSignature({
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
    const pending = await tx.machineRemoteCommand.findFirst({
      where: {
        machineId: machine.id,
        status: { in: ["QUEUED", "DISPATCHED"] },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "asc" },
    });
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
