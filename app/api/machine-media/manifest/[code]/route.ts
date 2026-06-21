import { createHash } from "node:crypto";
import { jsonError, jsonOk } from "@/lib/api";
import { verifyMachineSignature } from "@/lib/machine-auth";
import { prisma } from "@/lib/prisma";
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const machine = await prisma.machine.findUnique({ where: { machineCode: code }, select: { id: true, ingestSecret: true } });
  if (!machine) return jsonError(404, "Mesin tidak ditemukan");
  const verdict = verifyMachineSignature({ secret: machine.ingestSecret, timestamp: req.headers.get("x-reloop-timestamp"), nonce: req.headers.get("x-reloop-nonce"), signature: req.headers.get("x-reloop-signature"), rawBody: "" });
  if (!verdict.ok || req.headers.get("x-reloop-machine") !== code) return jsonError(401, `Tanda tangan tidak valid (${verdict.reason ?? "MACHINE_MISMATCH"})`);
  const media = await prisma.machineMedia.findMany({ where: { machineId: machine.id, active: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const version = createHash("sha256").update(media.map(item => [item.id, item.sha256, item.durationSeconds, item.sortOrder, item.updatedAt.toISOString()].join(":" )).join("|")).digest("hex");
  return jsonOk({ enabled: media.length > 0, version, items: media.map(item => ({ id: item.id, title: item.title, mediaType: item.mediaType, mimeType: item.mimeType, fileSize: item.fileSize, sha256: item.sha256, durationSeconds: item.durationSeconds, downloadPath: `/api/machine-media/download/${code}/${item.id}` })) });
}
