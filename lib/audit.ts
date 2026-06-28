import { createHash } from "node:crypto";
import { prisma } from "./prisma";

const AUDIT_CHECKSUM_SECRET = process.env.AUDIT_CHECKSUM_SECRET ?? "audit-secret-change-me";

function checksumChain(previousHash: string | null, payload: string): string {
  return createHash("sha256")
    .update(`${previousHash ?? ""}${payload}${AUDIT_CHECKSUM_SECRET}`)
    .digest("hex");
}

export async function logAudit(input: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const canonical = JSON.stringify({
      ts: new Date().toISOString(),
      actor: input.actorId,
      action: input.action,
      entity: `${input.entityType}:${input.entityId}`,
      meta: input.metadata,
    });

    // Fetch previous entry's checksum for chain integrity
    const prev = await prisma.auditLog.findFirst({ orderBy: { createdAt: "desc" }, select: { checksum: true } });

    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadataJson: (input.metadata ?? undefined) as object | undefined,
        previousHash: prev?.checksum ?? null,
        checksum: checksumChain(prev?.checksum ?? null, canonical),
      },
    });
  } catch (err) {
    console.error("[AUDIT] failed to write log", err);
  }
}

export async function verifyAuditChain(): Promise<{ valid: boolean; brokenAt?: string }> {
  const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
  let prevHash: string | null = null;
  for (const entry of logs) {
    const canonical = JSON.stringify({
      ts: entry.createdAt.toISOString(),
      actor: entry.actorId,
      action: entry.action,
      entity: `${entry.entityType}:${entry.entityId}`,
      meta: entry.metadataJson,
    });
    const expected = checksumChain(prevHash, canonical);
    if (entry.checksum !== expected) {
      return { valid: false, brokenAt: entry.id };
    }
    prevHash = entry.checksum;
  }
  return { valid: true };
}
