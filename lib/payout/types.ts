export type PayoutResult = {
  success: boolean;
  providerReference?: string;
  message?: string;
};

declare const payoutKeyBrand: unique symbol;

/**
 * Provider-side idempotency key for the transfer of one payout request:
 * `redemption:<id>:payout`. Build it only with `payoutIdempotencyKey`.
 *
 * Never use `Redemption.idempotencyKey`: that key is chosen by the client,
 * unique only per user and may be a single character, so two users' payouts
 * could collapse into one provider transfer.
 */
export type PayoutIdempotencyKey = string & { readonly [payoutKeyBrand]: true };

export function payoutIdempotencyKey(redemptionId: string): PayoutIdempotencyKey {
  if (!redemptionId) throw new Error("payoutIdempotencyKey requires a redemption id");
  return `redemption:${redemptionId}:payout` as PayoutIdempotencyKey;
}

/**
 * Transfers money outside the database. Never call it inside a database
 * transaction: commit the PROCESSING state first, then disburse, then record
 * the outcome with a separate transition. An unknown outcome (timeout, lost
 * response) keeps the request PROCESSING and flags it for reconciliation; it
 * is never treated as a failure that releases the reserve.
 */
export interface PayoutProvider {
  readonly name: string;
  disburse(params: {
    accountIdentifier: string;
    amount: number;
    idempotencyKey: PayoutIdempotencyKey;
    note?: string;
  }): Promise<PayoutResult>;
}

export interface PayoutProviderConfig {
  enabled: boolean;
  sandbox?: boolean;
}
