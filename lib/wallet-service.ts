import { createHash } from "node:crypto";
import { Prisma, type Redemption, type RedemptionStatus } from "@prisma/client";
import { z } from "zod";
import { logAudit } from "./audit";
import { getMinRedemption } from "./config";
import { lockRedemption, lockUser } from "./db-locks";
import {
  RESERVE_MISMATCH,
  createRedeemReserve,
  expectedReserveStatus,
  getWalletBalance,
  loadRedeemReserve,
  settleRedeemLedger,
  type RedeemOutcome,
} from "./ledger";
import { createNotification } from "./notifications";
import {
  ERASED_ACCOUNT_IDENTIFIER,
  SETTLED_REDEMPTION_STATUSES,
  destinationSnapshotData,
  unavailableDestinationData,
} from "./payout-destination";
import { prisma } from "./prisma";
import { HttpError, type CurrentUser } from "./rbac";

/**
 * Wallet transaction boundary. Request (M01) and transition (M02) of a
 * redemption run here: one ReadCommitted transaction that locks the user row
 * first (lib/db-locks.ts), re-reads everything the decision depends on through
 * the same TransactionClient, and writes the request status together with its
 * ledger reserve. Audit, notifications and any transfer run only after COMMIT.
 */

/** Largest rupiah value a ledger row can hold (PostgreSQL `integer`). */
export const MAX_RUPIAH = 2_147_483_647;

export const rupiahAmountSchema = z
  .number({ required_error: "Jumlah wajib diisi", invalid_type_error: "Jumlah harus berupa angka" })
  .int("Jumlah harus bilangan bulat rupiah")
  .positive("Jumlah harus lebih dari 0")
  .max(MAX_RUPIAH, "Jumlah melebihi batas yang diizinkan");

/** One logical request per key, scoped to the user; visible ASCII, 1-80 chars. */
export const idempotencyKeySchema = z
  .string({ invalid_type_error: "Kunci permintaan tidak valid" })
  .regex(/^[\x21-\x7e]{1,80}$/, "Kunci permintaan tidak valid");

/** HTTP body of POST /api/redemptions. Legacy clients may still omit the key. */
export const redemptionRequestSchema = z.object({
  amount: rupiahAmountSchema,
  payoutAccountId: z
    .string({ required_error: "Akun pencairan wajib dipilih", invalid_type_error: "Akun pencairan tidak valid" })
    .min(1, "Akun pencairan wajib dipilih")
    .max(191, "Akun pencairan tidak valid"),
  idempotencyKey: idempotencyKeySchema.optional(),
});

const requestRedemptionInputSchema = redemptionRequestSchema.required({ idempotencyKey: true });

export type RequestRedemptionInput = { amount: number; payoutAccountId: string; idempotencyKey: string };

/**
 * Test seams injected by the caller's process (never reachable over HTTP).
 * Production callers pass nothing.
 */
export interface WalletServiceHooks {
  /** Inside the transaction, once every lock a new request depends on is held. */
  afterLock?: (tx: Prisma.TransactionClient) => Promise<void>;
  /** After COMMIT and post-commit side effects, before the result is returned. */
  afterCommit?: () => Promise<void>;
}

export const REDEMPTION_KEY_CONFLICT =
  "Permintaan ini sudah pernah diajukan dengan jumlah atau akun berbeda. Muat ulang halaman lalu ajukan permintaan baru.";
const WALLET_BUSY = "Sistem sedang sibuk. Silakan coba lagi.";

const WALLET_TX_OPTIONS = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  // Many requests for one user queue on its row lock; give them room to wait
  // for a pooled connection and for the lock (bounded by lock_timeout).
  maxWait: 10_000,
  timeout: 15_000,
};

/** Canonical request body hash: same amount + destination => same hash. */
export function redemptionRequestHash(input: { amount: number; payoutAccountId: string }): string {
  const canonical = JSON.stringify({ v: 1, amount: input.amount, payoutAccountId: input.payoutAccountId });
  return createHash("sha256").update(canonical).digest("hex");
}

function assertSameRequest(existing: Redemption, input: RequestRedemptionInput, requestHash: string) {
  const same =
    existing.requestHash !== null
      ? existing.requestHash === requestHash
      : // Legacy row (before requestHash existed): compare the stored body.
        existing.amount === input.amount && existing.payoutAccountId === input.payoutAccountId;
  if (!same) throw new HttpError(409, REDEMPTION_KEY_CONFLICT);
}

function postgresCode(error: unknown): string | undefined {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const code = (error.meta as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

/** Lock wait/serialization contention: nothing was committed, the client may retry the same key. */
function isContention(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2028" || error.code === "P2034") return true;
  return ["55P03", "40P01", "40001"].includes(postgresCode(error) ?? "");
}

function isIdempotencyKeyConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  return Array.isArray(target) ? target.includes("idempotencyKey") : String(target ?? "").includes("idempotencyKey");
}

/**
 * ReadCommitted wallet transaction with `lock_timeout` 5s; lock contention is
 * answered with a retryable 503 (nothing was committed). Also used by the trip
 * check-out path (lib/trip-validation.ts), which writes trip return earnings.
 */
export async function runWalletTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      return fn(tx);
    }, WALLET_TX_OPTIONS);
  } catch (error) {
    if (isContention(error)) throw new HttpError(503, WALLET_BUSY);
    throw error;
  }
}

/** Post-commit side effects never turn a committed request into an error. */
export async function afterCommitSafely(label: string, effect: () => Promise<unknown>) {
  try {
    await effect();
  } catch (error) {
    console.error(`[wallet] ${label} failed after commit`, error instanceof Error ? error.message : error);
  }
}

/**
 * Reserves `amount` from the actor's available balance for a payout request.
 * Same key + same body returns the committed request (`idempotent: true`);
 * same key + different body is 409; keys of other users are invisible.
 */
export async function requestRedemption(
  actor: CurrentUser,
  rawInput: RequestRedemptionInput,
  hooks: WalletServiceHooks = {},
): Promise<{ redemption: Redemption; idempotent: boolean }> {
  if (actor.role !== "USER") throw new HttpError(403, "Akses ditolak untuk peran ini");
  // Fractions, negatives and out-of-range amounts are rejected before any DB access.
  const input = requestRedemptionInputSchema.parse(rawInput);
  const requestHash = redemptionRequestHash(input);
  const userId = actor.id;

  let outcome: { redemption: Redemption; idempotent: boolean };
  try {
    outcome = await runWalletTransaction(async (tx) => {
      await lockUser(tx, userId);

      const existing = await tx.redemption.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
      });
      if (existing) {
        assertSameRequest(existing, input, requestHash);
        return { redemption: existing, idempotent: true };
      }

      // Hold the destination row so its status cannot change under this decision,
      // then re-read ownership and status.
      const owned = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "PayoutAccount"
        WHERE id = ${input.payoutAccountId} AND "userId" = ${userId}
        FOR SHARE`;
      const account =
        owned.length === 1
          ? await tx.payoutAccount.findUnique({
              where: { id: input.payoutAccountId },
              select: { id: true, userId: true, status: true, provider: true, accountIdentifier: true, accountName: true },
            })
          : null;
      if (!account || account.userId !== userId) {
        throw new HttpError(404, "Akun pencairan tidak ditemukan");
      }
      if (account.status === "DISABLED") {
        throw new HttpError(409, "Akun pencairan dinonaktifkan");
      }

      await hooks.afterLock?.(tx);

      const minRedemption = await getMinRedemption(tx);
      if (input.amount < minRedemption) {
        throw new HttpError(422, `Minimum pencairan Rp${minRedemption.toLocaleString("id-ID")}`);
      }

      const balance = await getWalletBalance(userId, tx);
      if (balance.available < input.amount) {
        throw new HttpError(422, "Saldo tersedia tidak mencukupi");
      }

      const redemption = await tx.redemption.create({
        data: {
          userId,
          provider: account.provider,
          payoutAccountId: account.id,
          amount: input.amount,
          method: "MANUAL_TRANSFER",
          status: "REQUESTED",
          idempotencyKey: input.idempotencyKey,
          requestHash,
          // Immutable destination: later account edits never redirect this payout.
          ...destinationSnapshotData(account, "REQUEST_SNAPSHOT"),
        },
      });
      await createRedeemReserve(
        { userId, amount: input.amount, redemptionId: redemption.id, provider: account.provider },
        tx,
      );
      return { redemption, idempotent: false };
    });
  } catch (error) {
    // Backstop: a writer outside this service inserted the same (user, key).
    if (!isIdempotencyKeyConflict(error)) throw error;
    const existing = await prisma.redemption.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey: input.idempotencyKey } },
    });
    if (!existing) throw error;
    assertSameRequest(existing, input, requestHash);
    outcome = { redemption: existing, idempotent: true };
  }

  if (!outcome.idempotent) {
    const { redemption } = outcome;
    await afterCommitSafely("audit REDEMPTION_REQUEST", () =>
      logAudit({
        actorId: userId,
        action: "REDEMPTION_REQUEST",
        entityType: "Redemption",
        entityId: redemption.id,
        metadata: { amount: redemption.amount, provider: redemption.provider },
      }),
    );
  }
  await hooks.afterCommit?.();
  return outcome;
}

// ---------------------------------------------------------------------------
// Payout transitions (M02)
// ---------------------------------------------------------------------------

export type RedemptionAction = "approve" | "process" | "success" | "fail" | "cancel";

export interface TransitionRedemptionInput {
  action: RedemptionAction;
  note?: string;
  providerReference?: string;
}

const optionalText = (max: number, message: string) =>
  z
    .string({ invalid_type_error: message })
    .max(max, message)
    .optional()
    .transform((value) => value?.trim() || undefined);

const noteSchema = optionalText(500, "Catatan maksimal 500 karakter");
const providerReferenceSchema = optionalText(120, "Nomor referensi maksimal 120 karakter");

const transitionInputSchema = z.object({
  action: z.enum(["approve", "process", "success", "fail", "cancel"], {
    errorMap: () => ({ message: "Aksi pencairan tidak dikenal" }),
  }),
  note: noteSchema,
  providerReference: providerReferenceSchema,
});

/** HTTP body of PATCH /api/redemptions/[id]. */
export const redemptionPatchSchema = z.object({
  action: z.enum(["approve", "process", "success", "fail", "cancel", "flag_reconciliation"], {
    errorMap: () => ({ message: "Aksi pencairan tidak dikenal" }),
  }),
  note: noteSchema,
  providerReference: providerReferenceSchema,
});

const reconciliationNoteSchema = z
  .string({ required_error: "Catatan rekonsiliasi wajib diisi", invalid_type_error: "Catatan rekonsiliasi wajib diisi" })
  .trim()
  .min(1, "Catatan rekonsiliasi wajib diisi")
  .max(500, "Catatan maksimal 500 karakter");

interface TransitionRule {
  from: readonly RedemptionStatus[];
  to: RedemptionStatus;
  /** What happens to the reserve: kept PENDING, or settled with this outcome. */
  reserve: "hold" | RedeemOutcome;
  /** The operator is about to (or did) send money: the destination must be recorded. */
  destination: "required" | "record" | "none";
}

// success requires the full REQUESTED -> APPROVED -> PROCESSING chain so a
// payout can't be marked complete before it was approved and processed.
const TRANSITIONS: Record<RedemptionAction, TransitionRule> = {
  approve: { from: ["REQUESTED"], to: "APPROVED", reserve: "hold", destination: "none" },
  process: { from: ["APPROVED"], to: "PROCESSING", reserve: "hold", destination: "required" },
  success: { from: ["PROCESSING"], to: "SUCCESS", reserve: "success", destination: "record" },
  fail: { from: ["REQUESTED", "APPROVED", "PROCESSING"], to: "FAILED", reserve: "failed", destination: "none" },
  cancel: { from: ["REQUESTED"], to: "REVERSED", reserve: "failed", destination: "none" },
};

const TERMINAL_STATUSES: readonly RedemptionStatus[] = SETTLED_REDEMPTION_STATUSES;

const STATUS_MESSAGES: Partial<Record<RedemptionAction, string>> = {
  approve: "Pengajuan pencairan Anda telah disetujui dan akan segera diproses.",
  process: "Pencairan Anda sedang diproses oleh tim kami.",
  success: "Pencairan Anda berhasil, dana telah dikirim.",
  fail: "Pencairan Anda gagal. Silakan hubungi dukungan atau ajukan ulang.",
};

export const REDEMPTION_NOT_FOUND = "Pengajuan pencairan tidak ditemukan";
export const REDEMPTION_STATUS_CHANGED = "Status pencairan sudah berubah";
export const REDEMPTION_INVALID_TRANSITION = "Transisi status pencairan tidak valid";
export const REDEMPTION_OWNER_CHANGED = "Data pemilik pencairan berubah. Muat ulang lalu coba lagi.";
export const REDEMPTION_PROOF_REQUIRED =
  "Isi nomor referensi transfer atau unggah bukti transfer sebelum menandai sukses";
export const REDEMPTION_DESTINATION_UNAVAILABLE =
  "Tujuan pencairan tidak tersedia. Tandai gagal pengajuan ini atau hubungi pengguna.";
export const REDEMPTION_RECONCILIATION_NOTE_REQUIRED =
  "Pengajuan ini sedang direkonsiliasi. Isi catatan hasil pengecekan transfer sebelum menandai gagal.";
export const REDEMPTION_PROOF_CLOSED = "Pengajuan pencairan sudah selesai, bukti baru tidak dapat diunggah";
export const REDEMPTION_REPLAY_REFERENCE_CONFLICT =
  "Pencairan ini sudah dicatat dengan nomor referensi lain. Periksa kemungkinan transfer ganda sebelum melanjutkan.";
export const REDEMPTION_REPLAY_NOTE_CONFLICT =
  "Pencairan ini sudah dicatat dengan catatan berbeda. Muat ulang untuk melihat data terbaru.";
export const REDEMPTION_RECONCILIATION_NOTE_CONFLICT =
  "Pengajuan ini sudah ditandai untuk rekonsiliasi dengan catatan lain. Muat ulang untuk melihat catatan yang tersimpan.";

function assertMayTransition(actor: CurrentUser, action: RedemptionAction) {
  if (actor.role === "SUPERADMIN") return;
  // A user may only cancel their own still-pending request.
  if (actor.role === "USER" && action === "cancel") return;
  throw new HttpError(403, actor.role === "USER" ? "Aksi tidak diizinkan" : "Akses ditolak untuk peran ini");
}

/** Refusal for a status the action cannot start from. */
function notFrom(status: RedemptionStatus): HttpError {
  return new HttpError(409, TERMINAL_STATUSES.includes(status) ? REDEMPTION_STATUS_CHANGED : REDEMPTION_INVALID_TRANSITION);
}

/**
 * Locks one payout request in the global order and re-reads it:
 * immutable owner first (no lock), then User, then Redemption, then the row
 * through the same `tx`. A request whose owner changed meanwhile is refused.
 */
async function lockRedemptionForChange(
  tx: Prisma.TransactionClient,
  actor: CurrentUser,
  id: string,
  expectedUserId?: string,
): Promise<Redemption> {
  const owner = await tx.redemption.findUnique({ where: { id }, select: { userId: true } });
  if (!owner) throw new HttpError(404, REDEMPTION_NOT_FOUND);
  if (actor.role === "USER" && owner.userId !== actor.id) {
    throw new HttpError(403, "Bukan pengajuan pencairan Anda");
  }
  if (expectedUserId !== undefined && owner.userId !== expectedUserId) {
    throw new HttpError(409, REDEMPTION_OWNER_CHANGED);
  }

  await lockUser(tx, owner.userId);
  await lockRedemption(tx, id);

  const redemption = await tx.redemption.findUnique({ where: { id } });
  if (!redemption) throw new HttpError(404, REDEMPTION_NOT_FOUND);
  if (redemption.userId !== owner.userId) throw new HttpError(409, REDEMPTION_OWNER_CHANGED);
  return redemption;
}

/**
 * Destination columns to write with this change. A request that already has a
 * snapshot keeps it untouched. A legacy request (no snapshot) records the
 * owner's account as it is now, flagged LEGACY_ACCOUNT_FALLBACK; if that
 * account is gone, `required` refuses and otherwise LEGACY_UNAVAILABLE is
 * recorded without guessing any number.
 */
async function destinationForChange(
  tx: Prisma.TransactionClient,
  redemption: Redemption,
  mode: "required" | "record",
) {
  if (redemption.payoutDestinationSource) return {};
  const account = redemption.payoutAccountId
    ? await tx.payoutAccount.findFirst({
        where: { id: redemption.payoutAccountId, userId: redemption.userId },
        select: { provider: true, accountIdentifier: true, accountName: true },
      })
    : null;
  // An erased account (lib/erasure-jobs.ts) has no number left to record.
  if (account && account.accountIdentifier !== ERASED_ACCOUNT_IDENTIFIER) {
    return destinationSnapshotData(account, "LEGACY_ACCOUNT_FALLBACK");
  }
  if (mode === "required") throw new HttpError(409, REDEMPTION_DESTINATION_UNAVAILABLE);
  return unavailableDestinationData();
}

/**
 * A repeat of the outcome a request already has is a replay only when it
 * carries nothing new: a different transfer reference may mean a second
 * transfer happened, so it is refused instead of silently dropped.
 */
function assertIdenticalReplay(current: Redemption, input: { note?: string; providerReference?: string }) {
  if (input.providerReference !== undefined && input.providerReference !== current.providerReference) {
    throw new HttpError(409, REDEMPTION_REPLAY_REFERENCE_CONFLICT);
  }
  if (input.note !== undefined && input.note !== current.note) {
    throw new HttpError(409, REDEMPTION_REPLAY_NOTE_CONFLICT);
  }
}

/** A stored proof only counts for the request it was uploaded to. */
function hasOwnProof(redemption: Redemption): boolean {
  return Boolean(redemption.manualTransferProofUrl?.startsWith(`${redemption.id}/`));
}

/** Writes `data` only if the request is still in `status` (compare-and-set). */
async function compareAndSet(
  tx: Prisma.TransactionClient,
  id: string,
  where: Prisma.RedemptionWhereInput,
  data: Prisma.RedemptionUncheckedUpdateManyInput,
) {
  const changed = await tx.redemption.updateMany({ where: { id, ...where }, data });
  if (changed.count !== 1) throw new HttpError(409, REDEMPTION_STATUS_CHANGED);
}

interface TransitionOutcome {
  redemption: Redemption;
  idempotent: boolean;
  from: RedemptionStatus;
  /** This change closed an open reconciliation flag. */
  resolvedReconciliation: boolean;
}

/**
 * Moves a payout request through REQUESTED -> APPROVED -> PROCESSING ->
 * SUCCESS (or FAILED / REVERSED) and commits the request status together with
 * its reserve in one transaction under User -> Redemption locks.
 *
 * - The status change is a compare-and-set on the status read under the lock;
 *   the reserve change is conditional on PENDING (settleRedeemLedger).
 * - Repeating the outcome the request already has is idempotent (200,
 *   `idempotent: true`) only when the reserve already matches it and the
 *   repeat carries no different providerReference or note (else 409).
 * - Any other status, the opposite outcome, a missing/mismatching reserve or a
 *   changed owner is 409 and nothing is written.
 * - Audit and notification run after COMMIT and never undo or repeat it.
 */
export async function transitionRedemption(
  actor: CurrentUser,
  id: string,
  rawInput: TransitionRedemptionInput,
  hooks: WalletServiceHooks = {},
): Promise<{ redemption: Redemption; idempotent: boolean }> {
  const input = transitionInputSchema.parse(rawInput);
  assertMayTransition(actor, input.action);
  const rule = TRANSITIONS[input.action];

  const outcome = await runWalletTransaction<TransitionOutcome>(async (tx) => {
    const current = await lockRedemptionForChange(tx, actor, id);
    await hooks.afterLock?.(tx);
    const reserve = await loadRedeemReserve(tx, current);

    if (current.status === rule.to) {
      // Same outcome again: a replay, but only if the ledger already agrees.
      if (reserve.status !== expectedReserveStatus(current.status)) throw new HttpError(409, RESERVE_MISMATCH);
      assertIdenticalReplay(current, input);
      return { redemption: current, idempotent: true, from: current.status, resolvedReconciliation: false };
    }
    if (!rule.from.includes(current.status)) throw notFrom(current.status);
    if (reserve.status !== "PENDING") throw new HttpError(409, RESERVE_MISMATCH);

    if (input.action === "success" && !input.providerReference && !hasOwnProof(current)) {
      throw new HttpError(422, REDEMPTION_PROOF_REQUIRED);
    }
    if (input.action === "fail" && current.reconciliationRequired && !input.note) {
      throw new HttpError(422, REDEMPTION_RECONCILIATION_NOTE_REQUIRED);
    }
    const destination = rule.destination === "none" ? {} : await destinationForChange(tx, current, rule.destination);

    await compareAndSet(tx, id, { status: current.status }, {
      status: rule.to,
      ...destination,
      note: input.note,
      providerReference: input.providerReference,
      processedBySuperadminId: actor.role === "SUPERADMIN" ? actor.id : undefined,
      // A terminal outcome resolves an open reconciliation; its note stays as history.
      ...(TERMINAL_STATUSES.includes(rule.to) && current.reconciliationRequired
        ? { reconciliationRequired: false }
        : {}),
    });
    if (rule.reserve !== "hold") {
      const settled = await settleRedeemLedger(id, rule.reserve, tx);
      // The reserve was PENDING under our locks, so exactly one mutation must happen.
      if (!settled.changed) throw new HttpError(409, RESERVE_MISMATCH);
    }

    const redemption = await tx.redemption.findUnique({ where: { id } });
    if (!redemption) throw new HttpError(404, REDEMPTION_NOT_FOUND);
    return {
      redemption,
      idempotent: false,
      from: current.status,
      resolvedReconciliation: current.reconciliationRequired && !redemption.reconciliationRequired,
    };
  });

  if (!outcome.idempotent) {
    const { redemption, from, resolvedReconciliation } = outcome;
    await afterCommitSafely(`audit REDEMPTION_${input.action.toUpperCase()}`, () =>
      logAudit({
        actorId: actor.id,
        action: `REDEMPTION_${input.action.toUpperCase()}`,
        entityType: "Redemption",
        entityId: id,
        metadata: {
          from,
          to: redemption.status,
          // The note itself stays on the request (erasable); audit rows are
          // immutable, so free text that may hold account data never goes here.
          hasNote: input.note ? true : undefined,
          destinationSource: rule.destination === "none" ? undefined : redemption.payoutDestinationSource,
          reconciliationResolved: resolvedReconciliation || undefined,
        },
      }),
    );
    // The user's own cancel needs no self-notification.
    const message = STATUS_MESSAGES[input.action];
    if (actor.role === "SUPERADMIN" && message) {
      await afterCommitSafely("notification REDEMPTION_STATUS", () =>
        createNotification({
          userId: redemption.userId,
          type: "REDEMPTION_STATUS",
          title: "Status pencairan diperbarui",
          body: message,
          data: { redemptionId: id, status: redemption.status },
        }),
      );
    }
  }
  await hooks.afterCommit?.();
  return { redemption: outcome.redemption, idempotent: outcome.idempotent };
}

/**
 * The operator cannot confirm whether the manual transfer went out. The
 * request stays PROCESSING with its reserve held and is flagged for
 * reconciliation; it is never failed (which would hand the money back while it
 * may already have been paid). Repeating the flag with the same note is
 * idempotent; a different note is 409.
 */
export async function flagRedemptionForReconciliation(
  actor: CurrentUser,
  id: string,
  rawInput: { note: string },
  hooks: WalletServiceHooks = {},
): Promise<{ redemption: Redemption; idempotent: boolean }> {
  if (actor.role !== "SUPERADMIN") throw new HttpError(403, "Akses ditolak untuk peran ini");
  const note = reconciliationNoteSchema.parse(rawInput.note);

  const outcome = await runWalletTransaction(async (tx) => {
    const current = await lockRedemptionForChange(tx, actor, id);
    await hooks.afterLock?.(tx);
    const reserve = await loadRedeemReserve(tx, current);
    if (current.status !== "PROCESSING") throw notFrom(current.status);
    if (reserve.status !== "PENDING") throw new HttpError(409, RESERVE_MISMATCH);
    if (current.reconciliationRequired) {
      // Idempotent only for the same note; another note is not silently dropped.
      if (current.reconciliationNote !== note) throw new HttpError(409, REDEMPTION_RECONCILIATION_NOTE_CONFLICT);
      return { redemption: current, idempotent: true };
    }

    const destination = await destinationForChange(tx, current, "record");
    await compareAndSet(tx, id, { status: "PROCESSING", reconciliationRequired: false }, {
      ...destination,
      reconciliationRequired: true,
      reconciliationNote: note,
      reconciliationFlaggedAt: new Date(),
      processedBySuperadminId: actor.id,
    });
    const redemption = await tx.redemption.findUnique({ where: { id } });
    if (!redemption) throw new HttpError(404, REDEMPTION_NOT_FOUND);
    return { redemption, idempotent: false };
  });

  if (!outcome.idempotent) {
    await afterCommitSafely("audit REDEMPTION_FLAG_RECONCILIATION", () =>
      logAudit({
        actorId: actor.id,
        action: "REDEMPTION_FLAG_RECONCILIATION",
        entityType: "Redemption",
        entityId: id,
        metadata: { hasNote: true, destinationSource: outcome.redemption.payoutDestinationSource },
      }),
    );
  }
  await hooks.afterCommit?.();
  return outcome;
}

/**
 * Attaches an uploaded transfer proof (already stored under `<id>/`) to a
 * still-open request. Takes the same User -> Redemption locks as transitions
 * and refuses when the request now belongs to someone other than the owner
 * the operator uploaded for (`expectedUserId`) or has already finished.
 */
export async function attachRedemptionProof(
  actor: CurrentUser,
  id: string,
  input: { relativePath: string; expectedUserId: string; size: number; mime: string },
  hooks: WalletServiceHooks = {},
): Promise<{ redemption: Redemption }> {
  if (actor.role !== "SUPERADMIN") throw new HttpError(403, "Akses ditolak untuk peran ini");
  if (!input.relativePath.startsWith(`${id}/`)) throw new Error("proof path must live under the redemption id");

  const redemption = await runWalletTransaction(async (tx) => {
    const current = await lockRedemptionForChange(tx, actor, id, input.expectedUserId);
    await hooks.afterLock?.(tx);
    if (TERMINAL_STATUSES.includes(current.status)) throw new HttpError(409, REDEMPTION_PROOF_CLOSED);

    const destination = await destinationForChange(tx, current, "record");
    await compareAndSet(tx, id, { userId: input.expectedUserId, status: current.status }, {
      ...destination,
      manualTransferProofUrl: input.relativePath,
    });
    const updated = await tx.redemption.findUnique({ where: { id } });
    if (!updated) throw new HttpError(404, REDEMPTION_NOT_FOUND);
    return updated;
  });

  await afterCommitSafely("audit REDEMPTION_PROOF_UPLOAD", () =>
    logAudit({
      actorId: actor.id,
      action: "REDEMPTION_PROOF_UPLOAD",
      entityType: "Redemption",
      entityId: id,
      metadata: { size: input.size, mime: input.mime, destinationSource: redemption.payoutDestinationSource },
    }),
  );
  await hooks.afterCommit?.();
  return { redemption };
}
