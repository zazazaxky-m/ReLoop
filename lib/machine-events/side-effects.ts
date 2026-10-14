import type { MachineStatus, Prisma } from "@prisma/client";
import {
  transitionSession,
  validateSensorSequence,
  type SensorSequencePayload,
} from "../machine-state";
import { AUTO_PICKUP_FILL_THRESHOLD } from "../pickup";
import {
  SESSION_CLOSED_REASON,
  UNKNOWN_WASTE_TYPE_REASON,
  machineReasonCode,
  payloadStr,
  type IngestEventInput,
  type MachineContext,
} from "./shared";
import {
  resolveDepositItemId,
  resolveFraudDepositItemId,
  resolveOrCreateUnknownWasteType,
} from "./item";
import { flagAnomaly, holdItemForFraud, notifyOrgAdmins, publishSecurityAlert } from "./fraud";
import { maybeCreateAutoPickup } from "./pickup";
import { handleAcceptance, handleItemRejected, recordItemEvidence } from "./acceptance";
import { handleCloseWatermark } from "./watermark";
import { isTerminalSession } from "../deposit-review-contract";
import { sessionDeadline } from "../deposit-session-deadline";
import type { DepositItemCache } from "./item-cache";

/** Work that must run only after the event transaction commits (notifications, pushes). */
export type PostCommitEffect = () => Promise<void>;

/**
 * Applies one event's effects inside `tx`. With `afterCommit`, notifications
 * are handed to the caller to run after commit instead of being sent from
 * inside the transaction (a rolled-back, retried event must not notify twice).
 */
export async function processEventSideEffects(
  tx: Prisma.TransactionClient,
  machine: MachineContext,
  input: IngestEventInput,
  eventId: string,
  onItemCreated?: (id: string) => void,
  depositItemCache?: DepositItemCache,
  afterCommit?: (effect: PostCommitEffect) => void,
) {
  const autoPickup = () =>
    afterCommit
      ? maybeCreateAutoPickup(tx, machine, input.machineCode, afterCommit)
      : maybeCreateAutoPickup(tx, machine, input.machineCode);

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
        await autoPickup();
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
          await autoPickup();
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
          await autoPickup();
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
      // R03: lock the session row first (finish/cancel and the timeout policy
      // hold it while they decide), then re-read it, so an item never slips
      // into a session that is being released without being seen there.
      const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "DepositSession" WHERE id = ${input.sessionId} FOR NO KEY UPDATE`;
      if (locked.length === 0) break;
      const session = await tx.depositSession.findUnique({
        where: { id: input.sessionId },
      });
      if (!session) break;
      // Reported after the session ended (a queued event, or a race with
      // finish/timeout): the item stays in that session and goes to review;
      // the session is not reopened or extended.
      const sessionClosed = isTerminalSession(session.status);
      // Past its deadline every lease has expired and the session is over even
      // if no poll closed it yet (R03 I1): it is neither extended nor touched,
      // and the item stays PENDING until the timeout policy moves it to REVIEW.
      const now = Date.now();
      const pastDeadline = sessionDeadline(session, machine.sessionIdleTimeoutMinutes).getTime() <= now;

      if (!sessionClosed && !pastDeadline) {
        // The deadline only moves later: every lease issued for the session
        // stays within it (lib/deposit-session-deadline.ts).
        const extended = new Date(now + machine.sessionIdleTimeoutMinutes * 60 * 1000);
        if (!session.timeoutAt || session.timeoutAt.getTime() < extended.getTime()) {
          await tx.depositSession.update({
            where: { id: session.id },
            data: { timeoutAt: extended },
          });
        }
      }

      // Preferred path: kiosk sends the real WasteType id the user picked
      // on-machine before inserting the item. Only trust it if it's still
      // an accepted type for this machine (config may have changed since).
      let wasteTypeId: string | null =
        (payload.wasteTypeId as string | undefined) ?? null;
      let kioskConfirmed = false;
      if (wasteTypeId) {
        const linked = await tx.machineWasteType.findFirst({
          where: { machineId: machine.id, wasteTypeId, active: true },
          select: { id: true },
        });
        if (linked) {
          kioskConfirmed = true;
        } else {
          wasteTypeId = null;
        }
      }
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
          key.includes("anorganik") || key.includes("kaleng")
            ? "Anorganik"
            : key.includes("organik") || key.includes("botol")
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

      // Last resort: never drop a physical deposit silently. Route it to
      // the review queue under a shared "unknown" type instead of skipping
      // item creation entirely (previous behaviour lost the event).
      const isUnknownFallback = !wasteTypeId;
      if (!wasteTypeId) {
        wasteTypeId = await resolveOrCreateUnknownWasteType(tx);
      }

      const item = await tx.depositItem.create({
        data: {
          sessionId: session.id,
          wasteTypeId,
          quantity: (payload.quantity as number) ?? 1,
          source: kioskConfirmed ? "MACHINE" : "PYTHON_SIMULATOR",
          status: isUnknownFallback || sessionClosed ? "REVIEW" : "PENDING",
          validationReasonCode: isUnknownFallback
            ? UNKNOWN_WASTE_TYPE_REASON
            : sessionClosed
              ? SESSION_CLOSED_REASON
              : undefined,
        },
      });

      onItemCreated?.(item.id);
      depositItemCache?.set(session.id, item.id);

      await tx.machineEvent.update({
        where: { id: eventId },
        data: { depositItemId: item.id },
      });

      if (session.status === "ACTIVE" && !pastDeadline) {
        await tx.depositSession.update({
          where: { id: session.id },
          data: { status: "PROCESSING_ITEM" },
        });
      }
      break;
    }

    case "WEIGHT_MEASURED": {
      const itemId = await resolveDepositItemId(tx, input, depositItemCache);
      if (!itemId) break;
      // M04 (A3): evidence is written only while the item is undecided,
      // under the acceptance lock order; a later reading never re-prices it.
      await recordItemEvidence(tx, itemId, {
        kind: "MEASUREMENT",
        data: { measuredWeightGrams: payload.weightGrams as number },
      });
      break;
    }

    case "IMAGE_CLASSIFIED": {
      const itemId = await resolveDepositItemId(tx, input, depositItemCache);
      if (!itemId) break;
      await recordItemEvidence(tx, itemId, {
        kind: "MEASUREMENT",
        data: { aiDetectedType: payload.detectedType as string, aiConfidence: payload.confidence as number },
      });
      break;
    }

    case "BARCODE_READ": {
      const itemId = await resolveDepositItemId(tx, input, depositItemCache);
      if (!itemId) break;
      await recordItemEvidence(tx, itemId, { kind: "MEASUREMENT", data: { barcodeValue: payload.barcode as string } });
      break;
    }

    case "SENSOR_SEQUENCE": {
      const itemId = await resolveDepositItemId(tx, input, depositItemCache);
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
      const itemId = await resolveDepositItemId(tx, input, depositItemCache);
      if (!itemId) break;
      await handleAcceptance(tx, machine, input.sessionId, itemId, eventId);
      break;
    }

    case "ITEM_REJECTED": {
      const itemId = await resolveDepositItemId(tx, input, depositItemCache);
      if (!itemId) break;
      // M04: same gate and User -> DepositSession -> DepositItem locks as the
      // acceptance point; never flips an accepted, priced or reviewed item.
      await handleItemRejected(tx, {
        sessionId: input.sessionId ?? null,
        depositItemId: itemId,
        reason: machineReasonCode(payload.reason, "REJECTED"),
      });
      break;
    }

    case "FRAUD_DETECTED":
    case "VANDALISM_DETECTED": {
      // Machine-namespaced: a payload can never claim a reviewer's decision.
      const reason = machineReasonCode(payload.reason, input.eventType);
      const affectedItemId =
        input.eventType === "FRAUD_DETECTED"
          ? await resolveFraudDepositItemId(tx, input)
          : input.depositItemId ?? null;

      if (affectedItemId) {
        // M04: under User -> DepositSession -> DepositItem locks; holds the
        // item's earning (or opens a reconciliation case if it was already
        // paid out) and never reopens a reviewer's final decision.
        await holdItemForFraud(tx, affectedItemId, reason);
        await tx.machineEvent.update({
          where: { id: eventId },
          data: { depositItemId: affectedItemId },
        });
      }
      if (input.sessionId) {
        // The item itself was handled by the hold above.
        await flagAnomaly(tx, input.sessionId, null, reason);
      }
      const securityEventType = input.eventType;
      const notify = () => {
        // R04: realtime alert scoped to the machine row's organization.
        publishSecurityAlert({
          organizationId: machine.organizationId,
          machineCode: input.machineCode,
          eventType: securityEventType,
          eventId,
          occurredAt: input.occurredAt,
        });
        return notifyOrgAdmins(machine.organizationId, {
          type: "MACHINE_FRAUD",
          title:
            input.eventType === "VANDALISM_DETECTED"
              ? "Indikasi vandalisme terdeteksi"
              : "Indikasi fraud terdeteksi",
          body: `Mesin ${input.machineCode ?? ""} melaporkan ${reason.replaceAll("_", " ").toLowerCase()}. Tinjau di log keamanan.`.trim(),
          data: { machineCode: input.machineCode, reason },
        });
      };
      if (afterCommit) afterCommit(notify);
      else await notify();
      break;
    }

    case "COMPACTION_STARTED": {
      const itemId = await resolveDepositItemId(tx, input, depositItemCache);
      if (!itemId) break;
      // Post-acceptance lifecycle only; never touches priced evidence.
      await recordItemEvidence(tx, itemId, { kind: "COMPACTION", data: { compactionStatus: "PENDING" } });
      break;
    }

    case "COMPACTION_COMPLETED": {
      const itemId = await resolveDepositItemId(tx, input, depositItemCache);
      if (!itemId) break;
      await recordItemEvidence(tx, itemId, { kind: "COMPACTION", data: { compactionStatus: "COMPACTED" } });
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

    case "SESSION_CLOSE_WATERMARK": {
      // B01b: the machine confirmed every event of the session is synced;
      // the residual reward hold is released now (keyed), never before.
      await handleCloseWatermark(tx, machine, input, eventId, afterCommit);
      break;
    }

    default:
      break;
  }
}
