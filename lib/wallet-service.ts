import { createHash } from "node:crypto";
import { Prisma, type Redemption } from "@prisma/client";
import { z } from "zod";
import { logAudit } from "./audit";
import { getMinRedemption } from "./config";
import { lockUser } from "./db-locks";
import { createRedeemReserve, getWalletBalance } from "./ledger";
import { prisma } from "./prisma";
import { HttpError, type CurrentUser } from "./rbac";

/**
 * Wallet transaction boundary. Request (M01) and, later, transition (M02) of a
 * redemption run here: one ReadCommitted transaction that locks the user row
 * first (lib/db-locks.ts), re-reads everything the decision depends on through
 * the same TransactionClient, and writes the request plus its ledger reserve.
 * Audit and other side effects run only after COMMIT.
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

async function runWalletTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
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
async function afterCommitSafely(label: string, effect: () => Promise<unknown>) {
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
              select: { id: true, userId: true, status: true, provider: true },
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
