import { describe, expect, it } from "vitest";
import { ERASED_ACCOUNT_IDENTIFIER, describePayoutDestination } from "./payout-destination";

const legacy = {
  payoutDestinationSource: null, payoutDestinationProvider: null, payoutDestinationIdentifier: null,
  payoutDestinationName: null, payoutDestinationCapturedAt: null,
};

describe("describePayoutDestination for a legacy request", () => {
  it("shows the owner's current account, flagged as an unrecorded fallback", () => {
    expect(describePayoutDestination(legacy, { provider: "DANA", accountIdentifier: "081200000000", accountName: "Ani" }))
      .toEqual({ source: "LEGACY_ACCOUNT_FALLBACK", provider: "DANA", accountIdentifier: "081200000000",
        accountName: "Ani", capturedAt: null, erased: false });
  });

  it("shows an account blanked by the owner's erasure as erased, not as an empty live account", () => {
    expect(describePayoutDestination(legacy, { provider: "DANA", accountIdentifier: ERASED_ACCOUNT_IDENTIFIER, accountName: null }))
      .toEqual({ source: "LEGACY_ACCOUNT_FALLBACK", provider: "DANA", accountIdentifier: null,
        accountName: null, capturedAt: null, erased: true });
  });
});
