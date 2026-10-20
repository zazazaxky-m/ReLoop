import { prisma } from "./prisma";
import { logAudit } from "./audit";
import { describePayoutDestination, publicRedemption } from "./payout-destination";

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

// Account erasure lives in lib/erasure-jobs.ts (verified, atomic, resumable).

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

type ExportPage = (userId: string, skip: number, take: number) => Promise<unknown[]>;

/** Redemptions with the owner's own destination in plaintext; never ciphertext or the request hash. */
const exportRedemptions: ExportPage = async (userId, skip, take) => {
  const rows = await prisma.redemption.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip, take });
  const accountIds = [...new Set(rows.map((row) => row.payoutAccountId).filter((id): id is string => Boolean(id)))];
  const accounts = accountIds.length
    ? await prisma.payoutAccount.findMany({ where: { id: { in: accountIds }, userId } })
    : [];
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return rows.map((row) => ({
    ...publicRedemption(row),
    payoutDestination: describePayoutDestination(
      row,
      row.payoutAccountId ? (byId.get(row.payoutAccountId) ?? null) : null,
    ),
  }));
};

/**
 * Every section of an access export, in order. Both the in-memory export and
 * the streamed download use this list, so they always expose the same data.
 */
const EXPORT_SECTIONS = {
  depositSessions: (userId, skip, take) =>
    prisma.depositSession.findMany({
      where: { userId },
      include: { items: true, machine: { select: { machineCode: true, name: true } } },
      orderBy: { startedAt: "desc" },
      skip,
      take,
    }),
  ledger: (userId, skip, take) =>
    prisma.rewardLedger.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip, take }),
  consents: (userId, skip, take) =>
    prisma.consentRecord.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, skip, take }),
  redemptions: exportRedemptions,
  // Decrypted by the PayoutAccount extension: the owner's own account data.
  payoutAccounts: (userId, skip, take) =>
    prisma.payoutAccount.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: { id: true, provider: true, accountIdentifier: true, accountName: true, status: true,
        verifiedAt: true, createdAt: true, updatedAt: true },
    }),
  // Leader name/contact describe the trip leader, not necessarily the owner: not exported.
  trips: (userId, skip, take) =>
    prisma.trip.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: { id: true, campaignId: true, travelAgentName: true, groupName: true, participantCount: true,
        status: true, complianceStatus: true, complianceScore: true, checkInAt: true, checkOutAt: true, createdAt: true },
    }),
  notifications: (userId, skip, take) =>
    prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: { id: true, type: true, title: true, body: true, readAt: true, createdAt: true },
    }),
  deletionRequests: (userId, skip, take) =>
    prisma.deletionRequest.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: { id: true, scope: true, status: true, verificationMethod: true, createdAt: true, processedAt: true },
    }),
} satisfies Record<string, ExportPage>;

type ExportSection = keyof typeof EXPORT_SECTIONS;
const SECTION_NAMES = Object.keys(EXPORT_SECTIONS) as ExportSection[];

async function exportProfile(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user
    ? { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, createdAt: user.createdAt }
    : null;
}

export type UserDataExport = {
  exportDate: string;
  profile: Awaited<ReturnType<typeof exportProfile>>;
} & Record<ExportSection, unknown[]>;

/** Loads export data in bounded batches (for tests and small exports). */
export async function exportUserData(userId: string): Promise<UserDataExport> {
  const [profile, sections] = await Promise.all([
    exportProfile(userId),
    Promise.all(SECTION_NAMES.map((name) =>
      paginatedFindMany((skip, take) => EXPORT_SECTIONS[name](userId, skip, take)))),
  ]);
  return {
    exportDate: new Date().toISOString(),
    profile,
    ...(Object.fromEntries(SECTION_NAMES.map((name, index) => [name, sections[index]])) as Record<ExportSection, unknown[]>),
  };
}

async function writeJsonArrayStream(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  label: string,
  fetchPage: (skip: number, take: number) => Promise<unknown[]>,
) {
  controller.enqueue(encoder.encode(`,${JSON.stringify(label)}:[`));
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

  controller.enqueue(encoder.encode("]"));
}

/** Streams a JSON export without loading the full payload into memory. */
export function createUserDataExportStream(userId: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        const profile = await exportProfile(userId);
        controller.enqueue(
          encoder.encode(
            `{"exportDate":${JSON.stringify(new Date().toISOString())},"profile":${JSON.stringify(profile)}`,
          ),
        );
        for (const name of SECTION_NAMES) {
          await writeJsonArrayStream(controller, encoder, name, (skip, take) => EXPORT_SECTIONS[name](userId, skip, take));
        }
        controller.enqueue(encoder.encode("}"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}
