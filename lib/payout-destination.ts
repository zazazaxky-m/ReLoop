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
 * An account erasure (lib/erasure-jobs.ts) runs only once every request of the
 * owner is settled; it then nulls the identifier and name on all of them and
 * keeps provider/source/capturedAt, so the queue shows the destination as
 * erased. It also blanks the owner's PayoutAccount (ERASED_ACCOUNT_IDENTIFIER),
 * so a legacy request without a snapshot shows as erased, not as an empty
 * live account.
 */

/** Statuses after which a payout is settled and its destination no longer needed. */
export const SETTLED_REDEMPTION_STATUSES = ["SUCCESS", "FAILED", "REVERSED"] as const satisfies readonly RedemptionStatus[];

/** Columns written when an account erasure removes a settled destination. */
export const ERASED_DESTINATION_DATA = {
  payoutDestinationIdentifier: null,
  payoutDestinationName: null,
};

/** PayoutAccount.accountIdentifier after the owner's account erasure (accountName is null). */
export const ERASED_ACCOUNT_IDENTIFIER = "";

export interface PayoutDestinationView {
  /** REQUEST_SNAPSHOT, a recorded legacy fallback, or a legacy live view (capturedAt null). */
  source: PayoutDestinationSource;
  provider: PayoutProviderType | null;
  accountIdentifier: string | null;
  accountName: string | null;
  /** When the destination was recorded on the request; null = legacy, not recorded yet. */
  capturedAt: Date | null;
  /** The number and name were removed by the owner's account erasure. */
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
    const erased = currentAccount.accountIdentifier === ERASED_ACCOUNT_IDENTIFIER;
    return {
      source: "LEGACY_ACCOUNT_FALLBACK",
      provider: currentAccount.provider,
      accountIdentifier: erased ? null : currentAccount.accountIdentifier,
      accountName: erased ? null : currentAccount.accountName,
      capturedAt: null,
      erased,
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
