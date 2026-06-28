import { prisma } from "./prisma";
import { logAudit } from "./audit";

export const CONSENT_TYPES = [
  "marketing_emails",
  "analytics_tracking",
  "third_party_sharing",
  "profiling",
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];

export async function recordConsent(params: {
  userId: string;
  consentType: ConsentType;
  granted: boolean;
  ipAddress?: string;
  userAgent?: string;
}) {
  await prisma.consentRecord.create({
    data: {
      userId: params.userId,
      consentType: params.consentType,
      granted: params.granted,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
    },
  });
  await logAudit({
    actorId: params.userId,
    action: params.granted ? "CONSENT_GIVEN" : "CONSENT_WITHDRAWN",
    entityType: "ConsentRecord",
    metadata: { consentType: params.consentType, granted: params.granted },
  });
}

export async function verifyConsent(
  userId: string,
  consentType: ConsentType,
): Promise<boolean> {
  const last = await prisma.consentRecord.findFirst({
    where: { userId, consentType },
    orderBy: { createdAt: "desc" },
  });
  return last?.granted ?? false;
}

export async function processErasureRequest(userId: string) {
  const erasureLog: Record<string, unknown> = {
    userId,
    requestedAt: new Date().toISOString(),
    steps: [] as string[],
  };
  const steps = erasureLog.steps as string[];

  // 1. Soft-delete user profile (keep minimal record for legal)
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  await prisma.user.update({
    where: { id: userId },
    data: {
      name: "[REDACTED]",
      email: `redacted-${userId}@reloop.id`,
      phone: null,
      passwordHash: null,
      status: "INACTIVE",
    },
  });
  steps.push("profile_redacted");

  // 2. Anonymize deposit sessions
  await prisma.depositSession.updateMany({
    where: { userId },
    data: { userId: "[REDACTED]" as any },
  });
  steps.push("sessions_anonymized");

  // 3. Delete payout accounts
  await prisma.payoutAccount.deleteMany({ where: { userId } });
  steps.push("payout_accounts_deleted");

  // 4. Anonymize ledger entries (keep financial records for tax)
  await prisma.rewardLedger.updateMany({
    where: { userId },
    data: { actorId: "[REDACTED]" },
  });
  steps.push("ledger_anonymized");

  await logAudit({
    actorId: userId,
    action: "DATA_ERASURE",
    entityType: "User",
    entityId: userId,
    metadata: erasureLog,
  });

  return erasureLog;
}

export async function exportUserData(userId: string) {
  const [user, sessions, ledger, consents, redemptions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.depositSession.findMany({
      where: { userId },
      include: { items: true, machine: { select: { machineCode: true, name: true } } },
    }),
    prisma.rewardLedger.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.consentRecord.findMany({ where: { userId }, orderBy: { createdAt: "desc" } }),
    prisma.redemption.findMany({ where: { userId } }),
  ]);

  return {
    exportDate: new Date().toISOString(),
    profile: user
      ? {
          id: user.id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          role: user.role,
          createdAt: user.createdAt,
        }
      : null,
    depositSessions: sessions,
    ledger,
    consents,
    redemptions,
  };
}
