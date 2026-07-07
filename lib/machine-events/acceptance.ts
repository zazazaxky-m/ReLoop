import type { Prisma } from "@prisma/client";
import { createEarnEntry } from "../ledger";
import {
  transitionSession,
  validateSensorSequence,
  type SensorSequencePayload,
} from "../machine-state";
import {
  computeRewardAmount,
  computeWeightBasedRewardAmount,
  evaluateSensorFusion,
  resolveRewardRate,
} from "../reward";
import { UNKNOWN_WASTE_TYPE_REASON } from "./shared";

export async function handleAcceptance(
  tx: Prisma.TransactionClient,
  machine: { id: string; organizationId: string; hasCompactor: boolean },
  sessionId: string,
  depositItemId: string,
  acceptanceEventId: string,
) {
  const session = await tx.depositSession.findUnique({
    where: { id: sessionId },
    include: { campaign: true },
  });
  const item = await tx.depositItem.findUnique({
    where: { id: depositItemId },
    include: { wasteType: true },
  });
  if (!session || !item) return;

  // Items created via the unknown-waste-type fallback have no real rate to
  // resolve against; keep them in review with zero reward until a reviewer
  // reclassifies the item (see app/api/deposit-reviews).
  const unknownWasteType = item.validationReasonCode === UNKNOWN_WASTE_TYPE_REASON;

  const rate = unknownWasteType
    ? null
    : await resolveRewardRate(
        {
          organizationId: machine.organizationId,
          campaignId: session.campaignId,
          wasteTypeId: item.wasteTypeId,
        },
        tx,
      );

  const minW = rate?.minWeightGrams ?? item.wasteType.minWeightGrams;
  const maxW = rate?.maxWeightGrams ?? item.wasteType.maxWeightGrams;

  const fusion = evaluateSensorFusion({
    wasteTypeId: item.wasteTypeId,
    aiDetectedType: item.aiDetectedType,
    aiConfidence: item.aiConfidence,
    barcodeValue: item.barcodeValue,
    measuredWeightGrams: item.measuredWeightGrams,
    minWeightGrams: minW,
    maxWeightGrams: maxW,
  });

  const sensorAnomaly = validateSensorSequence(
    item.sensorSequenceJson as SensorSequencePayload | null,
  );

  let status: "ACCEPTED" | "REVIEW" | "REJECTED" = "ACCEPTED";
  let reason = "ACCEPTED";
  let ledgerStatus: "AVAILABLE" | "PENDING" = "AVAILABLE";
  let complianceMultiplier = 1.0;

  if (unknownWasteType) {
    status = "REVIEW";
    reason = UNKNOWN_WASTE_TYPE_REASON;
    ledgerStatus = "PENDING";
    complianceMultiplier = 0.0;
  } else if (!fusion.valid) {
    status = "REJECTED";
    reason = fusion.reasonCode ?? "WEIGHT_INVALID";
    complianceMultiplier = 0.0;
  } else if (sensorAnomaly || item.externalFraudFlag || session.status === "REVIEW") {
    status = "REVIEW";
    reason = sensorAnomaly ?? "ANOMALY_REVIEW";
    ledgerStatus = "PENDING";
    complianceMultiplier = 0.5;
  }

  const multiplier = session.campaign?.rewardMultiplier ?? 1;
  const points = rate?.pointsPerItem ?? item.wasteType.defaultRewardPerItem ?? 0;
  const unit = rate?.unit ?? item.wasteType.unit;
  const baseRewardAmount =
    unit === "KG"
      ? computeWeightBasedRewardAmount(points, item.measuredWeightGrams, multiplier)
      : computeRewardAmount(points, item.quantity, multiplier);

  const rewardAmount =
    status === "ACCEPTED" || status === "REVIEW"
      ? Math.floor(baseRewardAmount * complianceMultiplier)
      : 0;

  await tx.depositItem.update({
    where: { id: depositItemId },
    data: {
      status,
      validationReasonCode: reason,
      rewardRateId: rate?.id ?? null,
      baseRewardAmount,
      complianceMultiplier,
      rewardAmount,
      acceptedAt: status !== "REJECTED" ? new Date() : null,
      acceptanceEventId,
      compactionStatus: machine.hasCompactor ? "PENDING" : "NOT_REQUIRED",
    },
  });

  if (rewardAmount > 0 && status !== "REJECTED") {
    await createEarnEntry(
      {
        userId: session.userId,
        organizationId: machine.organizationId,
        sessionId: session.id,
        depositItemId,
        campaignId: session.campaignId,
        amount: rewardAmount,
        status: ledgerStatus,
        reasonCode: reason,
      },
      tx,
    );
  }

  if (session.status === "PROCESSING_ITEM") {
    const nextStatus =
      status === "REVIEW"
        ? transitionSession(session.status, "ANOMALY")
        : transitionSession(session.status, "ITEM_DONE");
    await tx.depositSession.update({
      where: { id: sessionId },
      data: {
        status: nextStatus,
        anomalyCount:
          status === "REVIEW" ? { increment: 1 } : undefined,
      },
    });
  }
}
