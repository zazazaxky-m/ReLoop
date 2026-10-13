import { createHash, randomBytes } from "node:crypto";
import { rm, stat } from "node:fs/promises";
import {
  Prisma,
  type DeletionRequest,
  type DeletionRequestStatus,
  type DeletionVerificationMethod,
  type ErasureStepName,
  type RedemptionStatus,
  type SessionStatus,
  type TripStatus,
} from "@prisma/client";
import { ERASED_EMAIL_DOMAIN } from "./account-email";
import { logAudit, logAuditInTransaction } from "./audit";
import { lockUser } from "./db-locks";
import { keyedFingerprint, userWhereEmail } from "./encryption";
import {
  describeErasure,
  type ErasureDescription,
  type ErasureObligations,
  type ErasureStatus,
} from "./erasure-copy";
import { getWalletBalance } from "./ledger";
import { ERASED_ACCOUNT_IDENTIFIER, ERASED_DESTINATION_DATA } from "./payout-destination";
import { prisma } from "./prisma";
import { HttpError } from "./rbac";
import { proofStorageRoot, resolveProofPath } from "./redemption-proof";
import { runWalletTransaction } from "./wallet-service";

/**
 * Account erasure (SEC-05): verified, atomic, resumable.
 *
 * A FULL DeletionRequest is the job. It runs only after the account owner
 * verified it (signed-in session, the one-time link mailed to the account, or
 * an operator — never from the public form alone) and is made of durable steps
 * (ErasureJobStep, unique per request + step):
 *
 *  1. ANONYMIZE_ACCOUNT — one ReadCommitted transaction in the global lock
 *     order (User -> PayoutAccount -> Redemption). It re-reads balances and
 *     open activity under the locks; if anything is still owed to the owner the
 *     request is held in PENDING_RECONCILIATION with nothing erased and the
 *     account fully usable. Otherwise it keeps the user ID (every FK on
 *     sessions, ledger, redemptions and trips stays valid), redacts the profile
 *     through the encryption extension, clears secrets and tokens, revokes
 *     sessions (tokenVersion), disables and blanks payout accounts, erases
 *     destination copies and operator free text on redemptions, detaches proof
 *     files and writes the DATA_ERASURE audit entry — all or nothing.
 *  2. DELETE_PROOF_FILES — after COMMIT, removes the owner's proof folders
 *     from private storage (idempotent; a failure leaves RETRYABLE_FAILED).
 *
 * COMPLETED is written only when every step has completedAt. Nothing here
 * sends mail or calls the network inside a transaction.
 */

type Tx = Prisma.TransactionClient;

export const ERASED_USER_NAME = "Pengguna dihapus";
/** Placeholder address of an erased account; its domain is never assignable (lib/account-email.ts). */
export const erasedEmailFor = (userId: string) => `erased-${userId}@${ERASED_EMAIL_DOMAIN}`;
/** Prefix of Redemption.providerReference after erasure: a keyed fingerprint, not the reference. */
export const ERASED_REFERENCE_PREFIX = "erased-ref:";

const REQUIRED_STEPS: readonly ErasureStepName[] = ["ANONYMIZE_ACCOUNT", "DELETE_PROOF_FILES"];
/** Verified and not finished: the job may (re)run these. */
const RUNNABLE: readonly DeletionRequestStatus[] = ["VERIFIED", "PROCESSING", "PENDING_RECONCILIATION", "RETRYABLE_FAILED"];
const OPEN_REDEMPTION: readonly RedemptionStatus[] = ["REQUESTED", "APPROVED", "PROCESSING"];
const OPEN_SESSION: readonly SessionStatus[] = ["RESERVED", "ACTIVE", "PROCESSING_ITEM", "REVIEW"];
const OPEN_TRIP: readonly TripStatus[] = ["PLANNED", "ACTIVE"];

const MINUTE_MS = 60_000;
/** A held request is re-checked by the periodic runner this often. */
export const RECONCILIATION_RECHECK_MS = 60 * MINUTE_MS;
const RETRY_BASE_MS = 5 * MINUTE_MS;
const RETRY_MAX_MS = 6 * 60 * MINUTE_MS;
/** Lifetime of the confirmation link mailed for a public request. */
export const DELETION_TOKEN_TTL_MS = 24 * 60 * MINUTE_MS;

export const ERASURE_ONLY_USERS = "Hanya pengguna biasa yang dapat menghapus data";
export const ERASURE_ALREADY_DONE = "Data akun ini sudah dihapus.";
export const DELETION_TOKEN_INVALID = "Tautan konfirmasi tidak valid atau sudah digunakan.";
export const DELETION_TOKEN_EXPIRED = "Tautan konfirmasi sudah kedaluwarsa. Ajukan permintaan penghapusan lagi.";
const REQUEST_NOT_FOUND = "Permintaan penghapusan tidak ditemukan";

export interface ErasureView extends ErasureDescription {
  requestId: string;
  status: ErasureStatus;
}

/** In-process test seams (never reachable over HTTP); production passes nothing. */
export interface ErasureJobHooks {
  /** Inside the anonymization transaction, right after the User lock. */
  afterLock?: (tx: Tx) => Promise<void>;
  /** Inside the anonymization transaction after every write, before COMMIT. */
  afterAnonymizeWrites?: (tx: Tx) => Promise<void>;
}

const stepKey = (requestId: string, step: ErasureStepName) => ({ requestId_step: { requestId, step } });
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function backoffMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1), RETRY_MAX_MS);
}

/** Error class or code only: step rows and logs never carry messages with data. */
function errorCode(error: unknown): string {
  if (error instanceof HttpError) return `HTTP_${error.status}`;
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z0-9_]{2,32}$/.test(code)) return code;
  if (error instanceof Error && /^\w{1,64}$/.test(error.name)) return error.name;
  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Obligations
// ---------------------------------------------------------------------------

/** Balances and activity that could still pay the owner. Call under lockUser. */
async function readObligations(tx: Tx, userId: string): Promise<ErasureObligations> {
  const balance = await getWalletBalance(userId, tx);
  const openRedemptions = await tx.redemption.count({ where: { userId, status: { in: [...OPEN_REDEMPTION] } } });
  const openSessions = await tx.depositSession.count({
    where: { userId, OR: [{ status: { in: [...OPEN_SESSION] } }, { items: { some: { status: "REVIEW" } } }] },
  });
  const openTrips = await tx.trip.count({ where: { userId, status: { in: [...OPEN_TRIP] } } });
  return {
    available: balance.available,
    pending: balance.pending,
    reserved: balance.reserved,
    openRedemptions,
    openSessions,
    openTrips,
  };
}

/**
 * Nothing is owed to the owner and nothing can still mint a reward. A negative
 * available balance (a debt) does not hold the erasure: the ledger keeps it.
 */
function obligationsSettled(o: ErasureObligations): boolean {
  return o.available <= 0 && o.pending === 0 && o.reserved === 0 &&
    o.openRedemptions === 0 && o.openSessions === 0 && o.openTrips === 0;
}

function parseObligations(value: Prisma.JsonValue | null): ErasureObligations | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const n = (key: string) => (typeof v[key] === "number" ? (v[key] as number) : 0);
  return {
    available: n("available"), pending: n("pending"), reserved: n("reserved"),
    openRedemptions: n("openRedemptions"), openSessions: n("openSessions"), openTrips: n("openTrips"),
  };
}

// ---------------------------------------------------------------------------
// Starting a verified request
// ---------------------------------------------------------------------------

/**
 * Creates the durable steps and decides PROCESSING vs PENDING_RECONCILIATION.
 * The caller holds lockUser(tx, userId).
 */
async function startInTransaction(tx: Tx, requestId: string, userId: string) {
  await tx.erasureJobStep.createMany({
    data: REQUIRED_STEPS.map((step) => ({ requestId, step })),
    skipDuplicates: true,
  });
  const obligations = await readObligations(tx, userId);
  const settled = obligationsSettled(obligations);
  const status = settled ? "PROCESSING" : "PENDING_RECONCILIATION";
  // Held: the periodic runner re-checks later (the job can also be re-run now).
  const nextAttemptAt = settled ? new Date() : new Date(Date.now() + RECONCILIATION_RECHECK_MS);
  await tx.erasureJobStep.updateMany({ where: { requestId, completedAt: null }, data: { nextAttemptAt } });
  await tx.deletionRequest.update({
    where: { id: requestId },
    data: { status, reconciliationJson: settled ? Prisma.DbNull : { ...obligations } },
  });
  return { status, obligations } as const;
}

/**
 * Marks a PENDING request verified by `method` and starts it. When the owner
 * already has a running or completed erasure, this request is closed as
 * REJECTED (duplicate) and the existing one is returned instead.
 */
async function verifyAndStart(
  tx: Tx,
  request: DeletionRequest,
  userId: string,
  method: DeletionVerificationMethod,
  operatorReference?: string,
): Promise<{ requestId: string; status: DeletionRequestStatus }> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role !== "USER") throw new HttpError(403, ERASURE_ONLY_USERS);
  const closeToken = { verificationTokenHash: null, verificationExpiresAt: null };

  // Only requests this job verified count: a pre-A04 row an operator marked
  // VERIFIED/COMPLETED by hand never ran here and must not stand in for it.
  const existing = await tx.deletionRequest.findFirst({
    where: {
      userId, scope: "FULL", id: { not: request.id }, verificationMethod: { not: null },
      status: { in: [...RUNNABLE, "COMPLETED"] },
    },
    orderBy: { createdAt: "asc" },
  });
  if (existing) {
    await tx.deletionRequest.update({
      where: { id: request.id },
      data: { ...closeToken, status: "REJECTED", processedAt: new Date() },
    });
    return { requestId: existing.id, status: existing.status };
  }

  await tx.deletionRequest.update({
    where: { id: request.id },
    data: { ...closeToken, status: "VERIFIED", verificationMethod: method, verifiedAt: new Date() },
  });
  const { status, obligations } = await startInTransaction(tx, request.id, userId);
  await logAuditInTransaction(tx, {
    actorId: method === "SESSION" ? userId : null,
    action: "DATA_ERASURE_VERIFIED",
    entityType: "DeletionRequest",
    entityId: request.id,
    metadata: { userId, verificationMethod: method, status, operatorReference, ...obligations },
  });
  return { requestId: request.id, status };
}

/**
 * The signed-in owner asks to erase their account (DELETE /api/user/data).
 * Idempotent: an open request is returned (a held one is re-checked). The
 * authenticated session is the owner verification.
 */
export async function requestErasure(
  userId: string,
): Promise<{ requestId: string; status: "PROCESSING" | "PENDING_RECONCILIATION" }> {
  return runWalletTransaction(async (tx) => {
    await lockUser(tx, userId);
    const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user) throw new HttpError(404, "Pengguna tidak ditemukan");
    if (user.role !== "USER") throw new HttpError(403, ERASURE_ONLY_USERS);

    const open = await tx.deletionRequest.findFirst({
      where: { userId, scope: "FULL", status: { in: [...RUNNABLE] }, verificationMethod: { not: null } },
      orderBy: { createdAt: "asc" },
    });
    if (open) {
      if (open.status !== "PENDING_RECONCILIATION") return { requestId: open.id, status: "PROCESSING" };
      const { status } = await startInTransaction(tx, open.id, userId);
      return { requestId: open.id, status };
    }
    if (await tx.deletionRequest.count({ where: { userId, scope: "FULL", status: "COMPLETED", verificationMethod: { not: null } } })) {
      throw new HttpError(409, ERASURE_ALREADY_DONE);
    }

    const created = await tx.deletionRequest.create({
      data: { userId, scope: "FULL", status: "PENDING" },
    });
    const started = await verifyAndStart(tx, created, userId, "SESSION");
    return {
      requestId: started.requestId,
      status: started.status === "PENDING_RECONCILIATION" ? "PENDING_RECONCILIATION" : "PROCESSING",
    };
  });
}

/**
 * Public form (no session): records a request and, when the email belongs to a
 * user account, a one-time confirmation token. Executes nothing. The caller
 * mails `verification.token` after this returns (outside any transaction).
 */
export async function createPublicDeletionRequest(input: {
  email: string;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ requestId: string; verification: { to: string; token: string } | null }> {
  const user = await prisma.user.findUnique({ where: userWhereEmail(input.email), select: { id: true, role: true } });
  const token = user?.role === "USER" ? randomBytes(32).toString("base64url") : null;
  const request = await prisma.deletionRequest.create({
    data: {
      email: input.email,
      userId: user?.id ?? null,
      scope: "FULL",
      reason: input.reason,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      status: "PENDING",
      verificationTokenHash: token ? hashToken(token) : null,
      verificationExpiresAt: token ? new Date(Date.now() + DELETION_TOKEN_TTL_MS) : null,
    },
  });
  // No email or IP in the immutable audit trail.
  await logAudit({
    actorId: null,
    action: "ACCOUNT_DELETION_REQUESTED",
    entityType: "DeletionRequest",
    entityId: request.id,
    metadata: { scope: "FULL", verificationSent: token !== null },
  });
  return { requestId: request.id, verification: token ? { to: input.email, token } : null };
}

/** The owner opened the mailed link: verifies the request and starts it (single use). */
export async function confirmDeletionRequest(
  rawToken: string,
): Promise<{ requestId: string; status: DeletionRequestStatus }> {
  const tokenHash = hashToken(rawToken);
  const head = await prisma.deletionRequest.findUnique({
    where: { verificationTokenHash: tokenHash },
    select: { id: true, userId: true },
  });
  if (!head?.userId) throw new HttpError(400, DELETION_TOKEN_INVALID);
  const userId = head.userId;

  return runWalletTransaction(async (tx) => {
    await lockUser(tx, userId);
    const request = await tx.deletionRequest.findUnique({ where: { id: head.id } });
    if (!request || request.verificationTokenHash !== tokenHash || request.userId !== userId || request.status !== "PENDING") {
      throw new HttpError(400, DELETION_TOKEN_INVALID);
    }
    if (!request.verificationExpiresAt || request.verificationExpiresAt.getTime() <= Date.now()) {
      throw new HttpError(400, DELETION_TOKEN_EXPIRED);
    }
    return verifyAndStart(tx, request, userId, "EMAIL_TOKEN");
  });
}

/**
 * Operator procedure for an owner who can neither sign in nor receive mail at
 * the account address (docs/privacy-erasure.md). `reference` is the support
 * ticket of the out-of-band identity check; it lands in the audit trail, so it
 * must not contain personal data (letters, digits, `-_./` and spaces only).
 */
export async function verifyDeletionRequestByOperator(
  requestId: string,
  options: { reference: string },
): Promise<{ requestId: string; status: DeletionRequestStatus }> {
  const reference = options.reference.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._/-]{2,79}$/.test(reference)) {
    throw new HttpError(422, "Referensi tiket verifikasi wajib diisi (3-80 karakter, tanpa email atau data pribadi)");
  }
  const head = await prisma.deletionRequest.findUnique({ where: { id: requestId }, select: { userId: true, scope: true } });
  if (!head?.userId || head.scope !== "FULL") throw new HttpError(404, REQUEST_NOT_FOUND);
  const userId = head.userId;

  return runWalletTransaction(async (tx) => {
    await lockUser(tx, userId);
    const request = await tx.deletionRequest.findUnique({ where: { id: requestId } });
    if (!request || request.userId !== userId) throw new HttpError(404, REQUEST_NOT_FOUND);
    if (request.status !== "PENDING") throw new HttpError(409, "Permintaan ini sudah diverifikasi atau ditutup");
    return verifyAndStart(tx, request, userId, "OPERATOR", reference);
  });
}

// ---------------------------------------------------------------------------
// Running the job
// ---------------------------------------------------------------------------

/** Keyed fingerprint kept in place of a transfer reference (matchable, not readable). */
export function erasedReference(reference: string): string {
  return `${ERASED_REFERENCE_PREFIX}${keyedFingerprint("erased-provider-reference", reference.trim()).slice(0, 16)}`;
}

type AnonymizeOutcome = "anonymized" | "already" | "held" | "skipped";

async function anonymizeAccount(
  tx: Tx,
  requestId: string,
  userId: string,
  hooks: ErasureJobHooks,
): Promise<AnonymizeOutcome> {
  await lockUser(tx, userId);
  await hooks.afterLock?.(tx);

  const request = await tx.deletionRequest.findUnique({ where: { id: requestId } });
  if (!request || request.userId !== userId || !request.verificationMethod || !RUNNABLE.includes(request.status)) {
    return "skipped";
  }
  const step = await tx.erasureJobStep.findUnique({ where: stepKey(requestId, "ANONYMIZE_ACCOUNT") });
  if (!step) return "skipped";
  if (step.completedAt) return "already";

  // Global lock order after User: PayoutAccount, then Redemption (each by id).
  // Every redemption transition and proof upload takes the User lock first, so
  // statuses cannot change under us; re-read everything after the locks.
  await tx.$queryRaw`SELECT id FROM "PayoutAccount" WHERE "userId" = ${userId} ORDER BY id FOR NO KEY UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Redemption" WHERE "userId" = ${userId} ORDER BY id FOR NO KEY UPDATE`;

  const obligations = await readObligations(tx, userId);
  if (!obligationsSettled(obligations)) {
    await tx.erasureJobStep.updateMany({
      where: { requestId, completedAt: null },
      data: { nextAttemptAt: new Date(Date.now() + RECONCILIATION_RECHECK_MS) },
    });
    await tx.deletionRequest.update({
      where: { id: requestId },
      data: { status: "PENDING_RECONCILIATION", reconciliationJson: { ...obligations } },
    });
    if (request.status !== "PENDING_RECONCILIATION") {
      await logAuditInTransaction(tx, {
        actorId: null,
        action: "DATA_ERASURE_HELD",
        entityType: "DeletionRequest",
        entityId: requestId,
        metadata: { userId, ...obligations },
      });
    }
    return "held";
  }

  // 1. Profile (through the encryption extension: name/email ciphertext, new
  //    emailLookup), secrets, and every live session via tokenVersion.
  await tx.user.update({ where: { id: userId }, data: {
    name: ERASED_USER_NAME, email: erasedEmailFor(userId), phone: null,
    passwordHash: null, totpSecret: null, mfaEnabled: false, status: "INACTIVE",
    tokenVersion: { increment: 1 },
  } });
  const resetTokens = await tx.passwordResetToken.deleteMany({ where: { userId } });
  const deviceTokens = await tx.deviceToken.deleteMany({ where: { userId } });
  const notifications = await tx.notification.deleteMany({ where: { userId } });

  // 2. Payout accounts: disabled (no new payout can use them) and blanked.
  //    Safe because every request is settled and carries its own snapshot.
  const payoutAccounts = await tx.payoutAccount.updateMany({
    where: { userId },
    data: { status: "DISABLED", accountIdentifier: ERASED_ACCOUNT_IDENTIFIER, accountName: null },
  });

  // 3. Redemptions keep owner, amount, status and timestamps; destination
  //    copies, operator free text and proof links go. The transfer reference
  //    becomes a keyed fingerprint so it can still be matched to a bank line.
  const redemptions = await tx.redemption.findMany({
    where: { userId },
    orderBy: { id: "asc" },
    select: {
      id: true, providerReference: true, manualTransferProofUrl: true, note: true, reconciliationNote: true,
      payoutDestinationIdentifier: true, payoutDestinationName: true,
    },
  });
  const counts = { redemptionDestinationsErased: 0, redemptionNotesErased: 0, providerReferencesFingerprinted: 0, proofsDetached: 0 };
  for (const row of redemptions) {
    const data: Prisma.RedemptionUpdateInput = {};
    if (row.payoutDestinationIdentifier !== null || row.payoutDestinationName !== null) {
      Object.assign(data, ERASED_DESTINATION_DATA);
      counts.redemptionDestinationsErased += 1;
    }
    if (row.note !== null || row.reconciliationNote !== null) {
      Object.assign(data, { note: null, reconciliationNote: null });
      counts.redemptionNotesErased += 1;
    }
    if (row.providerReference && !row.providerReference.startsWith(ERASED_REFERENCE_PREFIX)) {
      data.providerReference = erasedReference(row.providerReference);
      counts.providerReferencesFingerprinted += 1;
    }
    if (row.manualTransferProofUrl !== null) {
      data.manualTransferProofUrl = null;
      counts.proofsDetached += 1;
    }
    if (Object.keys(data).length > 0) await tx.redemption.update({ where: { id: row.id }, data });
  }

  // 4. Network data on consent records and the owner's deletion requests.
  const consents = await tx.consentRecord.updateMany({
    where: { userId, OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }] },
    data: { ipAddress: null, userAgent: null },
  });
  const deletionRequests = await tx.deletionRequest.updateMany({
    where: { userId },
    data: { email: null, ipAddress: null, userAgent: null, reason: null },
  });

  // 5. Job bookkeeping: hand the proof folders to the post-commit step.
  const now = new Date();
  await tx.erasureJobStep.update({
    where: stepKey(requestId, "DELETE_PROOF_FILES"),
    data: {
      payloadJson: { redemptionIds: redemptions.map((row) => row.id), proofsDetached: counts.proofsDetached },
      nextAttemptAt: now,
    },
  });
  await tx.erasureJobStep.update({
    where: { id: step.id },
    data: { completedAt: now, attempts: { increment: 1 }, lastError: null },
  });
  await tx.deletionRequest.update({
    where: { id: requestId },
    data: { status: "PROCESSING", reconciliationJson: Prisma.DbNull },
  });

  // 6. Audit last (it holds the chain lock until COMMIT); no old identity in it.
  await logAuditInTransaction(tx, {
    actorId: null,
    action: "DATA_ERASURE",
    entityType: "User",
    entityId: userId,
    metadata: {
      requestId,
      verificationMethod: request.verificationMethod,
      profileRedacted: true,
      sessionsRevoked: true,
      passwordResetTokensDeleted: resetTokens.count,
      deviceTokensDeleted: deviceTokens.count,
      notificationsDeleted: notifications.count,
      payoutAccountsDisabled: payoutAccounts.count,
      ...counts,
      consentNetworkDataErased: consents.count,
      deletionRequestsRedacted: deletionRequests.count,
      openRedemptions: obligations.openRedemptions,
      retained: ["DepositSession", "DepositItem", "RewardLedger", "Redemption", "Trip", "MachineCapture", "AuditLog"],
    },
  });
  await hooks.afterAnonymizeWrites?.(tx);
  return "anonymized";
}

/** Records a failed attempt durably (outside the rolled-back transaction). */
async function recordFailure(requestId: string, step: ErasureStepName, error: unknown) {
  const code = errorCode(error);
  await prisma.$transaction(async (tx) => {
    const row = await tx.erasureJobStep.update({
      where: stepKey(requestId, step),
      data: { attempts: { increment: 1 }, lastError: code },
    });
    await tx.erasureJobStep.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(Date.now() + backoffMs(row.attempts)) },
    });
    // A held request stays held: its resolution steps are still what the owner sees.
    await tx.deletionRequest.updateMany({
      where: { id: requestId, status: { in: ["VERIFIED", "PROCESSING", "RETRYABLE_FAILED"] } },
      data: { status: "RETRYABLE_FAILED" },
    });
  });
  console.error(`[erasure] request ${requestId} step ${step} failed (${code}); will retry`);
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

function proofPayload(payload: Prisma.JsonValue | null) {
  const value = (payload ?? {}) as { redemptionIds?: unknown; proofsDetached?: unknown };
  const ids = Array.isArray(value.redemptionIds) ? value.redemptionIds : [];
  return {
    folders: ids.filter((id): id is string => typeof id === "string" && SAFE_ID.test(id)),
    proofsDetached: typeof value.proofsDetached === "number" ? value.proofsDetached : 0,
  };
}

class ProofStorageMissing extends Error {
  readonly code = "PROOF_STORAGE_MISSING";
}

async function deleteProofFiles(requestId: string): Promise<void> {
  const step = await prisma.erasureJobStep.findUnique({ where: stepKey(requestId, "DELETE_PROOF_FILES") });
  if (!step || step.completedAt) return;
  const { folders, proofsDetached } = proofPayload(step.payloadJson);
  try {
    const storageMounted = await stat(proofStorageRoot).then((info) => info.isDirectory(), () => false);
    if (!storageMounted && proofsDetached > 0) {
      // Proofs exist somewhere: a runner without the storage volume must not
      // report them deleted ("rm -f" of a missing path would succeed).
      throw new ProofStorageMissing("proof storage is not mounted on this host");
    }
    for (const redemptionId of storageMounted ? folders : []) {
      // Whole folder: replaced uploads may have left older files next to the attached one.
      await rm(resolveProofPath(redemptionId), { recursive: true, force: true });
    }
  } catch (error) {
    await recordFailure(requestId, "DELETE_PROOF_FILES", error);
    return;
  }
  await prisma.erasureJobStep.updateMany({
    where: { id: step.id, completedAt: null },
    data: { completedAt: new Date(), attempts: { increment: 1 }, lastError: null },
  });
}

/** COMPLETED only when every required step is complete (exactly one writer wins). */
async function completeIfDone(requestId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const steps = await tx.erasureJobStep.findMany({ where: { requestId } });
    const done = REQUIRED_STEPS.every((name) => steps.some((s) => s.step === name && s.completedAt));
    if (!done) return;
    const updated = await tx.deletionRequest.updateMany({
      where: { id: requestId, status: { in: [...RUNNABLE] } },
      data: { status: "COMPLETED", processedAt: new Date(), reconciliationJson: Prisma.DbNull },
    });
    if (updated.count === 1) {
      await logAuditInTransaction(tx, {
        actorId: null,
        action: "DATA_ERASURE_COMPLETED",
        entityType: "DeletionRequest",
        entityId: requestId,
        metadata: { steps: [...REQUIRED_STEPS] },
      });
    }
  });
}

/**
 * Runs (or resumes) one verified FULL request as far as it can go. Safe to
 * call repeatedly and concurrently: finished steps are skipped, an
 * unverified/finished request is a no-op, a held request is only re-checked.
 * Failures are recorded on the step (RETRYABLE_FAILED), never thrown for
 * expected faults.
 */
export async function runErasureJob(requestId: string, hooks: ErasureJobHooks = {}): Promise<void> {
  const head = await prisma.deletionRequest.findUnique({
    where: { id: requestId },
    select: { userId: true, scope: true, status: true, verificationMethod: true },
  });
  if (!head?.userId || head.scope !== "FULL" || !head.verificationMethod || !RUNNABLE.includes(head.status)) return;
  const userId = head.userId;

  const anonymize = await prisma.erasureJobStep.findUnique({ where: stepKey(requestId, "ANONYMIZE_ACCOUNT") });
  if (!anonymize) return;
  if (!anonymize.completedAt) {
    let outcome: AnonymizeOutcome;
    try {
      outcome = await runWalletTransaction((tx) => anonymizeAccount(tx, requestId, userId, hooks));
    } catch (error) {
      await recordFailure(requestId, "ANONYMIZE_ACCOUNT", error);
      return;
    }
    if (outcome === "held" || outcome === "skipped") return;
  }
  await deleteProofFiles(requestId);
  await completeIfDone(requestId);
}

// ---------------------------------------------------------------------------
// Status and the periodic runner
// ---------------------------------------------------------------------------

function viewOf(request: DeletionRequest & { steps: { step: ErasureStepName; completedAt: Date | null }[] }): ErasureView {
  const accountErased = request.steps.some((s) => s.step === "ANONYMIZE_ACCOUNT" && s.completedAt !== null);
  return {
    requestId: request.id,
    status: request.status,
    ...describeErasure({ status: request.status, accountErased, obligations: parseObligations(request.reconciliationJson) }),
  };
}

export async function getErasureStatus(requestId: string): Promise<ErasureView> {
  const request = await prisma.deletionRequest.findUnique({ where: { id: requestId }, include: { steps: true } });
  if (!request) throw new HttpError(404, REQUEST_NOT_FOUND);
  return viewOf(request);
}

/** The owner's most recent verified erasure, for status display (null if none). */
export async function latestErasureForUser(userId: string): Promise<ErasureView | null> {
  const request = await prisma.deletionRequest.findFirst({
    where: { userId, scope: "FULL", verificationMethod: { not: null }, status: { not: "REJECTED" } },
    orderBy: { createdAt: "desc" },
    include: { steps: true },
  });
  return request ? viewOf(request) : null;
}

export interface DueJobResult {
  requestId: string;
  status: DeletionRequestStatus;
  completed: boolean;
  error?: string;
}

/**
 * One pass of the runner (scripts/process-erasure-jobs.ts): every verified,
 * unfinished request whose next step is due at `now` — a held request after
 * its re-check interval, a failed step after its backoff — plus requests whose
 * steps all finished but whose status was not yet written.
 */
export async function processDueErasureJobs(
  options: { limit?: number; now?: Date } = {},
): Promise<DueJobResult[]> {
  const now = options.now ?? new Date();
  const anonymizeDue = { steps: { some: { step: "ANONYMIZE_ACCOUNT" as const, completedAt: null, nextAttemptAt: { lte: now } } } };
  const anonymized = { steps: { some: { step: "ANONYMIZE_ACCOUNT" as const, completedAt: { not: null } } } };
  const anyStepDue = { steps: { some: { completedAt: null, nextAttemptAt: { lte: now } } } };
  const allStepsDone = { steps: { some: {}, every: { completedAt: { not: null } } } };
  const due = await prisma.deletionRequest.findMany({
    where: {
      scope: "FULL",
      userId: { not: null },
      verificationMethod: { not: null },
      status: { in: [...RUNNABLE] },
      OR: [anonymizeDue, { AND: [anonymized, anyStepDue] }, allStepsDone],
    },
    orderBy: { createdAt: "asc" },
    take: options.limit ?? 50,
    select: { id: true },
  });

  const results: DueJobResult[] = [];
  for (const { id } of due) {
    try {
      await runErasureJob(id);
      const view = await getErasureStatus(id);
      results.push({ requestId: id, status: view.status, completed: view.completed });
    } catch (error) {
      results.push({ requestId: id, status: "RETRYABLE_FAILED", completed: false, error: errorCode(error) });
    }
  }
  return results;
}
