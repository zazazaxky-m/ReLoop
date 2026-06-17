import { ManualTransferProvider } from "./manual-transfer";
import { MockPayoutProvider } from "./mock";
import { LinkAjaProvider } from "./linkaja";
import type { PayoutProvider } from "./types";

export type PayoutProviderName =
  | "MANUAL_TRANSFER"
  | "MOCK"
  | "LINKAJA";

const providers: Record<PayoutProviderName, PayoutProvider> = {
  MANUAL_TRANSFER: new ManualTransferProvider(),
  MOCK: new MockPayoutProvider(),
  LINKAJA: new LinkAjaProvider(),
};

export function getPayoutProvider(
  name: PayoutProviderName = "MANUAL_TRANSFER",
): PayoutProvider {
  return providers[name] ?? providers.MANUAL_TRANSFER;
}

export * from "./types";
export { ManualTransferProvider, MockPayoutProvider, LinkAjaProvider };
