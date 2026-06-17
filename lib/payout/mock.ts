import type { PayoutProvider, PayoutResult } from "./types";

/** Development mock that always succeeds instantly. */
export class MockPayoutProvider implements PayoutProvider {
  readonly name = "MOCK";

  async disburse(params: {
    accountIdentifier: string;
    amount: number;
    idempotencyKey: string;
  }): Promise<PayoutResult> {
    return {
      success: true,
      providerReference: `MOCK-${params.idempotencyKey.slice(0, 8)}`,
      message: `Mock payout Rp${params.amount} ke ${params.accountIdentifier}`,
    };
  }
}
