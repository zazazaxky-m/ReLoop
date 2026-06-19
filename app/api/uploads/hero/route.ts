import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 6 * 1024 * 1024;
const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const;

function hasValidSignature(bytes: Uint8Array, mime: keyof typeof ALLOWED_TYPES) {
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/png") {
    return (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47
    );
  }
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const formData = await req.formData();
    const file = formData.get("image");

    if (!(file instanceof File)) {
      throw new HttpError(422, "File gambar wajib dipilih");
    }
    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      throw new HttpError(422, "Ukuran gambar maksimal 6 MB");
    }
    if (!(file.type in ALLOWED_TYPES)) {
      throw new HttpError(422, "Format gambar harus JPG, PNG, atau WebP");
    }

    const mime = file.type as keyof typeof ALLOWED_TYPES;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasValidSignature(bytes, mime)) {
      throw new HttpError(422, "Isi file tidak sesuai dengan format gambarnya");
    }

    const uploadDir = path.join(process.cwd(), "public", "uploads", "hero");
    await mkdir(uploadDir, { recursive: true });

    const filename = `${Date.now()}-${randomUUID()}.${ALLOWED_TYPES[mime]}`;
    await writeFile(path.join(uploadDir, filename), bytes);
    const url = `/uploads/hero/${filename}`;

    await logAudit({
      actorId: user.id,
      action: "HERO_IMAGE_UPLOAD",
      entityType: "SystemConfig",
      metadata: { url, size: file.size, mime },
    });

    return jsonOk({ url }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
