import { describe, expect, it } from "vitest";
import { ManualTransferProvider, MockPayoutProvider, LinkAjaProvider } from "@/lib/payout";

describe("payout providers", () => {
  it("manual transfer provider succeeds with note", async () => {
    const p = new ManualTransferProvider();
    const r = await p.disburse({
      accountIdentifier: "08123456789",
      amount: 10000,
      idempotencyKey: "key-1",
    });
    expect(r.success).toBe(true);
  });

  it("mock provider returns reference", async () => {
    const p = new MockPayoutProvider();
    const r = await p.disburse({
      accountIdentifier: "08123456789",
      amount: 10000,
      idempotencyKey: "idem-abc-123",
    });
    expect(r.success).toBe(true);
    expect(r.providerReference).toContain("MOCK-");
  });

  it("linkaja provider is TBD placeholder", async () => {
    const p = new LinkAjaProvider();
    const r = await p.disburse({
      accountIdentifier: "08123456789",
      amount: 10000,
      idempotencyKey: "key-2",
    });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/TBD/i);
  });
});
