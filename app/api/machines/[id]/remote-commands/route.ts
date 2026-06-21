import { RemoteCommandType, type Prisma } from "@prisma/client";
import { z } from "zod";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import {
  REMOTE_COMMAND_EXPIRY_SECONDS,
} from "@/lib/remote-commands";
import { HttpError, requireApiUser } from "@/lib/rbac";
import { publishRealtime } from "@/lib/realtime";

const createSchema = z.object({
  command: z.nativeEnum(RemoteCommandType),
  payload: z.record(z.unknown()).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;
    const machine = await prisma.machine.findUnique({
      where: { id },
      select: {
        id: true,
        machineCode: true,
        status: true,
        fillLevelPercent: true,
        lastHeartbeatAt: true,
      },
    });
    if (!machine) throw new HttpError(404, "Mesin tidak ditemukan");

    await prisma.machineRemoteCommand.updateMany({
      where: {
        machineId: id,
        status: { in: ["QUEUED", "DISPATCHED"] },
        expiresAt: { lte: new Date() },
      },
      data: {
        status: "EXPIRED",
        completedAt: new Date(),
        errorMessage: "Perintah kedaluwarsa sebelum diselesaikan perangkat",
      },
    });

    const commands = await prisma.machineRemoteCommand.findMany({
      where: { machineId: id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return jsonOk({
      machine,
      commands: commands.map((command) => ({
        id: command.id,
        command: command.command,
        status: command.status,
        result: command.resultJson,
        errorMessage: command.errorMessage,
        expiresAt: command.expiresAt,
        dispatchedAt: command.dispatchedAt,
        completedAt: command.completedAt,
        createdAt: command.createdAt,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;
    const body = createSchema.parse(await req.json());
    const machine = await prisma.machine.findUnique({
      where: { id },
      select: { id: true, machineCode: true, ingestSecret: true },
    });
    if (!machine) throw new HttpError(404, "Mesin tidak ditemukan");
    if (!machine.ingestSecret) {
      return jsonError(422, "Mesin belum memiliki ingest secret");
    }

    const existing = await prisma.machineRemoteCommand.findFirst({
      where: {
        machineId: id,
        command: body.command,
        status: { in: ["QUEUED", "DISPATCHED"] },
        expiresAt: { gt: new Date() },
      },
    });
    if (existing) {
      return jsonOk({ command: existing, duplicate: true });
    }

    const command = await prisma.machineRemoteCommand.create({
      data: {
        machineId: id,
        requestedById: user.id,
        command: body.command,
        payloadJson: body.payload as Prisma.InputJsonValue | undefined,
        expiresAt: new Date(
          Date.now() + REMOTE_COMMAND_EXPIRY_SECONDS * 1000,
        ),
      },
    });
    await logAudit({
      actorId: user.id,
      action: "RVM_REMOTE_COMMAND_CREATED",
      entityType: "MachineRemoteCommand",
      entityId: command.id,
      metadata: {
        machineId: id,
        machineCode: machine.machineCode,
        command: body.command,
      },
    });
    void publishRealtime({
      topic: "machine-state",
      machineCode: machine.machineCode,
      eventType: "REMOTE_COMMAND_QUEUED",
      eventId: command.id,
    });
    return jsonOk({ command, duplicate: false }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
