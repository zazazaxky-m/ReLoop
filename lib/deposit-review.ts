import type { LedgerEntryType, LedgerStatus, Prisma, RewardBudgetCommit, RewardLedger, RewardReconciliationCase } from "@prisma/client";
import { logAudit } from "./audit";
import { lockCampaign, lockDepositItem, lockDepositSession, lockMachine, lockUser } from "./db-locks";
import { depositItemEarnKey } from "./ledger";
import {
  REVIEW_ENDED_SESSION_REJECT_ONLY,
  REVIEW_LEGACY_CUTOVER_UNAVAILABLE,
  REVIEW_LEGACY_NOT_ELIGIBLE,
  REVIEW_LEGACY_ROW,
  REVIEW_LEGACY_SESSION_OPEN,
  REVIEW_LEGACY_SUPERADMIN_ONLY,
  REVIEW_LEGACY_VERSION_MISMATCH,
  REVIEW_LEGACY_VERSION_REQUIRED,
  REVIEW_NOT_ACCEPTED,
  REVIEW_NOT_LEGACY,
  isBeforeCutover,
  isLegacyReviewRow,
  isTerminalSession,
  legacyAcceptanceMarker,
} from "./deposit-review-contract";
import {
  REVIEW_APPROVED_REASON,
  REVIEW_REJECTED_REASON,
  isFallbackWasteType,
  isReviewFinal,
  isUnknownWasteTypeItem,
} from "./machine-events/shared";
import { prisma } from "./prisma";
import { HttpError, assertOrgScope, type CurrentUser } from "./rbac";
import {
  computeRewardAmount,
  computeWeightBasedRewardAmount,
  rateWindowContains,
  resolveRewardRateAt,
  validateWeight,
} from "./reward";
import { applyRewardEffect, type CreditEntryType } from "./reward-credit";
import { lockFundingAccountForOrganization, settleOrCommitReward } from "./reward-funding";
import { resolveLegacyCutover, type LegacyCutover } from "./reward-legacy-cutover";
import { campaignSupportsMachine, decideReward, machineRewardMode } from "./reward-policy";
import { afterCommitSafely, runWalletTransaction } from "./wallet-service";

/**
 * Deposit review decision (task M04, finding EX-01).
 *
 * One ReadCommitted wallet transaction (`runWalletTransaction`) that:
 *   1. reads the immutable relations (item -> session -> user/machine) and
 *      checks the organization scope;
 *   2. locks User -> Machine -> DepositSession -> DepositItem (lib/db-locks.ts)
 *      and re-reads the item and every ledger row of the item;
 *   3. compare-and-sets the item out of REVIEW (a lost CAS is 409);
 *   4. settles the money once: holds (EARN/PENDING) are released when the
 *      decision pays, otherwise rejected, and the single correction worth
 *      `target - every committed EARN/ADJUST/REVERSE` is written by
 *      lib/reward-credit.ts with business key `review:<itemId>:decision:v1`.
 *
 * The target comes from the central policy (lib/reward-policy.ts): a
 * COMPLIANCE_ONLY campaign (or organization without a campaign) and a
 * campaign that does not run at machines pay 0. A correction the recipient's
 * balance no longer covers (already paid out) or a credit to an erased
 * account is not forced: it becomes a reconciliation case.
 *
 * Repeating the same decision is idempotent (no write, `idempotent: true`);
 * the opposite decision, or the same action with different parameters, is 409.
 *
 * Humans approve only after the acceptance point (R1). A REVIEW item without
 * an acceptance event, or with one that recorded no acceptance time, is never
 * priced at approval time (lib/deposit-review-contract.ts `isLegacyReviewRow`).
 * While its session still runs the machine may still accept it (409 "wait").
 * Once the session ended the machine can still complete it from its outbox
 * (R03: a queued reading, acceptance or rejection still decides an undecided
 * item), but no reviewer approves it, with one fenced exception (fix rounds
 * 4 and 5): a row created before the M04 cutover (lib/reward-legacy-cutover.ts)
 * may be approved by a SUPERADMIN with `legacy: true` and the `itemVersion`
 * (`updatedAt`) the superadmin saw, compared under the item lock. That legacy
 * approval takes the same locks, weight check, settlement and business key,
 * is priced with the historical rate resolution at the item's recorded time
 * (`acceptedAt`, else `createdAt`), marks the item `legacy-approval:<actorId>`
 * when it had no acceptance event, and is audited with `legacyApproval: true`.
 * A later row of an ended session can only be rejected by a reviewer.
 */

export const REVIEW_DECIDED_DIFFERENTLY = "Item sudah ditinjau dengan keputusan lain";
const ITEM_CHANGED = "Item setoran berubah saat ditinjau. Muat ulang lalu ulangi.";
const REWARD_TOO_LARGE = "Nilai reward melebihi batas yang diizinkan";
export { REVIEW_NOT_ACCEPTED };
export const REVIEW_FALLBACK_TYPE =
  "Jenis sampah cadangan tidak dapat disetujui. Pilih jenis sampah yang sebenarnya.";
export const REVIEW_WEIGHT_MISSING =
  "Berat setoran tidak tercatat. Item tanpa berat tidak dapat disetujui; tolak item ini.";
export const REVIEW_WEIGHT_OUT_OF_RANGE =
  "Berat setoran di luar batas jenis sampah yang dipilih. Tolak item ini atau pilih jenis sampah yang sesuai.";

/** Largest rupiah value a ledger row can hold (PostgreSQL `integer`). */
const MAX_RUPIAH = 2_147_483_647;

/** Business key of the single money effect a review decision may write. */
export function reviewDecisionKey(depositItemId: string): string {
  return `review:${depositItemId}:decision:v1`;
}

export type ReviewAction = "approve" | "reject";

export interface ReviewInput {
  action: ReviewAction;
  wasteTypeId?: string;
  quantity?: number;
  note?: string;
  /** SUPERADMIN only: approve a pre-cutover legacy row of an ended session (see module header). */
  legacy?: boolean;
  /**
   * With `legacy`: the item version the superadmin saw, `DepositItem.updatedAt`
   * as ISO-8601. Required; the decision is refused (409) when the row changed
   * since, checked under the item lock.
   */
  itemVersion?: string;
}

/** Test seams injected by the caller's process (never reachable over HTTP). */
export interface ReviewHooks {
  /** Inside the transaction, right after every lock is held. */
  afterLock?: (tx: Prisma.TransactionClient) => Promise<void>;
}

type SettlementRow = Pick<RewardLedger, "id" | "entryType" | "status" | "amount">;

export interface ReviewSettlementPlan {
  /** EARN/PENDING holds that become AVAILABLE (the decision pays). */
  releaseIds: string[];
  /** EARN/PENDING holds that become REJECTED (the decision pays nothing). */
  rejectIds: string[];
  /** target - committed after the status changes above. */
  delta: number;
  entryType: CreditEntryType | null;
  reasonCode: string | null;
}

const CORRECTION_TYPES: ReadonlySet<LedgerEntryType> = new Set(["ADJUST", "REVERSE", "PENALTY"]);
const counts = (status: LedgerStatus) => status === "AVAILABLE";

/**
 * Pure settlement plan. "Committed" is every AVAILABLE EARN (after releasing
 * holds) plus every AVAILABLE ADJUST/REVERSE/PENALTY of the item; legacy
 * EARN/REVERSED duplicates and REJECTED rows never count. The correction is an
 * EARN only when the item has no EARN row at all (the unknown-type fallback),
 * so the one-EARN-per-item index is never violated.
 */
export function planReviewSettlement(input: {
  action: ReviewAction;
  targetAmount: number;
  rows: readonly SettlementRow[];
}): ReviewSettlementPlan {
  const earnRows = input.rows.filter((row) => row.entryType === "EARN");
  const holds = earnRows.filter((row) => row.status === "PENDING");
  const pays = input.action === "approve" && input.targetAmount > 0;
  const releaseIds = pays ? holds.map((row) => row.id) : [];
  const rejectIds = pays ? [] : holds.map((row) => row.id);
  const committed =
    earnRows
      .filter((row) => counts(row.status) || releaseIds.includes(row.id))
      .reduce((sum, row) => sum + row.amount, 0) +
    input.rows
      .filter((row) => CORRECTION_TYPES.has(row.entryType) && counts(row.status))
      .reduce((sum, row) => sum + row.amount, 0);
  const delta = input.targetAmount - committed;
  if (delta === 0) return { releaseIds, rejectIds, delta, entryType: null, reasonCode: null };
  if (input.action === "reject") {
    return { releaseIds, rejectIds, delta, entryType: delta < 0 ? "REVERSE" : "ADJUST", reasonCode: REVIEW_REJECTED_REASON };
  }
  if (delta > 0 && earnRows.length === 0) {
    return { releaseIds, rejectIds, delta, entryType: "EARN", reasonCode: REVIEW_APPROVED_REASON };
  }
  return { releaseIds, rejectIds, delta, entryType: "ADJUST", reasonCode: "REVIEW_ADJUSTMENT" };
}

const LOCKED_ITEM_INCLUDE = {
  wasteType: true,
  session: {
    include: {
      campaign: true,
      machine: { select: { id: true, organizationId: true, organization: { select: { machineRewardMode: true } } } },
    },
  },
} satisfies Prisma.DepositItemInclude;

type LockedItem = Prisma.DepositItemGetPayload<{ include: typeof LOCKED_ITEM_INCLUDE }>;

export interface ReviewResult {
  item: Omit<LockedItem, "wasteType" | "session">;
  idempotent: boolean;
  targetAmount: number;
  /** The ledger row this decision wrote (or wrote earlier, on a replay); null if none was needed or it was refused. */
  ledgerEntry: RewardLedger | null;
  /** Set when the correction was refused into a reconciliation case. */
  reconciliationCase: RewardReconciliationCase | null;
}

function stripRelations(item: LockedItem): ReviewResult["item"] {
  const { wasteType: _wasteType, session: _session, ...rest } = item;
  return rest;
}

/** Same action and parameters as the decision already recorded on the item. */
function sameDecision(item: LockedItem, input: ReviewInput): boolean {
  if (input.action === "reject") return item.status === "REJECTED" && item.validationReasonCode === REVIEW_REJECTED_REASON;
  return (
    item.status === "ACCEPTED" &&
    item.validationReasonCode === REVIEW_APPROVED_REASON &&
    (input.wasteTypeId === undefined || input.wasteTypeId === item.wasteTypeId) &&
    (input.quantity === undefined || input.quantity === item.quantity)
  );
}

/**
 * R2/N1/L3: the rate the acceptance point used, as of `at` (the acceptance
 * instant, or a legacy row's recorded time). Same waste type: the rate
 * recorded at acceptance (`rewardRateId`) only while its window
 * [effectiveFrom, effectiveTo) contains `at`, even if it has since been
 * deactivated or superseded. A recorded rate whose window does not contain
 * `at` (the EX-03 spread query recorded expired rates before M04) is ignored
 * and the rate in effect at `at` is resolved historically
 * (`resolveRewardRateAt`: window containment only, `active` ignored, the same
 * rule as the recorded rate, so a rate that covered `at` and was deactivated
 * and replaced later still prices the item as it was priced then). When the
 * acceptance point (the fixed query) recorded none, the type's own window and
 * default, exactly as acceptance priced it (a rate created later does not
 * apply retroactively). A legacy row without a recorded rate was usually
 * never priced at all (`legacyRow`), so it is always resolved at `at`. A
 * reclassified item (or a recorded rate that no longer exists): the rate in
 * effect for the new type at `at`.
 */
async function acceptanceRate(
  tx: Prisma.TransactionClient,
  item: LockedItem,
  scope: { organizationId: string; campaignId: string | null; wasteTypeId: string },
  at: Date,
  legacyRow: boolean,
) {
  if (scope.wasteTypeId === item.wasteTypeId) {
    if (item.rewardRateId === null) {
      if (!legacyRow) return null;
    } else {
      const recorded = await tx.rewardRate.findUnique({ where: { id: item.rewardRateId } });
      if (recorded && recorded.wasteTypeId === scope.wasteTypeId && rateWindowContains(recorded, at)) return recorded;
    }
  }
  return resolveRewardRateAt({ ...scope, at }, tx);
}

async function approvalTarget(
  tx: Prisma.TransactionClient,
  item: LockedItem,
  input: ReviewInput,
  pricedAt: Date,
  legacyRow: boolean,
) {
  const organizationId = item.session.machine.organizationId;
  if (isUnknownWasteTypeItem(item) && !input.wasteTypeId) {
    throw new HttpError(422, "wasteTypeId wajib diisi untuk item tanpa jenis sampah");
  }
  let wasteType = item.wasteType;
  if (input.wasteTypeId && input.wasteTypeId !== item.wasteTypeId) {
    const found = await tx.wasteType.findUnique({ where: { id: input.wasteTypeId } });
    // A replacement must be global or belong to the machine's organization.
    if (!found || (found.organizationId !== null && found.organizationId !== organizationId)) {
      throw new HttpError(422, "Jenis sampah pengganti tidak ditemukan");
    }
    wasteType = found;
  }
  // A1: the unknown-waste-type fallback is never a price source (its default
  // reward and rate are what C3 removed from the acceptance point).
  if (isFallbackWasteType(wasteType)) throw new HttpError(422, REVIEW_FALLBACK_TYPE);
  const quantity = input.quantity ?? item.quantity;
  const campaign = item.session.campaign;
  const machineCampaign = campaign && campaignSupportsMachine(campaign) ? campaign : null;
  const mode = machineRewardMode({ campaign, organizationMode: item.session.machine.organization.machineRewardMode });
  const rate = await acceptanceRate(
    tx,
    item,
    { organizationId, campaignId: machineCampaign?.id ?? null, wasteTypeId: wasteType.id },
    pricedAt,
    legacyRow,
  );
  // A2: the same weight check as the acceptance point, against the assigned
  // type's window (the acceptance rate's window over the type window). Rule:
  // every waste type is weighed, so a missing weight is never valid. The
  // evidence priced here is what the operator saw: an ordinary approval needs
  // the acceptance point, where machine evidence freezes (R1, A3), and a
  // legacy approval (pre-cutover row of an ended session) carries the item
  // version the superadmin saw and is refused when the row changed since (L1).
  const weight = validateWeight(
    item.measuredWeightGrams,
    rate?.minWeightGrams ?? wasteType.minWeightGrams,
    rate?.maxWeightGrams ?? wasteType.maxWeightGrams,
  );
  if (!weight.valid) {
    throw new HttpError(422, weight.reasonCode === "WEIGHT_MISSING" ? REVIEW_WEIGHT_MISSING : REVIEW_WEIGHT_OUT_OF_RANGE);
  }
  const points = rate?.pointsPerItem ?? wasteType.defaultRewardPerItem ?? 0;
  const multiplier = machineCampaign?.rewardMultiplier ?? 1;
  const unit = rate?.unit ?? wasteType.unit;
  const baseAmount =
    unit === "KG"
      ? computeWeightBasedRewardAmount(points, item.measuredWeightGrams, multiplier)
      : computeRewardAmount(points, quantity, multiplier);
  if (!Number.isSafeInteger(baseAmount) || baseAmount < 0 || baseAmount > MAX_RUPIAH) {
    throw new HttpError(422, REWARD_TOO_LARGE);
  }
  // A reviewer's approval settles material and anomaly questions; the weight
  // was verified above against the assigned type.
  const decision = decideReward({ mode, baseAmount, weightValid: weight.valid, typeMatch: true, hasAnomaly: false });
  return { wasteType, quantity, rate, baseAmount: mode === "MONEY_REWARD" ? baseAmount : 0, target: decision.amount };
}

type TransactionOutcome =
  | {
      kind: "replay";
      item: LockedItem;
      targetAmount: number;
      ledgerEntry: RewardLedger | null;
      reconciliationCase: RewardReconciliationCase | null;
    }
  | {
      kind: "decided";
      item: LockedItem;
      targetAmount: number;
      ledgerEntry: RewardLedger | null;
      reconciliationCase: RewardReconciliationCase | null;
      plan: ReviewSettlementPlan;
      /** B01: the funding obligation after this decision (null: legacy/compliance source). */
      fundingCommit: RewardBudgetCommit | null;
      previousReasonCode: string | null;
      wasteTypeId: string;
      /** Instant the approval price was resolved at (null for a reject). */
      pricedAt: Date | null;
      legacyApproval: boolean;
      /** The item version (`updatedAt`) a legacy approval was checked against. */
      itemVersion: Date | null;
      /** The cutover a legacy approval was fenced by. */
      legacyCutover: LegacyCutover | null;
      sessionStatus: string;
      measuredWeightGrams: number | null;
    };

/** `itemVersion` of a legacy request: the `updatedAt` the superadmin saw, as ISO-8601. */
function parseItemVersion(raw: string | undefined): Date {
  const at = raw ? new Date(raw) : null;
  if (!at || Number.isNaN(at.getTime())) throw new HttpError(422, REVIEW_LEGACY_VERSION_REQUIRED);
  return at;
}

export async function decideDepositReview(
  actor: CurrentUser,
  itemId: string,
  input: ReviewInput,
  hooks: ReviewHooks = {},
): Promise<ReviewResult> {
  // 1. Immutable relations: which rows to lock, and who may decide.
  const ref = await prisma.depositItem.findUnique({
    where: { id: itemId },
    select: {
      id: true,
      sessionId: true,
      session: { select: { userId: true, machineId: true, campaignId: true, machine: { select: { organizationId: true } } } },
    },
  });
  if (!ref) throw new HttpError(404, "Item setoran tidak ditemukan");
  assertOrgScope(actor, ref.session.machine.organizationId);
  // A legacy approval is an explicit, operator-only action: refused before any lock.
  if (input.legacy && actor.role !== "SUPERADMIN") throw new HttpError(403, REVIEW_LEGACY_SUPERADMIN_ONLY);
  // L1: it must name the item version the superadmin saw; compared under the item lock below.
  const itemVersion = input.legacy ? parseItemVersion(input.itemVersion) : null;

  const outcome = await runWalletTransaction(async (tx): Promise<TransactionOutcome> => {
    // 2. Global lock order, then re-read everything the decision depends on.
    await lockUser(tx, ref.session.userId);
    // B01: the decision settles the item's funding obligation (account and
    // campaign before Machine).
    await lockFundingAccountForOrganization(tx, ref.session.machine.organizationId);
    if (ref.session.campaignId) await lockCampaign(tx, ref.session.campaignId);
    await lockMachine(tx, ref.session.machineId);
    await lockDepositSession(tx, ref.sessionId);
    await lockDepositItem(tx, itemId);
    await hooks.afterLock?.(tx);

    const item = await tx.depositItem.findUnique({ where: { id: itemId }, include: LOCKED_ITEM_INCLUDE });
    if (
      !item ||
      item.sessionId !== ref.sessionId ||
      item.session.userId !== ref.session.userId ||
      item.session.machineId !== ref.session.machineId ||
      item.session.campaignId !== ref.session.campaignId
    ) {
      throw new HttpError(409, ITEM_CHANGED);
    }
    const businessKey = reviewDecisionKey(itemId);

    if (item.status !== "REVIEW") {
      if (!isReviewFinal(item)) {
        throw new HttpError(409, `Item sudah berstatus ${item.status}, tidak lagi menunggu peninjauan`);
      }
      if (!sameDecision(item, input)) throw new HttpError(409, REVIEW_DECIDED_DIFFERENTLY);
      return {
        kind: "replay",
        item,
        targetAmount: item.rewardAmount,
        ledgerEntry: await tx.rewardLedger.findUnique({ where: { businessKey } }),
        reconciliationCase: await tx.rewardReconciliationCase.findUnique({ where: { businessKey } }),
      };
    }

    // 3. Decide the item (compare-and-set on REVIEW).
    let targetAmount = 0;
    let data: Prisma.DepositItemUncheckedUpdateManyInput;
    let wasteTypeId = item.wasteTypeId;
    let pricedAt: Date | null = null;
    let legacyCutover: LegacyCutover | null = null;
    if (input.action === "approve") {
      // R1/N2/N4/L1: only an item that passed the acceptance point, with its
      // acceptance time, is approved by the ordinary path; evidence freezes at
      // exactly that point (recordItemEvidence). A legacy row (no acceptance
      // event, or one without a time) is never priced at approval time. While
      // the session runs the machine may still accept it: the reviewer waits
      // or rejects. Once the session ended the machine can still complete it
      // from its outbox, but no human approves it, except a SUPERADMIN legacy
      // approval of a row created before the M04 cutover that carries the
      // version the superadmin saw; every other such row is reject-only.
      const legacyRow = isLegacyReviewRow(item);
      const machineMayStillAccept = item.acceptanceEventId === null && !isTerminalSession(item.session.status);
      let beforeCutover = false;
      if (legacyRow && !machineMayStillAccept) {
        // Immutable configuration (migration history or an explicit setting),
        // read through the same client; the row itself was re-read under the locks.
        legacyCutover = await resolveLegacyCutover(tx);
        if (legacyCutover.at === null) console.warn(`[deposit-review] legacy cutover unavailable (${legacyCutover.source})`);
        beforeCutover = isBeforeCutover(item.createdAt, legacyCutover.at);
      }
      if (legacyRow && !input.legacy) {
        throw new HttpError(
          409,
          machineMayStillAccept ? REVIEW_NOT_ACCEPTED : beforeCutover ? REVIEW_LEGACY_ROW : REVIEW_ENDED_SESSION_REJECT_ONLY,
        );
      }
      if (!legacyRow && input.legacy) throw new HttpError(422, REVIEW_NOT_LEGACY);
      if (legacyRow && machineMayStillAccept) throw new HttpError(409, REVIEW_LEGACY_SESSION_OPEN);
      if (input.legacy) {
        if (!legacyCutover || legacyCutover.at === null) throw new HttpError(409, REVIEW_LEGACY_CUTOVER_UNAVAILABLE);
        if (!beforeCutover) throw new HttpError(409, REVIEW_LEGACY_NOT_ELIGIBLE);
        // The row the superadmin priced in their head is the row being approved.
        if (item.updatedAt.getTime() !== itemVersion!.getTime()) throw new HttpError(409, REVIEW_LEGACY_VERSION_MISMATCH);
      }
      // The instant the price is resolved at: the acceptance time, or a legacy
      // row's recorded time (never "now").
      pricedAt = item.acceptedAt ?? item.createdAt;
      const approval = await approvalTarget(tx, item, input, pricedAt, legacyRow);
      targetAmount = approval.target;
      wasteTypeId = approval.wasteType.id;
      data = {
        wasteTypeId,
        quantity: approval.quantity,
        status: "ACCEPTED",
        complianceMultiplier: 1.0,
        baseRewardAmount: approval.baseAmount,
        rewardAmount: targetAmount,
        rewardRateId: approval.rate?.id ?? null,
        validationReasonCode: REVIEW_APPROVED_REASON,
        externalFraudFlag: false,
        acceptedAt: pricedAt,
        // The marker only fills a missing acceptance event; a real event id is never overwritten.
        acceptanceEventId: item.acceptanceEventId ?? legacyAcceptanceMarker(actor.id),
      };
    } else {
      data = { status: "REJECTED", rewardAmount: 0, validationReasonCode: REVIEW_REJECTED_REASON };
    }
    const cas = await tx.depositItem.updateMany({ where: { id: itemId, status: "REVIEW" }, data });
    if (cas.count !== 1) throw new HttpError(409, REVIEW_DECIDED_DIFFERENTLY);

    // 4. Settle the money once.
    const rows = await tx.rewardLedger.findMany({
      where: { depositItemId: itemId },
      select: { id: true, entryType: true, status: true, amount: true, userId: true },
      orderBy: { id: "asc" },
    });
    if (rows.some((row) => row.userId !== item.session.userId)) throw new HttpError(409, ITEM_CHANGED);
    const plan = planReviewSettlement({ action: input.action, targetAmount, rows });
    for (const [ids, status] of [[plan.releaseIds, "AVAILABLE"], [plan.rejectIds, "REJECTED"]] as const) {
      for (const id of ids) {
        const changed = await tx.rewardLedger.updateMany({ where: { id, status: "PENDING" }, data: { status } });
        if (changed.count !== 1) throw new HttpError(409, ITEM_CHANGED);
      }
    }
    let ledgerEntry: RewardLedger | null = null;
    let reconciliationCase: RewardReconciliationCase | null = null;
    if (plan.entryType && plan.reasonCode) {
      const effect = await applyRewardEffect(tx, {
        businessKey,
        userId: item.session.userId,
        organizationId: item.session.machine.organizationId,
        campaignId: item.session.campaignId,
        amount: plan.delta,
        status: "AVAILABLE",
        entryType: plan.entryType,
        reasonCode: plan.reasonCode,
        referenceType: "DepositItem",
        referenceId: itemId,
        depositItemId: itemId,
        sessionId: item.sessionId,
        actorId: actor.id,
        funding: { settledByCaller: true },
      });
      ledgerEntry = effect.entry;
      reconciliationCase = effect.reconciliationCase;
    }
    // 5. B01: the review hold held the approvable ceiling; the decision
    // settles the obligation to the target (approve) or releases it (reject).
    // An item without a commit (admitted without money) is committed against
    // its session's reservation, late if need be, exactly like an acceptance.
    // A correction refused into a reconciliation case keeps the obligation:
    // the money is still out there until an operator settles the case.
    const fundingCommit = await settleOrCommitReward(tx, {
      businessKey: depositItemEarnKey(itemId),
      source: { sourceType: "SESSION", sourceId: item.sessionId },
      targetRupiah: reconciliationCase ? null : targetAmount,
      reviewPending: false,
    });

    const updated = await tx.depositItem.findUnique({ where: { id: itemId }, include: LOCKED_ITEM_INCLUDE });
    return {
      kind: "decided",
      item: updated ?? item,
      targetAmount,
      ledgerEntry,
      reconciliationCase,
      plan,
      fundingCommit,
      previousReasonCode: item.validationReasonCode,
      wasteTypeId,
      pricedAt,
      legacyApproval: input.action === "approve" && input.legacy === true,
      itemVersion: input.action === "approve" && input.legacy === true ? itemVersion : null,
      legacyCutover: input.action === "approve" && input.legacy === true ? legacyCutover : null,
      sessionStatus: item.session.status,
      measuredWeightGrams: item.measuredWeightGrams,
    };
  });

  if (outcome.kind === "decided") {
    const approved = input.action === "approve";
    await afterCommitSafely("audit DEPOSIT_REVIEW", () =>
      logAudit({
        actorId: actor.id,
        action: approved ? "DEPOSIT_REVIEW_APPROVED" : "DEPOSIT_REVIEW_REJECTED",
        entityType: "DepositItem",
        entityId: itemId,
        metadata: {
          note: input.note,
          previousReasonCode: outcome.previousReasonCode,
          ...(approved
            ? {
                wasteTypeId: outcome.wasteTypeId,
                quantity: outcome.item.quantity,
                // N2: a legacy approval is the audited record of who accepted a
                // row the machine never did, and of the inputs it was priced from.
                legacyApproval: outcome.legacyApproval,
                // ISO text: the audit redactor walks plain objects, and a Date would be stored as {}.
                pricedAt: outcome.pricedAt?.toISOString() ?? null,
                sessionStatus: outcome.sessionStatus,
                measuredWeightGrams: outcome.measuredWeightGrams,
                // L1: which row version a legacy approval was checked against, and the cutover that fenced it.
                ...(outcome.legacyApproval
                  ? {
                      itemVersion: outcome.itemVersion?.toISOString() ?? null,
                      legacyCutoverAt: outcome.legacyCutover?.at?.toISOString() ?? null,
                      legacyCutoverSource: outcome.legacyCutover?.source ?? null,
                    }
                  : {}),
              }
            : {}),
          rewardAmount: outcome.targetAmount,
          correction: outcome.plan.delta,
          releasedHolds: outcome.plan.releaseIds.length,
          rejectedHolds: outcome.plan.rejectIds.length,
          ledgerEntryId: outcome.ledgerEntry?.id ?? null,
          reconciliationCaseId: outcome.reconciliationCase?.id ?? null,
          // B01: the obligation held for this item after the decision.
          fundingHeldRupiah: outcome.fundingCommit?.heldRupiah ?? null,
        },
      }),
    );
  }

  return {
    item: stripRelations(outcome.item),
    idempotent: outcome.kind === "replay",
    targetAmount: outcome.targetAmount,
    ledgerEntry: outcome.ledgerEntry,
    reconciliationCase: outcome.reconciliationCase,
  };
}
