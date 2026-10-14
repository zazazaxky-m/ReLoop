import type { MachineEventType } from "@prisma/client";

/**
 * Shared fallback WasteType used when a machine reports ITEM_DETECTED
 * without any usable waste-type hint (no kiosk selection, no AI label, no
 * matching key). Kept inactive so it never appears in normal admin pickers;
 * items assigned to it always land in the review queue instead of being
 * silently dropped: the acceptance point keeps them in REVIEW with reward 0
 * whatever the fallback type's default reward or the measured weight (its
 * real weight window is unknown until a reviewer reclassifies the item, which
 * requires a wasteTypeId). Only the machine itself returning the item
 * (ITEM_REJECTED before acceptance) ends it as REJECTED, with no money.
 */
export const UNKNOWN_WASTE_TYPE_NAME = "Tidak Diketahui (Unknown)";
export const UNKNOWN_WASTE_TYPE_REASON = "UNKNOWN_WASTE_TYPE";
/**
 * B01b fix 1 (C3): the item's type is not in the session's admission price
 * list (added to the machine after the user was admitted). Never priced from
 * the live configuration: held for review at 0; the reviewer approves it as a
 * type of the session's price list (lib/deposit-review.ts).
 */
export const SNAPSHOT_TYPE_MISSING_REASON = "TYPE_NOT_IN_SNAPSHOT";

/**
 * R03 session-release reasons (lib/deposit-session-service.ts). An item the
 * machine had not decided when its session timed out, or that a machine
 * reported after its session ended, waits in REVIEW in that same session: a
 * later acceptance/rejection event of the session still decides it, or the
 * review queue does.
 */
export const SESSION_TIMEOUT_REASON = "SESSION_TIMEOUT";
export const SESSION_CLOSED_REASON = "SESSION_CLOSED";

/** DepositItem.validationReasonCode of a reviewer's final decision (lib/deposit-review.ts). */
export const REVIEW_APPROVED_REASON = "REVIEW_APPROVED";
export const REVIEW_REJECTED_REASON = "REVIEW_REJECTED";

/**
 * A reviewer's final decision: the status and the reviewer's code together.
 * Machines can never write a `REVIEW_*` code (`machineReasonCode`), so this
 * cannot be forged by an event payload.
 */
export function isReviewFinal(item: { status: string; validationReasonCode: string | null }): boolean {
  return (
    (item.status === "ACCEPTED" && item.validationReasonCode === REVIEW_APPROVED_REASON) ||
    (item.status === "REJECTED" && item.validationReasonCode === REVIEW_REJECTED_REASON)
  );
}

const MACHINE_REASON_MAX = 64;

/**
 * Reason code taken from a machine payload (ITEM_REJECTED, FRAUD_DETECTED,
 * VANDALISM_DETECTED). Codes in the server's `REVIEW_*` namespace are
 * prefixed `MACHINE_` so a payload can never claim a reviewer's decision.
 */
export function machineReasonCode(raw: unknown, fallback: string): string {
  const text = typeof raw === "string" ? raw.trim().slice(0, MACHINE_REASON_MAX) : "";
  const code = text === "" ? fallback : text;
  return /^REVIEW_/i.test(code) ? `MACHINE_${code}` : code;
}

/**
 * An item created through the unknown-waste-type fallback. Recognized by the
 * fallback type itself, so a later reason change can never turn it into a
 * priced item.
 */
export function isUnknownWasteTypeItem(item: {
  validationReasonCode: string | null;
  wasteType: { name: string; organizationId: string | null };
}): boolean {
  return item.validationReasonCode === UNKNOWN_WASTE_TYPE_REASON || isFallbackWasteType(item.wasteType);
}

/** The shared unknown-waste-type fallback itself (never a valid type to approve or price). */
export function isFallbackWasteType(wasteType: { name: string; organizationId: string | null }): boolean {
  return wasteType.name === UNKNOWN_WASTE_TYPE_NAME && wasteType.organizationId === null;
}

export interface IngestEventInput {
  machineCode: string;
  localEventId: string;
  eventType: MachineEventType;
  payload?: Record<string, unknown> | null;
  sessionId?: string | null;
  depositItemId?: string | null;
  occurredAt?: string | null;
  /**
   * Set by ingest (R03) when the event named an item that does not belong to
   * its session or machine. The reference is dropped, and no other item of
   * the session is picked in its place.
   */
  itemReferenceRejected?: boolean;
}

export interface IngestEventResult {
  duplicate: boolean;
  eventId: string;
  message?: string;
  depositItemId?: string | null;
}

/** Full machine shape needed while processing side effects for one event. */
export interface MachineContext {
  id: string;
  organizationId: string;
  chamberTimeoutSeconds: number;
  sessionIdleTimeoutMinutes: number;
  hasCompactor: boolean;
}

export function payloadStr(payload: Record<string, unknown> | null | undefined) {
  return (payload ?? {}) as Record<string, unknown>;
}
