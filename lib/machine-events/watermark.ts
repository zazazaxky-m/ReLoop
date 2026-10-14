import type { Prisma } from "@prisma/client";
import { logAudit } from "../audit";
import { lockCampaign, lockDepositSession, lockMachine, lockUser } from "../db-locks";
import { expireIfTimedOut, sessionDeadline } from "../deposit-session-service";
import { HttpError } from "../rbac";
import {
  CLOSE_WATERMARK_RELEASE_REASON,
  findReservationByKey,
  lockFundingAccountForOrganization,
  releaseUnusedRewardBudget,
  sessionAdmissionKey,
  sessionCloseWatermarkKey,
} from "../reward-funding";
import { payloadStr, type IngestEventInput, type MachineContext } from "./shared";
import type { PostCommitEffect } from "./side-effects";

/**
 * SESSION_CLOSE_WATERMARK (B01b): the RVM states "every event of session S
 * up to `lastLocalEventId` (`eventCount` events) is synced". It sends it only
 * after the server ended the session and every outbox row of S was ACKed
 * (rvm/sync.py), through the same ACKed outbox, so it is retried with the
 * same localEventId and arrives after everything it vouches for.
 *
 * Only then is S's residual reward hold released: the admission reservation
 * is closed under the business key `session:<id>:close-watermark`, so a
 * retried or duplicated watermark never gives money back twice. Without a
 * watermark (a lost connection, a dead machine, a dead-lettered event) the
 * hold is retained and reported (SOURCE_CLOSED_AWAITING_WATERMARK); only the
 * audited SUPERADMIN release frees it.
 *
 * Refusals: a count the server cannot confirm (fewer rows than the RVM
 * counted, or an unknown last event) is permanent (EVENT_REJECTED: the
 * operator sees it in the dead-letter view, the hold stays); a session the
 * server still runs is transient (TEMPORARY_FAILURE: the RVM retries after
 * the next poll closed it); a session past its deadline is closed through the
 * timeout policy first.
 *
 * Lock order: owner User -> RewardFundingAccount -> Campaign -> Machine ->
 * DepositSession (-> DepositItem for the timeout policy).
 */

export const WATERMARK_COUNT_MISMATCH =
  "Jumlah event sesi yang dikonfirmasi mesin tidak sesuai dengan yang tercatat di server";
export const WATERMARK_SESSION_STILL_OPEN = "Sesi masih berjalan di server; konfirmasi penutupan diproses ulang nanti";
export const WATERMARK_PAYLOAD_INVALID = "Payload konfirmasi penutupan sesi tidak valid";

const TERMINAL = new Set(["COMPLETED", "CANCELLED", "EXPIRED"]);

interface WatermarkPayload {
  eventCount: number;
  lastLocalEventId: string | null;
  consumedRupiah: number | null;
  consumedItems: number | null;
}

function parsePayload(raw: Record<string, unknown>): WatermarkPayload {
  const eventCount = raw.eventCount;
  if (typeof eventCount !== "number" || !Number.isSafeInteger(eventCount) || eventCount < 0) {
    throw new HttpError(422, WATERMARK_PAYLOAD_INVALID);
  }
  const last = raw.lastLocalEventId;
  if (!(last === null || last === undefined || (typeof last === "string" && last.length > 0 && last.length <= 191))) {
    throw new HttpError(422, WATERMARK_PAYLOAD_INVALID);
  }
  if (eventCount > 0 && typeof last !== "string") throw new HttpError(422, WATERMARK_PAYLOAD_INVALID);
  const optionalInt = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return {
    eventCount,
    lastLocalEventId: typeof last === "string" ? last : null,
    consumedRupiah: optionalInt(raw.consumedRupiah),
    consumedItems: optionalInt(raw.consumedItems),
  };
}

export async function handleCloseWatermark(
  tx: Prisma.TransactionClient,
  machine: MachineContext,
  input: IngestEventInput,
  eventId: string,
  afterCommit?: (effect: PostCommitEffect) => void,
): Promise<void> {
  if (!input.sessionId) return;
  const payload = parsePayload(payloadStr(input.payload));
  const sessionId = input.sessionId;

  // Immutable relations first: who to lock.
  const ref = await tx.depositSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, campaignId: true, machineId: true },
  });
  if (!ref || ref.machineId !== machine.id) return;
  await lockUser(tx, ref.userId);
  await lockFundingAccountForOrganization(tx, machine.organizationId);
  if (ref.campaignId) await lockCampaign(tx, ref.campaignId);
  await lockMachine(tx, machine.id);
  await lockDepositSession(tx, sessionId);

  let session = await tx.depositSession.findUnique({ where: { id: sessionId } });
  if (!session) return;
  if (session.closeWatermarkAt) return; // already confirmed; the keyed release never repeats

  if (!TERMINAL.has(session.status)) {
    const now = new Date();
    if (sessionDeadline(session, machine.sessionIdleTimeoutMinutes).getTime() <= now.getTime()) {
      const expired = await expireIfTimedOut(tx, sessionId, machine.sessionIdleTimeoutMinutes, now);
      if (expired) {
        afterCommit?.(() =>
          logAudit({
            actorId: null,
            action: "DEPOSIT_SESSION_EXPIRE",
            entityType: "DepositSession",
            entityId: sessionId,
            metadata: { reason: "TIMEOUT", closedBy: "machine-watermark", heldItemIds: expired.heldItemIds },
          }),
        );
      }
      session = await tx.depositSession.findUnique({ where: { id: sessionId } });
    }
    if (!session || !TERMINAL.has(session.status)) throw new HttpError(503, WATERMARK_SESSION_STILL_OPEN);
  }

  // The server must hold at least what the machine counted, and the last event itself.
  const serverCount = await tx.machineEvent.count({
    where: { machineId: machine.id, sessionId, eventType: { not: "SESSION_CLOSE_WATERMARK" } },
  });
  const lastKnown = payload.lastLocalEventId
    ? await tx.machineEvent.findFirst({
        where: { machineId: machine.id, sessionId, localEventId: payload.lastLocalEventId },
        select: { id: true },
      })
    : { id: null };
  if (serverCount < payload.eventCount || !lastKnown) {
    console.error("[machine-events] close watermark refused: server holds fewer session events than the machine counted", {
      machineId: machine.id,
      sessionId,
      serverCount,
      eventCount: payload.eventCount,
      lastKnown: Boolean(lastKnown),
    });
    throw new HttpError(409, WATERMARK_COUNT_MISMATCH);
  }

  const now = new Date();
  await tx.depositSession.update({
    where: { id: sessionId, closeWatermarkAt: null },
    data: { closeWatermarkAt: now, closeWatermarkEventCount: payload.eventCount },
  });

  let releasedRupiah = 0;
  let reservationId: string | null = null;
  const reservation = await findReservationByKey(tx, sessionAdmissionKey(sessionId));
  if (reservation && reservation.status === "ACTIVE") {
    reservationId = reservation.id;
    const { released } = await releaseUnusedRewardBudget(tx, reservation.id, reservation.remainingRupiah, {
      close: true,
      reason: CLOSE_WATERMARK_RELEASE_REASON,
      businessKey: sessionCloseWatermarkKey(sessionId),
    });
    releasedRupiah = released;
  }

  afterCommit?.(() =>
    logAudit({
      actorId: null,
      action: "DEPOSIT_SESSION_CLOSE_WATERMARK",
      entityType: "DepositSession",
      entityId: sessionId,
      metadata: {
        machineId: machine.id,
        eventId,
        eventCount: payload.eventCount,
        lastLocalEventId: payload.lastLocalEventId,
        consumedRupiah: payload.consumedRupiah,
        consumedItems: payload.consumedItems,
        reservationId,
        releasedRupiah,
      },
    }),
  );
}
