import { describe, expect, it } from "vitest";
import { ManualTransferProvider, MockPayoutProvider, LinkAjaProvider, getPayoutProvider, payoutIdempotencyKey } from "@/lib/payout";

describe("payout providers", () => {
  it("manual transfer provider succeeds with note", async () => {
    const p = new ManualTransferProvider();
    const r = await p.disburse({
      accountIdentifier: "08123456789",
      amount: 10000,
      idempotencyKey: payoutIdempotencyKey("r1"),
    });
    expect(r.success).toBe(true);
  });

  it("mock provider returns reference", async () => {
    const p = new MockPayoutProvider();
    const r = await p.disburse({
      accountIdentifier: "08123456789",
      amount: 10000,
      idempotencyKey: payoutIdempotencyKey("r2"),
    });
    expect(r.success).toBe(true);
    expect(r.providerReference).toContain("MOCK-");
  });

  it("linkaja provider is TBD placeholder", async () => {
    const p = new LinkAjaProvider();
    const r = await p.disburse({
      accountIdentifier: "08123456789",
      amount: 10000,
      idempotencyKey: payoutIdempotencyKey("r3"),
    });
    expect(r.success).toBe(false);
    expect(r.message).toMatch(/TBD/i);
  });

  it("keys provider idempotency by redemption id, never by the per-user client key", () => {
    expect(payoutIdempotencyKey("cm1abc")).toBe("redemption:cm1abc:payout");
    expect(() => payoutIdempotencyKey("")).toThrow();
  });

  it("mock provider gives distinct references to payouts whose keys share a prefix", async () => {
    const p = new MockPayoutProvider();
    const [a, b] = await Promise.all(["cm1aaaa1", "cm1aaaa2"].map((id) =>
      p.disburse({ accountIdentifier: "08123456789", amount: 10000, idempotencyKey: payoutIdempotencyKey(id) })));
    expect(a.providerReference).toMatch(/^MOCK-[0-9a-f]{16}$/);
    expect(a.providerReference).not.toBe(b.providerReference);
    const again = await p.disburse({ accountIdentifier: "08123456789", amount: 10000, idempotencyKey: payoutIdempotencyKey("cm1aaaa1") });
    expect(again.providerReference).toBe(a.providerReference);
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
