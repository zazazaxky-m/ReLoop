import { prisma } from "./prisma";
import { logAudit } from "./audit";

export const CONSENT_TYPES = [
  "marketing_emails",
  "analytics_tracking",
  "third_party_sharing",
  "profiling",
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];

const EXPORT_BATCH_SIZE = 200;

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
      totpSecret: null,
      mfaEnabled: false,
    },
  });
  steps.push("profile_redacted");

  await prisma.depositSession.updateMany({
    where: { userId },
    data: { userId: "[REDACTED]" as never },
  });
  steps.push("sessions_anonymized");

  await prisma.payoutAccount.deleteMany({ where: { userId } });
  steps.push("payout_accounts_deleted");

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

async function paginatedFindMany<T>(
  fetchPage: (skip: number, take: number) => Promise<T[]>,
): Promise<T[]> {
  const rows: T[] = [];
  let skip = 0;

  while (true) {
    const batch = await fetchPage(skip, EXPORT_BATCH_SIZE);
    rows.push(...batch);
    if (batch.length < EXPORT_BATCH_SIZE) break;
    skip += batch.length;
  }

  return rows;
}

/** Loads export data in bounded batches (for tests and small exports). */
export async function exportUserData(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });

  const [sessions, ledger, consents, redemptions] = await Promise.all([
    paginatedFindMany((skip, take) =>
      prisma.depositSession.findMany({
        where: { userId },
        include: {
          items: true,
          machine: { select: { machineCode: true, name: true } },
        },
        orderBy: { startedAt: "desc" },
        skip,
        take,
      }),
    ),
    paginatedFindMany((skip, take) =>
      prisma.rewardLedger.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ),
    paginatedFindMany((skip, take) =>
      prisma.consentRecord.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ),
    paginatedFindMany((skip, take) =>
      prisma.redemption.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
    ),
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

async function writeJsonArrayStream<T>(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  label: string,
  fetchPage: (skip: number, take: number) => Promise<T[]>,
) {
  controller.enqueue(encoder.encode(`"${label}":[`));
  let first = true;
  let skip = 0;

  while (true) {
    const batch = await fetchPage(skip, EXPORT_BATCH_SIZE);
    for (const item of batch) {
      if (!first) controller.enqueue(encoder.encode(","));
      controller.enqueue(encoder.encode(JSON.stringify(item)));
      first = false;
    }
    if (batch.length < EXPORT_BATCH_SIZE) break;
    skip += batch.length;
  }

  controller.enqueue(encoder.encode("],"));
}

/** Streams a JSON export without loading the full payload into memory. */
export function createUserDataExportStream(userId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const profile = user
          ? {
              id: user.id,
              name: user.name,
              email: user.email,
              phone: user.phone,
              role: user.role,
              createdAt: user.createdAt,
            }
          : null;

        controller.enqueue(encoder.encode("{"));
        controller.enqueue(
          encoder.encode(
            `"exportDate":${JSON.stringify(new Date().toISOString())},"profile":${JSON.stringify(profile)},`,
          ),
        );

        await writeJsonArrayStream(controller, encoder, "depositSessions", (skip, take) =>
          prisma.depositSession.findMany({
            where: { userId },
            include: {
              items: true,
              machine: { select: { machineCode: true, name: true } },
            },
            orderBy: { startedAt: "desc" },
            skip,
            take,
          }),
        );

        await writeJsonArrayStream(controller, encoder, "ledger", (skip, take) =>
          prisma.rewardLedger.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            skip,
            take,
          }),
        );

        await writeJsonArrayStream(controller, encoder, "consents", (skip, take) =>
          prisma.consentRecord.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            skip,
            take,
          }),
        );

        controller.enqueue(encoder.encode('"redemptions":['));
        let first = true;
        let skip = 0;
        while (true) {
          const batch = await prisma.redemption.findMany({
            where: { userId },
            orderBy: { createdAt: "desc" },
            skip,
            take: EXPORT_BATCH_SIZE,
          });
          for (const item of batch) {
            if (!first) controller.enqueue(encoder.encode(","));
            controller.enqueue(encoder.encode(JSON.stringify(item)));
            first = false;
          }
          if (batch.length < EXPORT_BATCH_SIZE) break;
          skip += batch.length;
        }
        controller.enqueue(encoder.encode("]}"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
