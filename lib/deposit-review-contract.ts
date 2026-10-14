import type { SessionStatus } from "@prisma/client";

/**
 * Pure contract of the deposit review decision (task M04): user-facing
 * messages and the legacy-row rules shared by the server
 * (lib/deposit-review.ts), the reconcile inventory
 * (scripts/reconcile-wallet-history.ts) and the review queue UI. No database
 * or network access, so client components may import it.
 */

/**
 * A session that has ended: the owner finished or cancelled it, or the
 * timeout policy closed it (R03). This is not a promise that nothing else
 * happens to its items: the machine stays the authority on the physical
 * outcome of the items in its outbox, and its queued readings, acceptance or
 * rejection events still complete an undecided item after the session ended.
 * What ends is the human side: an ended session's pre-acceptance items are
 * never approved by a reviewer unless they predate the M04 cutover.
 */
export const TERMINAL_SESSION_STATUSES: readonly SessionStatus[] = ["COMPLETED", "CANCELLED", "EXPIRED"];

export function isTerminalSession(status: SessionStatus | string | null | undefined): boolean {
  return (TERMINAL_SESSION_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * A review row the acceptance contract (M04) never produced: no acceptance
 * event, or an acceptance event without an acceptance time. Such rows come
 * from before M04 (the old route approved without an acceptance check, and
 * the old fraud path reopened any item), and, after M04, from items a session
 * ended on before the machine decided them (R03: SESSION_TIMEOUT,
 * SESSION_CLOSED). They are never priced by the ordinary approval; see
 * `legacy` in lib/deposit-review.ts.
 */
export function isLegacyReviewRow(item: { acceptanceEventId: string | null; acceptedAt: Date | null }): boolean {
  return item.acceptanceEventId === null || item.acceptedAt === null;
}

/**
 * M04 cutover rule (fix round 5, L1): only a row created strictly before the
 * cutover (lib/reward-legacy-cutover.ts) may be approved as a legacy row. No
 * cutover means no row qualifies (fail closed).
 */
export function isBeforeCutover(createdAt: Date, cutoverAt: Date | null): boolean {
  return cutoverAt !== null && createdAt.getTime() < cutoverAt.getTime();
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

/**
 * 409: a pre-cutover legacy row (no or incomplete acceptance record) of an
 * ended session. It is the only 409 that offers the legacy approval, so the
 * review queue shows that action exactly when the server would accept it.
 */
export const REVIEW_LEGACY_ROW =
  "Catatan penerimaan mesin untuk item ini tidak ada atau tidak lengkap, dan sesi setorannya sudah berakhir. " +
  "Item ini tercatat sebelum kebijakan penerimaan saat ini berlaku: hanya superadmin yang dapat menyetujuinya " +
  "sebagai setoran lama, atau tolak item ini.";

/**
 * 409: a pre-acceptance row of an ended session created after the cutover.
 * No human approves it; the machine may still complete it from its outbox.
 */
export const REVIEW_ENDED_SESSION_REJECT_ONLY =
  "Item belum melewati titik penerimaan mesin dan sesi setorannya sudah berakhir, sehingga tidak dapat disetujui. " +
  "Item ini hanya dapat ditolak; catatan penerimaan mesin yang masih tertunda, bila ada, akan memperbaruinya secara otomatis.";

/** 409: a legacy approval was requested while the session can still produce the acceptance. */
export const REVIEW_LEGACY_SESSION_OPEN =
  "Sesi setoran ini masih berjalan. Tunggu hingga sesi berakhir sebelum menyetujuinya sebagai setoran lama, atau tolak item ini.";

/** 403: only a superadmin may approve a legacy row. */
export const REVIEW_LEGACY_SUPERADMIN_ONLY = "Persetujuan setoran lama hanya dapat dilakukan oleh superadmin.";

/** 422: a legacy approval was requested for a row the machine accepted normally. */
export const REVIEW_NOT_LEGACY = "Item ini sudah tercatat diterima mesin. Gunakan persetujuan biasa.";

/** 409: a legacy approval was requested for a row created after the cutover. */
export const REVIEW_LEGACY_NOT_ELIGIBLE =
  "Item ini tercatat setelah kebijakan penerimaan saat ini berlaku, sehingga tidak dapat disetujui sebagai setoran lama. " +
  "Item ini hanya dapat ditolak.";

/** 409: the cutover is unset or unreadable, so no row qualifies (fail closed). */
export const REVIEW_LEGACY_CUTOVER_UNAVAILABLE =
  "Batas waktu setoran lama belum dapat ditentukan, sehingga persetujuan setoran lama tidak tersedia. " +
  "Tolak item ini atau hubungi administrator sistem.";

/** 422: a legacy approval must carry the item version (`updatedAt`) the superadmin saw. */
export const REVIEW_LEGACY_VERSION_REQUIRED =
  "Versi item yang Anda lihat wajib disertakan untuk persetujuan setoran lama. Muat ulang halaman lalu ulangi.";

/** 409: the row changed after the superadmin looked at it (checked under the item lock). */
export const REVIEW_LEGACY_VERSION_MISMATCH =
  "Item setoran berubah sejak Anda melihatnya. Muat ulang halaman, periksa kembali, lalu ulangi.";
