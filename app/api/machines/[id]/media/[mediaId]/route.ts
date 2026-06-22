import { unlink } from "node:fs/promises";
import { z } from "zod";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { resolveMachineMediaPath, serializeMachineMedia } from "@/lib/machine-media";
import { prisma } from "@/lib/prisma";
import { HttpError, requireApiUser } from "@/lib/rbac";

const updateSchema = z.object({ title: z.string().trim().max(100).nullable().optional(), active: z.boolean().optional(), durationSeconds: z.number().int().min(3).max(60).optional(), sortOrder: z.number().int().min(0).max(10000).optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const { id, mediaId } = await params;
    const body = updateSchema.parse(await req.json());
    const existing = await prisma.machineMedia.findFirst({ where: { id: mediaId, machineId: id } });
    if (!existing) throw new HttpError(404, "Media tidak ditemukan");
    const media = await prisma.machineMedia.update({ where: { id: mediaId }, data: { ...body, title: body.title === "" ? null : body.title, durationSeconds: existing.mediaType === "IMAGE" ? body.durationSeconds : undefined } });
    await logAudit({ actorId: user.id, action: "MACHINE_MEDIA_UPDATE", entityType: "MachineMedia", entityId: mediaId, metadata: { machineId: id, ...body } });
    return jsonOk({ media: serializeMachineMedia(media) });
  } catch (error) { return handleApiError(error); }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; mediaId: string }> }) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const { id, mediaId } = await params;
    const media = await prisma.machineMedia.findFirst({ where: { id: mediaId, machineId: id } });
    if (!media) throw new HttpError(404, "Media tidak ditemukan");
    await prisma.machineMedia.delete({ where: { id: mediaId } });
    await unlink(resolveMachineMediaPath(media.storagePath)).catch(() => undefined);
    await logAudit({ actorId: user.id, action: "MACHINE_MEDIA_DELETE", entityType: "MachineMedia", entityId: mediaId, metadata: { machineId: id, originalName: media.originalName } });
    return jsonOk({ deleted: true });
  } catch (error) { return handleApiError(error); }
}
