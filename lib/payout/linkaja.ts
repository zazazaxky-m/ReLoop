import type { PayoutProvider, PayoutResult } from "./types";

/**
 * LinkAja disbursement adapter — TBD until official API docs, sandbox credentials,
 * callback signature verification, fee policy, and settlement rules are available.
 */
export class LinkAjaProvider implements PayoutProvider {
  readonly name = "LINKAJA";

  async disburse(_params: {
    accountIdentifier: string;
    amount: number;
    idempotencyKey: string;
  }): Promise<PayoutResult> {
    return {
      success: false,
      message:
        "LinkAja API integration TBD — requires merchant credentials, sandbox, and callback verification.",
    };
  }
}

// TODO: GoPay, OVO, ShopeePay providers (phase-later priority per product spec)
