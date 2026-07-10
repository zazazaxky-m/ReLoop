import { describe, expect, it } from "vitest";
import { ManualTransferProvider, MockPayoutProvider, LinkAjaProvider, getPayoutProvider } from "@/lib/payout";

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

  it("getPayoutProvider returns correct provider", () => {
    expect(getPayoutProvider("MANUAL_TRANSFER")).toBeInstanceOf(ManualTransferProvider);
    expect(getPayoutProvider("MOCK")).toBeInstanceOf(MockPayoutProvider);
    expect(getPayoutProvider("LINKAJA")).toBeInstanceOf(LinkAjaProvider);
  });

  it("getPayoutProvider defaults to MANUAL_TRANSFER", () => {
    expect(getPayoutProvider()).toBeInstanceOf(ManualTransferProvider);
  });

  it("getPayoutProvider falls back to MANUAL_TRANSFER on unknown", () => {
    expect(getPayoutProvider("UNKNOWN" as any)).toBeInstanceOf(ManualTransferProvider);
  });
});
