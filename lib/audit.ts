import { createHash } from "node:crypto";
import { prisma } from "./prisma";

const INSECURE_DEFAULT = "audit-secret-change-me";
/** Stable advisory lock id for serializing audit chain writes. */
const AUDIT_CHAIN_LOCK = 867_5309n;

const SENSITIVE_METADATA_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "token",
  "secret",
  "ingestsecret",
  "accountidentifier",
  "totpsecret",
  "qrcode",
]);

/** Strips sensitive keys from audit metadata before persistence. */
export function redactAuditMetadata(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SENSITIVE_METADATA_KEYS.has(key.toLowerCase())) {
      redacted[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      redacted[key] = redactAuditMetadata(value as Record<string, unknown>) ?? "[REDACTED]";
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

/** Mirrors lib/auth.ts's getJwtSecret(): fail loudly in production instead
 * of silently signing the tamper-evident chain with a known default. */
function getAuditSecret(): string {
  const secret = process.env.AUDIT_CHECKSUM_SECRET;
  if (!secret || secret === INSECURE_DEFAULT) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUDIT_CHECKSUM_SECRET must be set in production");
    }
    return INSECURE_DEFAULT;
  }
  return secret;
}

function checksumChain(previousHash: string | null, payload: string): string {
  return createHash("sha256")
    .update(`${previousHash ?? ""}${payload}${getAuditSecret()}`)
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
    const safeMetadata = redactAuditMetadata(input.metadata ?? undefined);
    const canonical = JSON.stringify({
      ts: new Date().toISOString(),
      actor: input.actorId,
      action: input.action,
      entity: `${input.entityType}:${input.entityId}`,
      meta: safeMetadata,
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`;

      const prev = await tx.auditLog.findFirst({
        orderBy: { createdAt: "desc" },
        select: { checksum: true },
      });

      await tx.auditLog.create({
        data: {
          actorId: input.actorId ?? null,
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId ?? null,
          metadataJson: (safeMetadata ?? undefined) as object | undefined,
          previousHash: prev?.checksum ?? null,
          checksum: checksumChain(prev?.checksum ?? null, canonical),
        },
      });
    });
  } catch (err) {
    console.error("[AUDIT] failed to write log", err);
  }
}

export async function verifyAuditChain(options?: {
  batchSize?: number;
}): Promise<{ valid: boolean; brokenAt?: string }> {
  const batchSize = options?.batchSize ?? 500;
  let prevHash: string | null = null;
  let skip = 0;

  while (true) {
    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "asc" },
      skip,
      take: batchSize,
    });
    if (!logs.length) break;

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

    skip += logs.length;
    if (logs.length < batchSize) break;
  }

  return { valid: true };
}
