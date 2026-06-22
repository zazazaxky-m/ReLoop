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
  const allMedia = await prisma.machineMedia.findMany({ where: { machineId: machine.id }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const activeMedia = allMedia.filter(item => item.active);
  const version = createHash("sha256").update(allMedia.map(item => [item.id, item.active, item.sha256, item.durationSeconds, item.sortOrder, item.updatedAt.toISOString()].join(":" )).join("|")).digest("hex");
  const mapMedia = (item: typeof allMedia[number]) => ({ id: item.id, title: item.title, mediaType: item.mediaType, mimeType: item.mimeType, fileSize: item.fileSize, sha256: item.sha256, durationSeconds: item.durationSeconds, downloadPath: `/api/machine-media/download/${code}/${item.id}` });
  return jsonOk({ enabled: activeMedia.length > 0, version, items: activeMedia.map(mapMedia), assets: allMedia.map(mapMedia) });
}
