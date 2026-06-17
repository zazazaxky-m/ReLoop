import { prisma } from "./prisma";

export async function logAudit(input: {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadataJson: (input.metadata ?? undefined) as object | undefined,
      },
    });
  } catch (err) {
    // Audit logging must never break the main flow.
    console.error("[AUDIT] failed to write log", err);
  }
}
