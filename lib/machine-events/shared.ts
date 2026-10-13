import type { MachineEventType } from "@prisma/client";

/**
 * Shared fallback WasteType used when a machine reports ITEM_DETECTED
 * without any usable waste-type hint (no kiosk selection, no AI label, no
 * matching key). Kept inactive so it never appears in normal admin pickers;
 * items assigned to it always land in the review queue instead of being
 * silently dropped.
 */
export const UNKNOWN_WASTE_TYPE_NAME = "Tidak Diketahui (Unknown)";
export const UNKNOWN_WASTE_TYPE_REASON = "UNKNOWN_WASTE_TYPE";

/** DepositItem.validationReasonCode of a reviewer's final decision (lib/deposit-review.ts). */
export const REVIEW_APPROVED_REASON = "REVIEW_APPROVED";
export const REVIEW_REJECTED_REASON = "REVIEW_REJECTED";

export function isReviewDecision(reasonCode: string | null | undefined): boolean {
  return reasonCode === REVIEW_APPROVED_REASON || reasonCode === REVIEW_REJECTED_REASON;
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
