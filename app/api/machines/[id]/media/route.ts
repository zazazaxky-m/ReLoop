import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { machineMediaStorageRoot, serializeMachineMedia } from "@/lib/machine-media";
import { prisma } from "@/lib/prisma";
import { HttpError, requireApiUser } from "@/lib/rbac";

export const runtime = "nodejs";
const MAX_IMAGE_SIZE = 12 * 1024 * 1024;
const MAX_VIDEO_SIZE = 150 * 1024 * 1024;
const ALLOWED = {
  "image/jpeg": { extension: "jpg", type: "IMAGE" },
  "image/png": { extension: "png", type: "IMAGE" },
  "image/webp": { extension: "webp", type: "IMAGE" },
  "video/mp4": { extension: "mp4", type: "VIDEO" },
  "video/webm": { extension: "webm", type: "VIDEO" },
} as const;

function validSignature(bytes: Uint8Array, mime: keyof typeof ALLOWED) {
  if (mime === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mime === "image/webp") return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (mime === "video/webm") return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;
    const machine = await prisma.machine.findUnique({ where: { id }, select: { id: true } });
    if (!machine) throw new HttpError(404, "Mesin tidak ditemukan");
    const media = await prisma.machineMedia.findMany({ where: { machineId: id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    return jsonOk({ media: media.map(serializeMachineMedia) });
  } catch (error) { return handleApiError(error); }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;
    const machine = await prisma.machine.findUnique({ where: { id }, select: { id: true, machineCode: true } });
    if (!machine) throw new HttpError(404, "Mesin tidak ditemukan");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(422, "Pilih foto atau video terlebih dahulu");
    if (!(file.type in ALLOWED)) throw new HttpError(422, "Format harus JPG, PNG, WebP, MP4, atau WebM");
    const mime = file.type as keyof typeof ALLOWED;
    const definition = ALLOWED[mime];
    const maxSize = definition.type === "IMAGE" ? MAX_IMAGE_SIZE : MAX_VIDEO_SIZE;
    if (file.size <= 0 || file.size > maxSize) throw new HttpError(422, definition.type === "IMAGE" ? "Ukuran foto maksimal 12 MB" : "Ukuran video maksimal 150 MB");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!validSignature(bytes, mime)) throw new HttpError(422, "Isi file tidak sesuai dengan formatnya");
    const current = await prisma.machineMedia.aggregate({ where: { machineId: id }, _max: { sortOrder: true } });
    const mediaId = randomUUID();
    const filename = `${mediaId}.${definition.extension}`;
    const relativePath = path.join(id, filename);
    await mkdir(path.join(machineMediaStorageRoot, id), { recursive: true });
    await writeFile(path.join(machineMediaStorageRoot, relativePath), bytes);
    const durationRaw = Number(form.get("durationSeconds") ?? 8);
    const media = await prisma.machineMedia.create({ data: {
      id: mediaId, machineId: id, title: String(form.get("title") ?? "").trim().slice(0, 100) || null,
      mediaType: definition.type, mimeType: mime, originalName: file.name.slice(0, 255), storagePath: relativePath,
      fileSize: file.size, sha256: createHash("sha256").update(bytes).digest("hex"),
      durationSeconds: definition.type === "IMAGE" ? Math.min(60, Math.max(3, Number.isFinite(durationRaw) ? Math.round(durationRaw) : 8)) : 0,
      sortOrder: (current._max.sortOrder ?? -1) + 1, active: true, createdById: user.id,
    } });
    await logAudit({ actorId: user.id, action: "MACHINE_MEDIA_UPLOAD", entityType: "MachineMedia", entityId: media.id, metadata: { machineId: id, machineCode: machine.machineCode, mime, size: file.size } });
    return jsonOk({ media: serializeMachineMedia(media) }, 201);
  } catch (error) { return handleApiError(error); }
}
