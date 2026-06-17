export type PayoutResult = {
  success: boolean;
  providerReference?: string;
  message?: string;
};

export interface PayoutProvider {
  readonly name: string;
  disburse(params: {
    accountIdentifier: string;
    amount: number;
    idempotencyKey: string;
    note?: string;
  }): Promise<PayoutResult>;
}

export interface PayoutProviderConfig {
  enabled: boolean;
  sandbox?: boolean;
}
