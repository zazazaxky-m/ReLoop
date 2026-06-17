import { describe, expect, it } from "vitest";
import { computeBalance, type LedgerGroup } from "@/lib/ledger";

describe("computeBalance", () => {
  it("sums available and pending earn", () => {
    const groups: LedgerGroup[] = [
      { entryType: "EARN", status: "AVAILABLE", amount: 12500 },
      { entryType: "EARN", status: "PENDING", amount: 200 },
    ];
    const b = computeBalance(groups);
    expect(b.available).toBe(12500);
    expect(b.pending).toBe(200);
    expect(b.totalEarned).toBe(12700);
  });

  it("reserves available on a pending redemption", () => {
    const b = computeBalance([
      { entryType: "EARN", status: "AVAILABLE", amount: 12500 },
      { entryType: "REDEEM", status: "PENDING", amount: -10000 },
    ]);
    expect(b.available).toBe(2500);
    expect(b.reserved).toBe(10000);
    expect(b.redeemed).toBe(0);
  });

  it("counts settled redemption as redeemed and keeps available reduced", () => {
    const b = computeBalance([
      { entryType: "EARN", status: "AVAILABLE", amount: 12500 },
      { entryType: "REDEEM", status: "REDEEMED", amount: -10000 },
    ]);
    expect(b.available).toBe(2500);
    expect(b.reserved).toBe(0);
    expect(b.redeemed).toBe(10000);
  });

  it("releases reserve when redemption is reversed", () => {
    const b = computeBalance([
      { entryType: "EARN", status: "AVAILABLE", amount: 12500 },
      { entryType: "REDEEM", status: "REVERSED", amount: -10000 },
    ]);
    expect(b.available).toBe(12500);
    expect(b.reserved).toBe(0);
    expect(b.redeemed).toBe(0);
  });

  it("applies adjustments and penalties to available", () => {
    const b = computeBalance([
      { entryType: "EARN", status: "AVAILABLE", amount: 10000 },
      { entryType: "PENALTY", status: "AVAILABLE", amount: -1500 },
      { entryType: "ADJUST", status: "AVAILABLE", amount: 500 },
    ]);
    expect(b.available).toBe(9000);
  });

  it("never lets a pending-earn count as spendable", () => {
    const b = computeBalance([{ entryType: "EARN", status: "PENDING", amount: 5000 }]);
    expect(b.available).toBe(0);
    expect(b.pending).toBe(5000);
  });
});
