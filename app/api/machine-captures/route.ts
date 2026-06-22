import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { jsonError, jsonOk, handleApiError } from "@/lib/api";
import { verifyMachineSignature } from "@/lib/machine-auth";
import {
  captureStorageRoot,
  jsonValue,
} from "@/lib/machine-captures";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_SCENE_BYTES = 8 * 1024 * 1024;
const MAX_FACE_BYTES = 3 * 1024 * 1024;

const schema = z.object({
  machineCode: z.string().min(1),
  localCaptureId: z.string().uuid(),
  kind: z.string().min(1).max(40),
  reason: z.string().min(1).max(100),
  sessionId: z.string().optional().nullable(),
  occurredAt: z.string().datetime(),
  metadata: z.record(z.unknown()).optional(),
  sceneBase64: z.string().min(4),
  facesBase64: z.array(z.string().min(4)).max(5).default([]),
});

function decodeJpeg(value: string, maxBytes: number) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("Encoding gambar tidak valid");
  }
  const bytes = Buffer.from(value, "base64");
  if (
    bytes.length === 0 ||
    bytes.length > maxBytes ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff
  ) {
    throw new Error("Bukti kamera harus berupa JPEG yang valid");
  }
  return bytes;
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    const parsed = schema.parse(JSON.parse(raw));
    const machine = await prisma.machine.findUnique({
      where: { machineCode: parsed.machineCode },
      select: { id: true, ingestSecret: true },
    });
    if (!machine) return jsonError(404, "Mesin tidak ditemukan");

    const verdict = verifyMachineSignature({
      secret: machine.ingestSecret,
      timestamp: req.headers.get("x-reloop-timestamp"),
      nonce: req.headers.get("x-reloop-nonce"),
      signature: req.headers.get("x-reloop-signature"),
      rawBody: raw,
    });
    if (!verdict.ok) {
      return jsonError(401, `Tanda tangan tidak valid (${verdict.reason})`);
    }
    if (req.headers.get("x-reloop-machine") !== parsed.machineCode) {
      return jsonError(401, "Header mesin tidak cocok");
    }

    const duplicate = await prisma.machineCapture.findUnique({
      where: {
        machineId_localCaptureId: {
          machineId: machine.id,
          localCaptureId: parsed.localCaptureId,
        },
      },
      select: { id: true },
    });
    if (duplicate) return jsonOk({ id: duplicate.id, duplicate: true });

    let sessionId = parsed.sessionId ?? null;
    if (sessionId) {
      const session = await prisma.depositSession.findFirst({
        where: { id: sessionId, machineId: machine.id },
        select: { id: true },
      });
      if (!session) sessionId = null;
    }

    const scene = decodeJpeg(parsed.sceneBase64, MAX_SCENE_BYTES);
    const faces = parsed.facesBase64.map((value) =>
      decodeJpeg(value, MAX_FACE_BYTES),
    );
    const occurredAt = new Date(parsed.occurredAt);
    const relativeDir = path.join(
      machine.id,
      occurredAt.toISOString().slice(0, 10),
      parsed.localCaptureId,
    );
    const absoluteDir = path.join(captureStorageRoot, relativeDir);
    await mkdir(absoluteDir, { recursive: true });

    const sceneName = `${randomUUID()}-scene.jpg`;
    const scenePath = path.join(relativeDir, sceneName);
    await writeFile(path.join(absoluteDir, sceneName), scene);

    const facePaths: string[] = [];
    for (const [index, bytes] of faces.entries()) {
      const name = `${randomUUID()}-face-${index + 1}.jpg`;
      await writeFile(path.join(absoluteDir, name), bytes);
      facePaths.push(path.join(relativeDir, name));
    }

    const capture = await prisma.machineCapture.create({
      data: {
        machineId: machine.id,
        sessionId,
        localCaptureId: parsed.localCaptureId,
        kind: parsed.kind,
        reason: parsed.reason,
        scenePath,
        facePathsJson: facePaths,
        metadataJson: jsonValue(parsed.metadata),
        faceCount: facePaths.length,
        personDetected:
          parsed.metadata?.personDetected === true || facePaths.length > 0,
        occurredAt,
      },
      select: { id: true },
    });

    return jsonOk({ id: capture.id, duplicate: false }, 201);
  } catch (error) {
    if (
      error instanceof SyntaxError ||
      (error instanceof Error &&
        ["Encoding gambar tidak valid", "Bukti kamera harus berupa JPEG yang valid"].includes(
          error.message,
        ))
    ) {
      return jsonError(422, error.message);
    }
    return handleApiError(error);
  }
}
