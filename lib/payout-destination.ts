import type { PayoutDestinationSource, PayoutProviderType, Redemption, RedemptionStatus } from "@prisma/client";
import { decrypt, encrypt } from "./encryption";

/**
 * Immutable payout destination of a redemption (M02).
 *
 * The request transaction copies the chosen PayoutAccount into
 * Redemption.payoutDestination*, encrypting the identifier and name with the
 * same AES-GCM helper the PayoutAccount extension uses (lib/encryption). The
 * queue, process, success and proof upload use this copy, never the mutable
 * account. Ciphertext never leaves the server: use `publicRedemption` for
 * responses and `describePayoutDestination` for an authorized view.
 *
 * A data-erasure request (lib/gdpr.ts) nulls the identifier and name on the
 * owner's settled requests and keeps provider/source/capturedAt, so the queue
 * shows the destination as erased. Unsettled requests keep the snapshot: it is
 * still needed to pay or reconcile them.
 */

/** Statuses after which a payout is settled and its destination no longer needed. */
export const SETTLED_REDEMPTION_STATUSES = ["SUCCESS", "FAILED", "REVERSED"] as const satisfies readonly RedemptionStatus[];

/** A request still carrying any destination PII. */
export const HAS_DESTINATION_PII = {
  OR: [{ payoutDestinationIdentifier: { not: null } }, { payoutDestinationName: { not: null } }],
};

/** Columns written when a data-erasure request removes a settled destination. */
export const ERASED_DESTINATION_DATA = {
  payoutDestinationIdentifier: null,
  payoutDestinationName: null,
};

export interface PayoutDestinationView {
  /** REQUEST_SNAPSHOT, a recorded legacy fallback, or a legacy live view (capturedAt null). */
  source: PayoutDestinationSource;
  provider: PayoutProviderType | null;
  accountIdentifier: string | null;
  accountName: string | null;
  /** When the destination was recorded on the request; null = legacy, not recorded yet. */
  capturedAt: Date | null;
  /** The number and name were removed by the owner's data-erasure request. */
  erased: boolean;
}

type DestinationColumns = Pick<
  Redemption,
  | "payoutDestinationSource"
  | "payoutDestinationProvider"
  | "payoutDestinationIdentifier"
  | "payoutDestinationName"
  | "payoutDestinationCapturedAt"
>;

export interface DestinationAccount {
  provider: PayoutProviderType;
  /** Plaintext, as read through the PayoutAccount encryption extension. */
  accountIdentifier: string;
  accountName: string | null;
}

/** Columns that record `account` as the request's destination. */
export function destinationSnapshotData(
  account: DestinationAccount,
  source: Exclude<PayoutDestinationSource, "LEGACY_UNAVAILABLE">,
  capturedAt: Date = new Date(),
): DestinationColumns {
  return {
    payoutDestinationSource: source,
    payoutDestinationProvider: account.provider,
    payoutDestinationIdentifier: encrypt(account.accountIdentifier),
    payoutDestinationName: account.accountName ? encrypt(account.accountName) : null,
    payoutDestinationCapturedAt: capturedAt,
  };
}

/** Columns for a legacy request whose account is gone: nothing is guessed. */
export function unavailableDestinationData(capturedAt: Date = new Date()): DestinationColumns {
  return {
    payoutDestinationSource: "LEGACY_UNAVAILABLE",
    payoutDestinationProvider: null,
    payoutDestinationIdentifier: null,
    payoutDestinationName: null,
    payoutDestinationCapturedAt: capturedAt,
  };
}

function reveal(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  try {
    return decrypt(ciphertext);
  } catch {
    return null; // unreadable with the current key: show nothing rather than ciphertext
  }
}

/**
 * Destination an authorized viewer (owner or superadmin) sees for a request:
 * the recorded snapshot, or for a legacy request not recorded yet the owner's
 * current account flagged LEGACY_ACCOUNT_FALLBACK with `capturedAt: null`.
 */
export function describePayoutDestination(
  redemption: DestinationColumns,
  currentAccount: DestinationAccount | null,
): PayoutDestinationView {
  if (redemption.payoutDestinationSource) {
    return {
      source: redemption.payoutDestinationSource,
      provider: redemption.payoutDestinationProvider,
      accountIdentifier: reveal(redemption.payoutDestinationIdentifier),
      accountName: reveal(redemption.payoutDestinationName),
      capturedAt: redemption.payoutDestinationCapturedAt,
      // A recorded account always has an identifier; only erasure removes it.
      erased:
        redemption.payoutDestinationSource !== "LEGACY_UNAVAILABLE" &&
        redemption.payoutDestinationIdentifier === null,
    };
  }
  if (currentAccount) {
    return {
      source: "LEGACY_ACCOUNT_FALLBACK",
      provider: currentAccount.provider,
      accountIdentifier: currentAccount.accountIdentifier,
      accountName: currentAccount.accountName,
      capturedAt: null,
      erased: false,
    };
  }
  return {
    source: "LEGACY_UNAVAILABLE",
    provider: null,
    accountIdentifier: null,
    accountName: null,
    capturedAt: null,
    erased: false,
  };
}

/** Prisma `omit` for columns that must never be serialized to a client. */
export const REDEMPTION_PRIVATE_COLUMNS = {
  requestHash: true,
  payoutDestinationIdentifier: true,
  payoutDestinationName: true,
} as const;

/** Strips the idempotency hash and destination ciphertext from a redemption. */
export function publicRedemption<T extends Partial<Redemption>>(
  redemption: T,
): Omit<T, keyof typeof REDEMPTION_PRIVATE_COLUMNS> {
  const {
    requestHash: _requestHash,
    payoutDestinationIdentifier: _identifier,
    payoutDestinationName: _name,
    ...rest
  } = redemption;
  return rest;
}
