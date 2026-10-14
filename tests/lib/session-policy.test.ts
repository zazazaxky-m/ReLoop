import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bpsToMultiplier,
  canonicalSessionPolicy,
  machinePolicyView,
  multiplierToBps,
  parseSessionPolicy,
  policyItemCap,
  sessionLimits,
  sessionPolicyVersion,
  type SessionPolicySnapshot,
} from "@/lib/session-policy";

/** B01b: the admission snapshot (pure parts); buildSessionPolicy runs in tests/api/scan.test.ts and the integration suite. */
const snapshot: SessionPolicySnapshot = {
  version: 1,
  mode: "MONEY_REWARD",
  multiplierBps: 15000,
  ceilingRupiah: 10_000,
  maxItems: 20,
  capturedAt: "2026-10-15T08:00:00.000Z",
  wasteTypes: [
    { id: "cmauditwastetype0000000002", unit: "KG", rewardPerUnit: 2000, maxRewardRupiah: null, rewardRateId: "r2", minWeightGrams: null, maxWeightGrams: null },
    { id: "cmauditwastetype0000000001", unit: "ITEM", rewardPerUnit: 100, maxRewardRupiah: 150, rewardRateId: "r1", minWeightGrams: 5, maxWeightGrams: 500 },
  ],
};

describe("session policy snapshot", () => {
  it("has a canonical form of integers and strings only, sorted by waste type, and a sha256 version", () => {
    const canonical = canonicalSessionPolicy(snapshot);
    expect(canonical).toBe('[1,"MONEY_REWARD",15000,[["cmauditwastetype0000000001","ITEM",100,150],["cmauditwastetype0000000002","KG",2000,null]]]');
    expect(sessionPolicyVersion(snapshot)).toBe(createHash("sha256").update(canonical, "utf8").digest("hex"));
    // The machine view hashes identically (server-only fields are not part of the version).
    expect(sessionPolicyVersion(machinePolicyView(snapshot))).toBe(sessionPolicyVersion(snapshot));
    expect(machinePolicyView(snapshot)).toEqual({
      version: 1, mode: "MONEY_REWARD", multiplierBps: 15000,
      wasteTypes: [
        { id: "cmauditwastetype0000000002", unit: "KG", rewardPerUnit: 2000, maxRewardRupiah: null },
        { id: "cmauditwastetype0000000001", unit: "ITEM", rewardPerUnit: 100, maxRewardRupiah: 150 },
      ],
    });
  });

  it("expresses the multiplier in basis points (integers only cross the wire)", () => {
    expect(multiplierToBps(null)).toBe(10000);
    expect(multiplierToBps(0)).toBe(10000);
    expect(multiplierToBps(1.5)).toBe(15000);
    expect(multiplierToBps(1.23456)).toBe(12346);
    expect(bpsToMultiplier(15000)).toBe(1.5);
    expect(bpsToMultiplier(10000)).toBe(1);
  });

  it("caps one item at the most the server could pay: ITEM = round(rate x multiplier), KG = the max weight x rate, else unbounded", () => {
    expect(policyItemCap({ unit: "ITEM", rewardPerUnit: 100, maxWeightGrams: null }, 15000)).toBe(150);
    expect(policyItemCap({ unit: "ITEM", rewardPerUnit: 0, maxWeightGrams: null }, 15000)).toBe(0);
    expect(policyItemCap({ unit: "KG", rewardPerUnit: 2000, maxWeightGrams: 500 }, 15000)).toBe(1500);
    expect(policyItemCap({ unit: "KG", rewardPerUnit: 2000, maxWeightGrams: null }, 15000)).toBeNull();
  });

  it("the user-visible limit is the money ceiling and the item bound of the snapshot", () => {
    expect(sessionLimits(snapshot)).toEqual({ maxRewardRupiah: 10_000, maxItems: 20 });
    expect(sessionLimits({ ...snapshot, mode: "COMPLIANCE_ONLY", ceilingRupiah: null, maxItems: null })).toEqual({ maxRewardRupiah: null, maxItems: null });
    expect(sessionLimits(null)).toEqual({ maxRewardRupiah: null, maxItems: null });
  });

  it("parses only a well-formed snapshot (a legacy or corrupt column is null, never a crash)", () => {
    expect(parseSessionPolicy(snapshot)).toEqual(snapshot);
    expect(parseSessionPolicy(null)).toBeNull();
    expect(parseSessionPolicy({ version: 2 })).toBeNull();
    expect(parseSessionPolicy({ ...snapshot, multiplierBps: 1.5 })).toBeNull();
    expect(parseSessionPolicy({ ...snapshot, wasteTypes: [{ id: "x" }] })).toBeNull();
    expect(parseSessionPolicy("garbage")).toBeNull();
  });
});
