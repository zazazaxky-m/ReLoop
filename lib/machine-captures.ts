import path from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export const captureStorageRoot = path.resolve(
  process.env.CAPTURE_STORAGE_DIR ??
    path.join(process.cwd(), "data", "private", "machine-captures"),
);

export function resolveCapturePath(relativePath: string) {
  const resolved = path.resolve(captureStorageRoot, relativePath);
  if (
    resolved !== captureStorageRoot &&
    !resolved.startsWith(`${captureStorageRoot}${path.sep}`)
  ) {
    throw new Error("Path bukti kamera tidak valid");
  }
  return resolved;
}

export type MachineCaptureRow = {
  id: string;
  kind: string;
  reason: string;
  faceCount: number;
  personDetected: boolean;
  occurredAt: Date;
  receivedAt: Date;
  sessionId: string | null;
  metadata: Record<string, unknown> | null;
};

export async function getMachineCaptures(
  machineId: string,
  take = 24,
): Promise<MachineCaptureRow[]> {
  const rows = await prisma.machineCapture.findMany({
    where: { machineId },
    orderBy: { occurredAt: "desc" },
    take,
  });
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    reason: row.reason,
    faceCount: row.faceCount,
    personDetected: row.personDetected,
    occurredAt: row.occurredAt,
    receivedAt: row.receivedAt,
    sessionId: row.sessionId,
    metadata: (row.metadataJson ?? null) as Record<string, unknown> | null,
  }));
}

export function jsonValue(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | undefined {
  return value ? (value as Prisma.InputJsonValue) : undefined;
}
