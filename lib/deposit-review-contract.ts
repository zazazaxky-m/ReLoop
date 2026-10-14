import type { SessionStatus } from "@prisma/client";

/**
 * Pure contract of the deposit review decision (task M04): user-facing
 * messages and the legacy-row rules shared by the server
 * (lib/deposit-review.ts), the reconcile inventory
 * (scripts/reconcile-wallet-history.ts) and the review queue UI. No database
 * or network access, so client components may import it.
 */

/** A session that will never produce another machine event for its items. */
export const TERMINAL_SESSION_STATUSES: readonly SessionStatus[] = ["COMPLETED", "CANCELLED", "EXPIRED"];

export function isTerminalSession(status: SessionStatus | string | null | undefined): boolean {
  return (TERMINAL_SESSION_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * A review row the acceptance contract (M04) never produced: no acceptance
 * event, or an acceptance event without an acceptance time. Such rows come
 * from before M04 (the old route approved without an acceptance check, and
 * the old fraud path reopened any item). They are never priced by the
 * ordinary approval; see `legacy` in lib/deposit-review.ts.
 */
export function isLegacyReviewRow(item: { acceptanceEventId: string | null; acceptedAt: Date | null }): boolean {
  return item.acceptanceEventId === null || item.acceptedAt === null;
}

/**
 * Marker written to `DepositItem.acceptanceEventId` by a superadmin's legacy
 * approval of a row that had no acceptance event. It is not a MachineEvent id;
 * the audit log entry (DEPOSIT_REVIEW_APPROVED, `legacyApproval: true`) is the
 * record of who accepted the item and at which recorded time it was priced.
 */
export const LEGACY_ACCEPTANCE_PREFIX = "legacy-approval:";

export function legacyAcceptanceMarker(actorId: string): string {
  return `${LEGACY_ACCEPTANCE_PREFIX}${actorId}`;
}

export function isLegacyAcceptanceMarker(acceptanceEventId: string | null): boolean {
  return acceptanceEventId !== null && acceptanceEventId.startsWith(LEGACY_ACCEPTANCE_PREFIX);
}

// ---------------------------------------------------------------------------
// Messages (Indonesian, no internal protocol detail)
// ---------------------------------------------------------------------------

/** 409: the machine has not accepted the item yet and the session is still running. */
export const REVIEW_NOT_ACCEPTED =
  "Item belum melewati titik penerimaan mesin. Tunggu hingga mesin menyelesaikan setoran, atau tolak item ini.";

/** 409: a legacy row (no or incomplete acceptance record) that the machine will never complete. */
export const REVIEW_LEGACY_ROW =
  "Catatan penerimaan mesin untuk item ini tidak ada atau tidak lengkap, dan mesin tidak akan melengkapinya lagi. " +
  "Hanya superadmin yang dapat menyetujuinya sebagai setoran lama, atau tolak item ini.";

/** 409: a legacy approval was requested while the session can still produce the acceptance. */
export const REVIEW_LEGACY_SESSION_OPEN =
  "Sesi setoran ini masih berjalan. Tunggu hingga sesi berakhir sebelum menyetujuinya sebagai setoran lama, atau tolak item ini.";

/** 403: only a superadmin may approve a legacy row. */
export const REVIEW_LEGACY_SUPERADMIN_ONLY = "Persetujuan setoran lama hanya dapat dilakukan oleh superadmin.";

/** 422: a legacy approval was requested for a row the machine accepted normally. */
export const REVIEW_NOT_LEGACY = "Item ini sudah tercatat diterima mesin. Gunakan persetujuan biasa.";
