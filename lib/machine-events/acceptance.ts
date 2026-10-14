import type { Prisma } from "@prisma/client";
import { lockCampaign, lockDepositItem, lockDepositSession, lockUser } from "../db-locks";
import { depositItemEarnKey } from "../ledger";
import { lockFundingAccountForOrganization } from "../reward-funding";
import {
  transitionSession,
  validateSensorSequence,
  type SensorSequencePayload,
} from "../machine-state";
import {
  computeRewardAmount,
  computeWeightBasedRewardAmount,
  resolveRewardRate,
  validateWeight,
} from "../reward";
import { creditReward } from "../reward-credit";
import {
  campaignSupportsMachine,
  decideReward,
  machineRewardMode,
  REVIEW_HOLD_RATIO,
  verifyMaterial,
  type MaterialVerificationPolicy,
} from "../reward-policy";
import { sessionEnd } from "../deposit-session-deadline";
import {
  SESSION_CLOSED_REASON,
  SESSION_TIMEOUT_REASON,
  UNKNOWN_WASTE_TYPE_REASON,
  isUnknownWasteTypeItem,
} from "./shared";

/** Largest rupiah value a ledger row can hold (PostgreSQL `integer`). */
const MAX_RUPIAH = 2_147_483_647;

/** Thrown when the compare-and-set loses under the item lock (a bug, not a business outcome): retried as transient. */
class DepositItemChangedError extends Error {
  constructor() {
    super("DEPOSIT_ITEM_CHANGED");
    this.name = "DepositItemChangedError";
  }
}

/**
 * ITEM_ACCEPTED_POINT: prices and pays one deposit item, at most once.
 *
 * Runs inside the machine-event transaction (lib/machine-events/ingest.ts).
 * Reads the immutable relations (DepositSession.userId, DepositItem.sessionId),
 * locks the reward recipient User -> DepositSession -> DepositItem, re-reads
 * everything the decision depends on, and lets the central policy decide
 * (lib/reward-policy.ts): the session's campaign mode (or the organization's
 * explicit mode without a campaign), the weight window, the material check
 * against the waste type's AI taxonomy under the machine's verification
 * policy, and anomalies. The decided amount is written by `creditReward`
 * keyed `deposit-item:<id>:earn`; COMPLIANCE_ONLY writes no money entry.
 *
 * An item that already has an acceptance event or left PENDING/REVIEW
 * (accepted, rejected, or decided by a reviewer) is never priced again.
 *
 * R03 (controller ruling C1): the machine stays the authority on the items in
 * its outbox, so an undecided item is decided here whatever its session's
 * status. But an acceptance point whose event `occurredAt` (machine clock)
 * lies after the session's end (its deadline, or the earlier finish/cancel/
 * timeout), or of an item reported after the session ended (SESSION_CLOSED),
 * was made when the machine's lease should already have ended: it becomes a
 * held REVIEW (acceptance event set, evidence frozen, EARN PENDING, never
 * AVAILABLE) with SESSION_CLOSED / SESSION_TIMEOUT as its reason, and a human
 * approves or rejects it under the post-acceptance review rule.
 */
export async function handleAcceptance(
  tx: Prisma.TransactionClient,
  machine: { id: string; organizationId: string; hasCompactor: boolean },
  sessionId: string,
  depositItemId: string,
  acceptanceEventId: string,
) {
  // Immutable relations first: they only say which rows to lock.
  const sessionRef = await tx.depositSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, campaignId: true },
  });
  const itemRef = await tx.depositItem.findUnique({ where: { id: depositItemId }, select: { sessionId: true } });
  if (!sessionRef || !itemRef || itemRef.sessionId !== sessionId) return;

  await lockUser(tx, sessionRef.userId);
  // B01: the earning commits against the session's funding reservation, so
  // the organization's account and the campaign are locked before the session.
  await lockFundingAccountForOrganization(tx, machine.organizationId);
  if (sessionRef.campaignId) await lockCampaign(tx, sessionRef.campaignId);
  await lockDepositSession(tx, sessionId);
  await lockDepositItem(tx, depositItemId);

  const session = await tx.depositSession.findUnique({
    where: { id: sessionId },
    include: { campaign: true },
  });
  const item = await tx.depositItem.findUnique({
    where: { id: depositItemId },
    include: { wasteType: true },
  });
  if (!session || !item || item.sessionId !== sessionId) return;
  if (session.userId !== sessionRef.userId || session.campaignId !== sessionRef.campaignId) {
    throw new DepositItemChangedError();
  }
  if (item.acceptanceEventId || (item.status !== "PENDING" && item.status !== "REVIEW")) return;

  const config = await tx.machine.findUnique({
    where: { id: machine.id },
    select: {
      materialVerification: true,
      sessionIdleTimeoutMinutes: true,
      organization: { select: { machineRewardMode: true } },
    },
  });

  // C1: acted after the session ended? Fails closed (late) when the event time
  // cannot be read.
  const acceptanceEvent = await tx.machineEvent.findUnique({
    where: { id: acceptanceEventId },
    select: { occurredAt: true },
  });
  const reportedAfterEnd = item.validationReasonCode === SESSION_CLOSED_REASON;
  const endedAt = sessionEnd(session, config?.sessionIdleTimeoutMinutes ?? 0);
  const late =
    reportedAfterEnd || !acceptanceEvent || acceptanceEvent.occurredAt.getTime() > endedAt.getTime();

  const campaign = session.campaign;
  const machineCampaign = campaign && campaignSupportsMachine(campaign) ? campaign : null;
  // Money paths fail closed: an unreadable configuration pays nothing and
  // demands AI confirmation (in practice the event row's foreign key
  // guarantees the machine exists).
  const mode = machineRewardMode({
    campaign,
    organizationMode: config?.organization.machineRewardMode ?? "COMPLIANCE_ONLY",
  });

  // Items created via the unknown-waste-type fallback (recognized by the
  // fallback type, not only by a reason a later event could overwrite) have
  // no real rate or weight window: they always stay in REVIEW with reward 0
  // until a reviewer reclassifies them (lib/deposit-review.ts requires a
  // wasteTypeId), whatever the fallback type's default reward or the weight.
  const unknownWasteType = isUnknownWasteTypeItem(item);

  const rate = unknownWasteType
    ? null
    : await resolveRewardRate(
        {
          organizationId: machine.organizationId,
          campaignId: machineCampaign?.id ?? null,
          wasteTypeId: item.wasteTypeId,
        },
        tx,
      );

  const weight = validateWeight(
    item.measuredWeightGrams,
    rate?.minWeightGrams ?? item.wasteType.minWeightGrams,
    rate?.maxWeightGrams ?? item.wasteType.maxWeightGrams,
  );
  const material = unknownWasteType
    ? null
    : verifyMaterial({
        policy: (config?.materialVerification ?? "AI_REQUIRED") as MaterialVerificationPolicy,
        acceptedLabels: item.wasteType.aiAcceptedLabels ?? [],
        aiLabel: item.aiDetectedType,
        aiConfidence: item.aiConfidence,
        barcodeValue: item.barcodeValue,
      });
  const sensorAnomaly = validateSensorSequence(
    item.sensorSequenceJson as SensorSequencePayload | null,
  );

  const multiplier = machineCampaign?.rewardMultiplier ?? 1;
  const points = rate?.pointsPerItem ?? item.wasteType.defaultRewardPerItem ?? 0;
  const unit = rate?.unit ?? item.wasteType.unit;
  const computed =
    unit === "KG"
      ? computeWeightBasedRewardAmount(points, item.measuredWeightGrams, multiplier)
      : computeRewardAmount(points, item.quantity, multiplier);
  const outOfRange = !unknownWasteType && (!Number.isSafeInteger(computed) || computed < 0 || computed > MAX_RUPIAH);
  const baseAmount = unknownWasteType || outOfRange ? 0 : computed;

  const hasAnomaly = Boolean(
    sensorAnomaly || item.externalFraudFlag || session.status === "REVIEW" || outOfRange || late,
  );
  const decision = decideReward({
    mode,
    baseAmount,
    // The fallback type's weight window is meaningless: the reviewer decides.
    weightValid: unknownWasteType || weight.valid,
    typeMatch: !unknownWasteType && (material?.typeMatch ?? false),
    hasAnomaly,
  });

  let reason = decision.reason;
  if (decision.status === "REJECTED") reason = weight.reasonCode ?? "WEIGHT_INVALID";
  else if (decision.status === "REVIEW") {
    reason = unknownWasteType
      ? UNKNOWN_WASTE_TYPE_REASON
      : late
        ? reportedAfterEnd
          ? SESSION_CLOSED_REASON
          : SESSION_TIMEOUT_REASON
        : sensorAnomaly ?? (outOfRange ? "REWARD_OUT_OF_RANGE" : hasAnomaly ? "ANOMALY_REVIEW" : material!.reason);
  }
  const complianceMultiplier =
    decision.status === "ACCEPTED" ? 1.0 : decision.status === "REVIEW" && !unknownWasteType ? REVIEW_HOLD_RATIO : 0.0;

  const { count } = await tx.depositItem.updateMany({
    where: { id: depositItemId, acceptanceEventId: null, status: { in: ["PENDING", "REVIEW"] } },
    data: {
      status: decision.status,
      validationReasonCode: reason,
      rewardRateId: rate?.id ?? null,
      baseRewardAmount: mode === "MONEY_REWARD" ? baseAmount : 0,
      complianceMultiplier,
      rewardAmount: decision.amount,
      acceptedAt: decision.status !== "REJECTED" ? new Date() : null,
      acceptanceEventId,
      compactionStatus: machine.hasCompactor ? "PENDING" : "NOT_REQUIRED",
    },
  });
  if (count !== 1) throw new DepositItemChangedError();

  if (decision.status !== "REJECTED") {
    // B01: a held review commits the approvable ceiling (the full base at
    // the admission rate), an accepted item its amount; COMPLIANCE_ONLY
    // commits nothing. The commit never reprices the item: the admission
    // ceiling bounds what a late or offline event can draw.
    const fundedBase = mode === "MONEY_REWARD" ? baseAmount : 0;
    await creditReward(tx, {
      businessKey: depositItemEarnKey(depositItemId),
      userId: session.userId,
      organizationId: machine.organizationId,
      campaignId: session.campaignId,
      amount: decision.amount,
      status: decision.ledgerStatus,
      reasonCode: reason,
      referenceType: "DepositItem",
      referenceId: depositItemId,
      depositItemId,
      sessionId: session.id,
      funding: {
        ceilingRupiah: decision.status === "REVIEW" ? fundedBase : decision.amount,
        reviewPending: decision.status === "REVIEW",
      },
    });
  }

  if (session.status === "PROCESSING_ITEM") {
    const nextStatus =
      decision.status === "REVIEW"
        ? transitionSession(session.status, "ANOMALY")
        : transitionSession(session.status, "ITEM_DONE");
    await tx.depositSession.update({
      where: { id: sessionId },
      data: {
        status: nextStatus,
        anomalyCount: decision.status === "REVIEW" ? { increment: 1 } : undefined,
      },
    });
  }
}

/**
 * ITEM_REJECTED: the machine returned an item (abnormal weight, blocked
 * actuation). Same gate and locks as the acceptance point (M04 fix round 1):
 * reads the immutable relations, locks the recipient User -> DepositSession ->
 * DepositItem, advances a PROCESSING_ITEM session, and rejects the item only
 * while it is undecided: PENDING or REVIEW, no acceptance point yet, and no
 * ledger row for it. An accepted, priced, held or reviewed item is never
 * flipped (its money and the reviewer's decision stay consistent); the event
 * itself is still recorded. `reason` is already machine-namespaced
 * (`machineReasonCode`), so it can never claim a reviewer's decision.
 */
export async function handleItemRejected(
  tx: Prisma.TransactionClient,
  input: { sessionId: string | null; depositItemId: string; reason: string },
) {
  const ref = await tx.depositItem.findUnique({
    where: { id: input.depositItemId },
    select: { sessionId: true, session: { select: { userId: true } } },
  });
  if (!ref) return;
  await lockUser(tx, ref.session.userId);
  await lockDepositSession(tx, ref.sessionId);
  await lockDepositItem(tx, input.depositItemId);

  if (input.sessionId) {
    const session = await tx.depositSession.findUnique({ where: { id: input.sessionId } });
    if (session?.status === "PROCESSING_ITEM") {
      await tx.depositSession.update({
        where: { id: session.id },
        data: { status: transitionSession(session.status, "ITEM_DONE") },
      });
    }
  }

  const item = await tx.depositItem.findUnique({
    where: { id: input.depositItemId },
    select: { status: true, acceptanceEventId: true },
  });
  if (!item || item.acceptanceEventId !== null || (item.status !== "PENDING" && item.status !== "REVIEW")) return;
  if ((await tx.rewardLedger.count({ where: { depositItemId: input.depositItemId } })) > 0) return;

  await tx.depositItem.updateMany({
    where: { id: input.depositItemId, status: { in: ["PENDING", "REVIEW"] }, acceptanceEventId: null },
    data: { status: "REJECTED", validationReasonCode: input.reason },
  });
}

/**
 * Machine evidence on one item (M04 fix round 2, finding A3).
 *
 * MEASUREMENT (WEIGHT_MEASURED, IMAGE_CLASSIFIED, BARCODE_READ) is what the
 * acceptance point and a review price from, so it is written only while the
 * item is undecided: PENDING or REVIEW and no acceptance point yet. After that
 * (accepted, held, rejected, or decided by a reviewer) the priced evidence is
 * fixed and later machine readings are ignored (the event row is still kept).
 *
 * COMPACTION (COMPACTION_STARTED / _COMPLETED) is a post-acceptance lifecycle
 * signal and never priced: it is written only to an item that passed the
 * acceptance point and was not rejected there, and only `compactionStatus`.
 *
 * Both take the acceptance lock order (recipient User -> DepositSession ->
 * DepositItem, learned from the immutable relations) and compare-and-set the
 * gate. Returns whether the item was written.
 */
export type ItemEvidence =
  | {
      kind: "MEASUREMENT";
      data: { measuredWeightGrams?: number; aiDetectedType?: string; aiConfidence?: number; barcodeValue?: string };
    }
  | { kind: "COMPACTION"; data: { compactionStatus: "PENDING" | "COMPACTED" } };

export async function recordItemEvidence(
  tx: Prisma.TransactionClient,
  depositItemId: string,
  evidence: ItemEvidence,
): Promise<boolean> {
  const ref = await tx.depositItem.findUnique({
    where: { id: depositItemId },
    select: { sessionId: true, session: { select: { userId: true } } },
  });
  if (!ref) return false;
  await lockUser(tx, ref.session.userId);
  await lockDepositSession(tx, ref.sessionId);
  await lockDepositItem(tx, depositItemId);

  const item = await tx.depositItem.findUnique({
    where: { id: depositItemId },
    select: { status: true, acceptanceEventId: true },
  });
  if (!item) return false;

  if (evidence.kind === "MEASUREMENT") {
    if (item.acceptanceEventId !== null || (item.status !== "PENDING" && item.status !== "REVIEW")) return false;
    const { count } = await tx.depositItem.updateMany({
      where: { id: depositItemId, acceptanceEventId: null, status: { in: ["PENDING", "REVIEW"] } },
      data: evidence.data,
    });
    return count === 1;
  }
  if (item.acceptanceEventId === null || item.status === "REJECTED") return false;
  const { count } = await tx.depositItem.updateMany({
    where: { id: depositItemId, acceptanceEventId: { not: null }, status: { not: "REJECTED" } },
    data: { compactionStatus: evidence.data.compactionStatus },
  });
  return count === 1;
}

