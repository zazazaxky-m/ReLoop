import type { MachineEventType, MachineStatus, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { createEarnEntry } from "./ledger";
import {
  transitionSession,
  validateSensorSequence,
  type SensorSequencePayload,
} from "./machine-state";
import {
  computeRewardAmount,
  evaluateSensorFusion,
  resolveRewardRate,
} from "./reward";
import { AUTO_PICKUP_FILL_THRESHOLD, PICKUP_OPEN } from "./pickup";

export interface IngestEventInput {
  machineCode: string;
  localEventId: string;
  eventType: MachineEventType;
  payload?: Record<string, unknown> | null;
  sessionId?: string | null;
  depositItemId?: string | null;
  occurredAt?: string | null;
}

export interface IngestEventResult {
  duplicate: boolean;
  eventId: string;
  message?: string;
  depositItemId?: string | null;
}

function payloadStr(payload: Record<string, unknown> | null | undefined) {
  return (payload ?? {}) as Record<string, unknown>;
}

/** Idempotent machine event ingestion with acceptance-point reward gating. */
export async function ingestMachineEvent(
  input: IngestEventInput,
): Promise<IngestEventResult> {
  const machine = await prisma.machine.findUnique({
    where: { machineCode: input.machineCode },
    include: { organization: true },
  });
  if (!machine) throw new Error("Mesin tidak ditemukan");

  const existing = await prisma.machineEvent.findUnique({
    where: {
      machineId_localEventId: {
        machineId: machine.id,
        localEventId: input.localEventId,
      },
    },
  });
  if (existing) {
    return {
      duplicate: true,
      eventId: existing.id,
      message: "Event sudah diproses",
      depositItemId: existing.depositItemId,
    };
  }

  // Edge machines can retain queued events across a server database reset.
  // Detach stale foreign keys instead of failing the complete ingest batch.
  let sessionId = input.sessionId ?? null;
  let depositItemId = input.depositItemId ?? null;
  const orphanedReferences: Record<string, string> = {};

  if (sessionId) {
    const session = await prisma.depositSession.findFirst({
      where: { id: sessionId, machineId: machine.id },
      select: { id: true },
    });
    if (!session) {
      orphanedReferences.sessionId = sessionId;
      sessionId = null;
      depositItemId = null;
    }
  }

  if (depositItemId) {
    const item = await prisma.depositItem.findFirst({
      where: { id: depositItemId, session: { machineId: machine.id } },
      select: { id: true, sessionId: true },
    });
    if (!item || (sessionId && item.sessionId !== sessionId)) {
      orphanedReferences.depositItemId = depositItemId;
      depositItemId = null;
    }
  }

  const sanitizedInput: IngestEventInput = {
    ...input,
    sessionId,
    depositItemId,
    payload:
      Object.keys(orphanedReferences).length > 0
        ? { ...(input.payload ?? {}), orphanedReferences }
        : input.payload,
  };

  let createdItemId: string | null = null;

  const occurredAt = input.occurredAt
    ? new Date(input.occurredAt)
    : new Date();

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.machineEvent.create({
      data: {
        machineId: machine.id,
        sessionId,
        depositItemId,
        localEventId: input.localEventId,
        eventType: input.eventType,
        payloadJson: (sanitizedInput.payload ?? undefined) as Prisma.InputJsonValue | undefined,
        occurredAt,
      },
    });

    await processEventSideEffects(tx, machine, sanitizedInput, created.id, (id) => {
      createdItemId = id;
    });
    return created;
  });

  return {
    duplicate: false,
    eventId: event.id,
    depositItemId: createdItemId ?? depositItemId,
    message:
      Object.keys(orphanedReferences).length > 0
        ? "Referensi sesi/item lokal tidak ditemukan dan dilepas"
        : undefined,
  };
}

async function processEventSideEffects(
  tx: Prisma.TransactionClient,
  machine: {
    id: string;
    organizationId: string;
    chamberTimeoutSeconds: number;
    sessionIdleTimeoutMinutes: number;
    hasCompactor: boolean;
  },
  input: IngestEventInput,
  eventId: string,
  onItemCreated?: (id: string) => void,
) {
  const payload = payloadStr(input.payload);

  switch (input.eventType) {
    case "HEARTBEAT": {
      const fill =
        typeof payload.fillLevelPercent === "number"
          ? (payload.fillLevelPercent as number)
          : undefined;
      await tx.machine.update({
        where: { id: machine.id },
        data: {
          lastHeartbeatAt: new Date(),
          status: (payload.status as MachineStatus) ?? undefined,
          fillLevelPercent: fill,
        },
      });
      if (
        (typeof fill === "number" && fill >= AUTO_PICKUP_FILL_THRESHOLD) ||
        payload.status === "FULL"
      ) {
        await maybeCreateAutoPickup(tx, machine);
      }
      break;
    }

    case "STATUS_CHANGED": {
      if (payload.status) {
        await tx.machine.update({
          where: { id: machine.id },
          data: { status: payload.status as MachineStatus },
        });
        if (payload.status === "FULL") {
          await maybeCreateAutoPickup(tx, machine);
        }
      }
      break;
    }

    case "FILL_LEVEL_UPDATED": {
      if (typeof payload.fillLevelPercent === "number") {
        const fill = payload.fillLevelPercent as number;
        await tx.machine.update({
          where: { id: machine.id },
          data: {
            fillLevelPercent: fill,
            status: fill >= 95 ? "FULL" : undefined,
          },
        });
        if (fill >= AUTO_PICKUP_FILL_THRESHOLD) {
          await maybeCreateAutoPickup(tx, machine);
        }
      }
      break;
    }

    case "CHAMBER_OPENED": {
      if (input.sessionId) {
        const session = await tx.depositSession.findUnique({
          where: { id: input.sessionId },
        });
        if (session && ["ACTIVE", "RESERVED"].includes(session.status)) {
          await tx.depositSession.update({
            where: { id: session.id },
            data: {
              status: transitionSession(session.status, "START_ITEM"),
            },
          });
        }
      }
      break;
    }

    case "CHAMBER_TIMEOUT": {
      if (input.sessionId) {
        const session = await tx.depositSession.findUnique({
          where: { id: input.sessionId },
        });
        if (session?.status === "PROCESSING_ITEM") {
          await tx.depositSession.update({
            where: { id: session.id },
            data: { status: transitionSession(session.status, "ITEM_DONE") },
          });
        }
      }
      break;
    }

    case "ITEM_DETECTED": {
      if (!input.sessionId) break;
      const session = await tx.depositSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session) break;

      await tx.depositSession.update({
        where: { id: session.id },
        data: {
          timeoutAt: new Date(
            Date.now() + machine.sessionIdleTimeoutMinutes * 60 * 1000,
          ),
        },
      });

      let wasteTypeId: string | null =
        (payload.wasteTypeId as string | undefined) ?? null;
      if (!wasteTypeId && payload.wasteTypeName) {
        const wt = await tx.wasteType.findFirst({
          where: {
            name: { contains: String(payload.wasteTypeName).split("(")[0].trim(), mode: "insensitive" },
            active: true,
          },
        });
        wasteTypeId = wt?.id ?? null;
      }
      if (!wasteTypeId && payload.wasteTypeKey) {
        const key = String(payload.wasteTypeKey).toLowerCase();
        const mappedName =
          key.includes("organik") && !key.includes("anorganik")
            ? "Organik"
            : "Anorganik";
        const wt = await tx.wasteType.findFirst({
          where: {
            active: true,
            name: { contains: mappedName, mode: "insensitive" },
          },
        });
        wasteTypeId = wt?.id ?? null;
      }
      if (!wasteTypeId) break;

      const item = await tx.depositItem.create({
        data: {
          sessionId: session.id,
          wasteTypeId,
          quantity: (payload.quantity as number) ?? 1,
          source: "PYTHON_SIMULATOR",
          status: "PENDING",
        },
      });

      onItemCreated?.(item.id);

      await tx.machineEvent.update({
        where: { id: eventId },
        data: { depositItemId: item.id },
      });

      if (session.status === "ACTIVE") {
        await tx.depositSession.update({
          where: { id: session.id },
          data: { status: "PROCESSING_ITEM" },
        });
      }
      break;
    }

    case "WEIGHT_MEASURED": {
      const itemId = await resolveDepositItemId(tx, input);
      if (!itemId) break;
      await tx.depositItem.update({
        where: { id: itemId },
        data: {
          measuredWeightGrams: payload.weightGrams as number,
        },
      });
      break;
    }

    case "IMAGE_CLASSIFIED": {
      const itemId = await resolveDepositItemId(tx, input);
      if (!itemId) break;
      await tx.depositItem.update({
        where: { id: itemId },
        data: {
          aiDetectedType: payload.detectedType as string,
          aiConfidence: payload.confidence as number,
        },
      });
      break;
    }

    case "BARCODE_READ": {
      const itemId = await resolveDepositItemId(tx, input);
      if (!itemId) break;
      await tx.depositItem.update({
        where: { id: itemId },
        data: { barcodeValue: payload.barcode as string },
      });
      break;
    }

    case "SENSOR_SEQUENCE": {
      const itemId = await resolveDepositItemId(tx, input);
      if (!itemId) break;
      const seq = payload as SensorSequencePayload;
      await tx.depositItem.update({
        where: { id: itemId },
        data: { sensorSequenceJson: seq as Prisma.InputJsonValue },
      });

      const anomaly = validateSensorSequence(seq);
      if (anomaly && input.sessionId) {
        await flagAnomaly(tx, input.sessionId, itemId, anomaly);
      }
      break;
    }

    case "ITEM_ACCEPTED_POINT": {
      if (!input.sessionId) break;
      const itemId = await resolveDepositItemId(tx, input);
      if (!itemId) break;
      await handleAcceptance(tx, machine, input.sessionId, itemId, eventId);
      break;
    }

    case "ITEM_REJECTED": {
      const itemId = await resolveDepositItemId(tx, input);
      if (!itemId) break;
      await tx.depositItem.update({
        where: { id: itemId },
        data: {
          status: "REJECTED",
          validationReasonCode: (payload.reason as string) ?? "REJECTED",
        },
      });
      if (input.sessionId) {
        const session = await tx.depositSession.findUnique({
          where: { id: input.sessionId },
        });
        if (session?.status === "PROCESSING_ITEM") {
          await tx.depositSession.update({
            where: { id: session.id },
            data: { status: transitionSession(session.status, "ITEM_DONE") },
          });
        }
      }
      break;
    }

    case "FRAUD_DETECTED":
    case "VANDALISM_DETECTED": {
      const reason = String(payload.reason ?? input.eventType);
      const affectedItemId =
        input.eventType === "FRAUD_DETECTED"
          ? await resolveFraudDepositItemId(tx, input)
          : input.depositItemId ?? null;

      if (affectedItemId) {
        await tx.depositItem.update({
          where: { id: affectedItemId },
          data: {
            status: "REVIEW",
            externalFraudFlag: true,
            validationReasonCode: reason,
          },
        });
        await tx.rewardLedger.updateMany({
          where: { depositItemId: affectedItemId, status: "AVAILABLE" },
          data: { status: "PENDING", reasonCode: reason },
        });
        await tx.machineEvent.update({
          where: { id: eventId },
          data: { depositItemId: affectedItemId },
        });
      }
      if (input.sessionId) {
        await flagAnomaly(
          tx,
          input.sessionId,
          affectedItemId,
          reason,
        );
      }
      break;
    }

    case "COMPACTION_STARTED": {
      const itemId = await resolveDepositItemId(tx, input);
      if (!itemId) break;
      await tx.depositItem.update({
        where: { id: itemId },
        data: { compactionStatus: "PENDING" },
      });
      break;
    }

    case "COMPACTION_COMPLETED": {
      const itemId = await resolveDepositItemId(tx, input);
      if (!itemId) break;
      await tx.depositItem.update({
        where: { id: itemId },
        data: { compactionStatus: "COMPACTED" },
      });
      break;
    }

    case "SAFE_STATE_ENTERED": {
      await tx.machine.update({
        where: { id: machine.id },
        data: { status: "ERROR" },
      });
      if (input.sessionId) {
        const session = await tx.depositSession.findUnique({
          where: { id: input.sessionId },
        });
        if (session && !["COMPLETED", "CANCELLED", "EXPIRED"].includes(session.status)) {
          await tx.depositSession.update({
            where: { id: session.id },
            data: {
              status: transitionSession(session.status, "SAFE_STATE"),
              anomalyCount: { increment: 1 },
            },
          });
        }
      }
      break;
    }

    default:
      break;
  }
}

async function resolveFraudDepositItemId(
  tx: Prisma.TransactionClient,
  input: IngestEventInput,
): Promise<string | null> {
  if (input.depositItemId) return input.depositItemId;
  if (!input.sessionId) return null;
  const item = await tx.depositItem.findFirst({
    where: { sessionId: input.sessionId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return item?.id ?? null;
}

async function resolveDepositItemId(
  tx: Prisma.TransactionClient,
  input: IngestEventInput,
): Promise<string | null> {
  if (input.depositItemId) return input.depositItemId;
  if (!input.sessionId) return null;
  const item = await tx.depositItem.findFirst({
    where: { sessionId: input.sessionId, status: { in: ["PENDING", "REVIEW"] } },
    orderBy: { createdAt: "desc" },
  });
  return item?.id ?? null;
}

/** Raises a FULL pickup request once per open cycle (idempotent per machine). */
async function maybeCreateAutoPickup(
  tx: Prisma.TransactionClient,
  machine: { id: string; organizationId: string },
) {
  const open = await tx.pickupRequest.findFirst({
    where: { machineId: machine.id, status: { in: PICKUP_OPEN } },
  });
  if (open) return;
  await tx.pickupRequest.create({
    data: {
      machineId: machine.id,
      organizationId: machine.organizationId,
      reason: "FULL",
      priority: 1,
      status: "REQUESTED",
      notes: "Auto-generated: mesin penuh / mendekati penuh.",
    },
  });
}

async function handleAcceptance(
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

  const rate = await resolveRewardRate({
    organizationId: machine.organizationId,
    campaignId: session.campaignId,
    wasteTypeId: item.wasteTypeId,
  });

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

  if (!fusion.valid) {
    status = "REJECTED";
    reason = fusion.reasonCode ?? "WEIGHT_INVALID";
  } else if (sensorAnomaly || item.externalFraudFlag || session.status === "REVIEW") {
    status = "REVIEW";
    reason = sensorAnomaly ?? "ANOMALY_REVIEW";
    ledgerStatus = "PENDING";
  }

  const multiplier = session.campaign?.rewardMultiplier ?? 1;
  const points = rate?.pointsPerItem ?? item.wasteType.defaultRewardPerItem ?? 0;
  const rewardAmount =
    status === "ACCEPTED" || status === "REVIEW"
      ? computeRewardAmount(points, item.quantity, multiplier)
      : 0;

  await tx.depositItem.update({
    where: { id: depositItemId },
    data: {
      status,
      validationReasonCode: reason,
      rewardRateId: rate?.id ?? null,
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

async function flagAnomaly(
  tx: Prisma.TransactionClient,
  sessionId: string,
  depositItemId: string | null | undefined,
  reason: string,
) {
  if (depositItemId) {
    await tx.depositItem.update({
      where: { id: depositItemId },
      data: { status: "REVIEW", validationReasonCode: reason },
    });
  }
  const session = await tx.depositSession.findUnique({
    where: { id: sessionId },
  });
  if (session && !["COMPLETED", "CANCELLED", "EXPIRED"].includes(session.status)) {
    await tx.depositSession.update({
      where: { id: sessionId },
      data: {
        status: ["ACTIVE", "PROCESSING_ITEM"].includes(session.status)
          ? "REVIEW"
          : session.status,
        anomalyCount: { increment: 1 },
      },
    });
  }
}
