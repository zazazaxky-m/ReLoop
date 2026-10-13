import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import {
  REDEMPTION_NOT_FOUND,
  REDEMPTION_PROOF_CLOSED,
  attachRedemptionProof,
} from "@/lib/wallet-service";
import {
  PROOF_ALLOWED_TYPES,
  PROOF_MIME_BY_EXTENSION,
  hasValidImageSignature,
  resolveProofPath,
} from "@/lib/redemption-proof";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 6 * 1024 * 1024;
const TERMINAL_STATUSES = new Set(["SUCCESS", "FAILED", "REVERSED"]);

/** Uploads (or replaces) the bank transfer proof for a manual redemption.
 * Required before PATCH .../[id] can mark it as `success` unless a
 * providerReference was supplied instead. SUPERADMIN-only, matching who
 * processes redemptions. The file is written first (outside any database
 * transaction); attaching it rechecks owner and status under the
 * User -> Redemption locks, and a refused attach deletes the file again. */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;

    // Fast refusal before reading the upload; the decision is rechecked under lock.
    const redemption = await prisma.redemption.findUnique({
      where: { id },
      select: { userId: true, status: true },
    });
    if (!redemption) throw new HttpError(404, REDEMPTION_NOT_FOUND);
    if (TERMINAL_STATUSES.has(redemption.status)) {
      throw new HttpError(409, REDEMPTION_PROOF_CLOSED);
    }

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new HttpError(422, "File bukti transfer wajib dipilih");
    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      throw new HttpError(422, "Ukuran file maksimal 6 MB");
    }
    if (!(file.type in PROOF_ALLOWED_TYPES)) {
      throw new HttpError(422, "Format bukti transfer harus JPG, PNG, atau WebP");
    }

    const mime = file.type;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!hasValidImageSignature(bytes, mime)) {
      throw new HttpError(422, "Isi file tidak sesuai dengan format gambarnya");
    }

    const extension = PROOF_ALLOWED_TYPES[mime];
    const relativePath = `${id}/${Date.now()}-${randomUUID()}.${extension}`;
    const absolutePath = resolveProofPath(relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, bytes);

    try {
      await attachRedemptionProof(user, id, {
        relativePath,
        expectedUserId: redemption.userId,
        size: file.size,
        mime,
      });
    } catch (error) {
      // Not attached: do not leave an orphan file that names this request.
      await unlink(absolutePath).catch(() => undefined);
      throw error;
    }

    return jsonOk({ ok: true }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

/** Streams the uploaded proof back for review. Never exposed as a public
 * static URL — the stored value is a relative path resolved against the
 * private storage root, not a client-facing link. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;
    const redemption = await prisma.redemption.findUnique({
      where: { id },
      select: { manualTransferProofUrl: true },
    });
    if (!redemption?.manualTransferProofUrl) {
      return jsonError(404, "Bukti transfer belum diunggah");
    }

    const extension = redemption.manualTransferProofUrl.split(".").pop() || "";
    const mime = PROOF_MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
    const bytes = await readFile(resolveProofPath(redemption.manualTransferProofUrl));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError(404, "Bukti transfer tidak tersedia");
  }
}
