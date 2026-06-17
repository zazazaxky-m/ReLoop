import type { PayoutProvider, PayoutResult } from "./types";

/** MVP default: superadmin marks transfer manually in the admin UI. */
export class ManualTransferProvider implements PayoutProvider {
  readonly name = "MANUAL_TRANSFER";

  async disburse(_params: {
    accountIdentifier: string;
    amount: number;
    idempotencyKey: string;
    note?: string;
  }): Promise<PayoutResult> {
    return {
      success: true,
      message:
        "Manual transfer — superadmin akan memproses dan menandai status di antrian redemption.",
    };
  }
}
