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
  return (
    item.validationReasonCode === UNKNOWN_WASTE_TYPE_REASON ||
    (item.wasteType.name === UNKNOWN_WASTE_TYPE_NAME && item.wasteType.organizationId === null)
  );
}

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
