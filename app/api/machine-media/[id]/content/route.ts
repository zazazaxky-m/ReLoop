import { readFile } from "node:fs/promises";
import { jsonError } from "@/lib/api";
import { resolveMachineMediaPath } from "@/lib/machine-media";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/rbac";
export const runtime = "nodejs";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser(["SUPERADMIN"]); const { id } = await params;
    const media = await prisma.machineMedia.findUnique({ where: { id }, select: { storagePath: true, mimeType: true } });
    if (!media) return jsonError(404, "Media tidak ditemukan");
    const bytes = await readFile(resolveMachineMediaPath(media.storagePath));
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": media.mimeType, "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
  } catch { return jsonError(404, "Media tidak tersedia"); }
}
