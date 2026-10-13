import type { Prisma, RewardLedger, RewardReconciliationCase } from "@prisma/client";
import { lockUser } from "./db-locks";
import { getWalletBalance } from "./ledger";
import { HttpError } from "./rbac";

/**
 * The only writer of reward money effects (task M04): machine acceptance,
 * deposit review and trip return earnings all call it inside their own
 * transaction, after the reward policy (lib/reward-policy.ts) decided the
 * amount.
 *
 * Contract:
 * - Runs on the caller's TransactionClient and takes `lockUser` for the
 *   recipient (re-entrant: callers take it first, in the global lock order of
 *   lib/db-locks.ts, before any Machine/Trip/DepositSession/DepositItem lock).
 * - One row per `businessKey`: an identical retry returns the existing row, a
 *   different effect under the same key is a 409 (never a second payment).
 * - Amount 0 writes nothing.
 * - Never forces the ledger. A credit to an anonymized (erased, A04) account
 *   and a debit that the recipient's available balance no longer covers
 *   (the money was already paid out or reserved) are refused and recorded as
 *   an OPEN RewardReconciliationCase under the same business key, visible in
 *   the reconciliation report for an operator to resolve.
 * - Funding/budget enforcement is B01's (see `checkRewardFunding`).
 */

export type CreditEntryType = "EARN" | "ADJUST" | "REVERSE";

export interface CreditRewardInput {
  businessKey: string;
  userId: string;
  organizationId: string;
  campaignId: string | null;
  /** Signed integer rupiah. EARN >= 0, REVERSE <= 0, ADJUST either sign. */
  amount: number;
  status: "AVAILABLE" | "PENDING";
  reasonCode: string;
  referenceType: string;
  referenceId: string;
  /** Default EARN. Corrections from a review use ADJUST / REVERSE. */
  entryType?: CreditEntryType;
  depositItemId?: string | null;
  sessionId?: string | null;
  actorId?: string | null;
}

export type RewardEffectOutcome = "CREDITED" | "EXISTING" | "ZERO" | "CASE_OPENED";

export interface RewardEffectResult {
  outcome: RewardEffectOutcome;
  entry: RewardLedger | null;
  reconciliationCase: RewardReconciliationCase | null;
}

/** Reason codes of refused effects (RewardReconciliationCase.reasonCode). */
export const CASE_ALREADY_PAID_OUT = "ANOMALY_ALREADY_PAID_OUT";
export const CASE_RECIPIENT_ERASED = "RECIPIENT_ERASED";

export const REWARD_KEY_CONFLICT =
  "Efek reward dengan kunci ini sudah tercatat dengan nilai berbeda. Hubungi tim keuangan untuk rekonsiliasi.";

/** Largest rupiah value a ledger row can hold (PostgreSQL `integer`). */
const MAX_RUPIAH = 2_147_483_647;

function assertEffect(input: CreditRewardInput, entryType: CreditEntryType) {
  if (!input.businessKey || input.businessKey.length > 191) throw new RangeError("businessKey is required");
  const { amount } = input;
  if (!Number.isSafeInteger(amount) || Math.abs(amount) > MAX_RUPIAH) {
    throw new RangeError(`amount must be an integer rupiah value within the ledger range, got ${amount}`);
  }
  if (entryType === "EARN" && amount < 0) throw new RangeError("an EARN cannot be negative");
  if (entryType === "REVERSE" && amount > 0) throw new RangeError("a REVERSE cannot be positive");
}

// ---------------------------------------------------------------------------
// B01 extension point
// ---------------------------------------------------------------------------

/** Result of the funding check. There is no "ok" value until B01 enforces funding. */
export type FundingCheck = "NOT_ENFORCED_UNTIL_B01";

/**
 * B01 extension point: reward funding / budget capacity for one money effect.
 *
 * B01 enforces later. TODO(B01): commit positive effects against the
 * session/trip admission reservation (`commitRewardAgainstBudget`) and release
 * budget for negative ones (`releaseUnusedRewardBudget`), under
 * User -> RewardFundingAccount -> Campaign locks, refusing with 409 when the
 * funded capacity is exhausted.
 *
 * Until then this function checks NOTHING: credits are not capped by funding
 * or budget. It deliberately reports that instead of a success value, and the
 * money rollout stays held at gate Z01.
 */
export async function checkRewardFunding(
  _tx: Prisma.TransactionClient,
  _effect: Readonly<CreditRewardInput>,
): Promise<FundingCheck> {
  return "NOT_ENFORCED_UNTIL_B01";
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/**
 * An account the A04 erasure already anonymized: status INACTIVE and a
 * completed ANONYMIZE_ACCOUNT step. Call under `lockUser` (erasure takes the
 * same lock), so the answer cannot change before COMMIT.
 */
export async function isRecipientErased(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
  if (!user || user.status !== "INACTIVE") return false;
  const step = await tx.erasureJobStep.findFirst({
    where: { step: "ANONYMIZE_ACCOUNT", completedAt: { not: null }, request: { userId } },
    select: { id: true },
  });
  return step !== null;
}

export interface ReconciliationCaseInput {
  businessKey: string;
  userId: string;
  /** Positive rupiah at stake; `reasonCode` says whether it was a refused credit or debit. */
  amount: number;
  entryType: CreditEntryType;
  reasonCode: string;
  depositItemId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
}

/**
 * Opens (once per business key) a case for a money effect the system refused
 * to apply automatically. The caller holds `lockUser(tx, userId)`.
 */
export async function openRewardReconciliationCase(
  tx: Prisma.TransactionClient,
  input: ReconciliationCaseInput,
): Promise<RewardReconciliationCase> {
  const existing = await tx.rewardReconciliationCase.findUnique({ where: { businessKey: input.businessKey } });
  if (existing) return existing;
  console.warn("[reward-credit] reconciliation case opened", {
    businessKey: input.businessKey,
    reasonCode: input.reasonCode,
    amount: input.amount,
  });
  return tx.rewardReconciliationCase.create({
    data: {
      businessKey: input.businessKey,
      userId: input.userId,
      amount: Math.abs(input.amount),
      entryType: input.entryType,
      reasonCode: input.reasonCode,
      depositItemId: input.depositItemId ?? null,
      referenceType: input.referenceType ?? null,
      referenceId: input.referenceId ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/** Writes one keyed money effect and reports what happened (see module header). */
export async function applyRewardEffect(
  tx: Prisma.TransactionClient,
  input: CreditRewardInput,
): Promise<RewardEffectResult> {
  const entryType = input.entryType ?? "EARN";
  assertEffect(input, entryType);
  if (input.amount === 0) return { outcome: "ZERO", entry: null, reconciliationCase: null };

  await lockUser(tx, input.userId);

  const existing = await tx.rewardLedger.findUnique({ where: { businessKey: input.businessKey } });
  if (existing) {
    if (existing.userId === input.userId && existing.entryType === entryType && existing.amount === input.amount) {
      return { outcome: "EXISTING", entry: existing, reconciliationCase: null };
    }
    throw new HttpError(409, REWARD_KEY_CONFLICT);
  }
  const refused = await tx.rewardReconciliationCase.findUnique({ where: { businessKey: input.businessKey } });
  if (refused) return { outcome: "CASE_OPENED", entry: null, reconciliationCase: refused };

  const caseFor = (reasonCode: string) =>
    openRewardReconciliationCase(tx, {
      businessKey: input.businessKey,
      userId: input.userId,
      amount: input.amount,
      entryType,
      reasonCode,
      depositItemId: input.depositItemId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
    });

  if (await isRecipientErased(tx, input.userId)) {
    return { outcome: "CASE_OPENED", entry: null, reconciliationCase: await caseFor(CASE_RECIPIENT_ERASED) };
  }
  if (input.amount < 0 && input.status === "AVAILABLE") {
    const { available } = await getWalletBalance(input.userId, tx);
    if (available + input.amount < 0) {
      return { outcome: "CASE_OPENED", entry: null, reconciliationCase: await caseFor(CASE_ALREADY_PAID_OUT) };
    }
  }

  await checkRewardFunding(tx, input);

  const entry = await tx.rewardLedger.create({
    data: {
      userId: input.userId,
      organizationId: input.organizationId,
      campaignId: input.campaignId,
      sessionId: input.sessionId ?? null,
      depositItemId: input.depositItemId ?? null,
      entryType,
      amount: input.amount,
      status: input.status,
      reasonCode: input.reasonCode,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      actorId: input.actorId ?? null,
      businessKey: input.businessKey,
    },
  });
  return { outcome: "CREDITED", entry, reconciliationCase: null };
}

/**
 * Brief contract (M04): writes the effect under the caller's transaction and
 * returns the ledger row, or null when nothing was written (amount 0, or the
 * effect was refused into a reconciliation case; use `applyRewardEffect` to
 * tell them apart).
 */
export async function creditReward(
  tx: Prisma.TransactionClient,
  input: CreditRewardInput,
): Promise<RewardLedger | null> {
  return (await applyRewardEffect(tx, input)).entry;
}
