import { createHash } from "node:crypto";
import type { PayoutIdempotencyKey, PayoutProvider, PayoutResult } from "./types";

/** Development mock that always succeeds instantly. */
export class MockPayoutProvider implements PayoutProvider {
  readonly name = "MOCK";

  async disburse(params: {
    accountIdentifier: string;
    amount: number;
    idempotencyKey: PayoutIdempotencyKey;
  }): Promise<PayoutResult> {
    return {
      success: true,
      // Derived from the whole business key: every payout gets its own reference.
      providerReference: `MOCK-${createHash("sha256").update(params.idempotencyKey).digest("hex").slice(0, 16)}`,
      message: `Mock payout Rp${params.amount} ke ${params.accountIdentifier}`,
    };
  }
}
