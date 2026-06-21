import { readFile } from "node:fs/promises";
import { jsonError } from "@/lib/api";
import { resolveCapturePath } from "@/lib/machine-captures";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/rbac";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  {
    params,
  }: { params: Promise<{ id: string; asset: string }> },
) {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const { id, asset } = await params;
    const capture = await prisma.machineCapture.findUnique({
      where: { id },
      select: { scenePath: true, facePathsJson: true },
    });
    if (!capture) return jsonError(404, "Capture tidak ditemukan");

    const faces = Array.isArray(capture.facePathsJson)
      ? capture.facePathsJson.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    let relativePath: string | undefined;
    if (asset === "scene") {
      relativePath = capture.scenePath;
    } else {
      const match = /^face-(\d+)$/.exec(asset);
      const index = match ? Number(match[1]) - 1 : -1;
      relativePath = index >= 0 ? faces[index] : undefined;
    }
    if (!relativePath) return jsonError(404, "Aset capture tidak ditemukan");

    const bytes = await readFile(resolveCapturePath(relativePath));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return jsonError(404, "Aset capture tidak tersedia");
  }
}
