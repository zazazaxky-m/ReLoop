import { readFile } from "node:fs/promises";
import { jsonError } from "@/lib/api";
import { verifyMachineSignature } from "@/lib/machine-auth";
import { resolveMachineMediaPath } from "@/lib/machine-media";
import { prisma } from "@/lib/prisma";
export const runtime = "nodejs";
export async function GET(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  try {
    const { code, id } = await params;
    const machine = await prisma.machine.findUnique({ where: { machineCode: code }, select: { id: true, ingestSecret: true } });
    if (!machine) return jsonError(404, "Mesin tidak ditemukan");
    const verdict = verifyMachineSignature({ secret: machine.ingestSecret, timestamp: req.headers.get("x-reloop-timestamp"), nonce: req.headers.get("x-reloop-nonce"), signature: req.headers.get("x-reloop-signature"), rawBody: "" });
    if (!verdict.ok || req.headers.get("x-reloop-machine") !== code) return jsonError(401, "Tanda tangan tidak valid");
    const media = await prisma.machineMedia.findFirst({ where: { id, machineId: machine.id, active: true } });
    if (!media) return jsonError(404, "Media tidak ditemukan");
    const bytes = await readFile(resolveMachineMediaPath(media.storagePath));
    return new Response(new Uint8Array(bytes), { headers: { "Content-Type": media.mimeType, "Content-Length": String(bytes.length), "Cache-Control": "private, max-age=3600, immutable", "X-Media-SHA256": media.sha256, "X-Content-Type-Options": "nosniff" } });
  } catch { return jsonError(404, "Media tidak tersedia"); }
}
