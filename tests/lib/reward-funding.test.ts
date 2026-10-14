import { describe, expect, it, vi } from "vitest";
import {
  REWARD_FUNDING_ENFORCED_ENV,
  SESSION_CEILING_NOT_CONFIGURED,
  STALE_HOLD_AFTER_MS,
  assertMoneyProgramConfigured,
  checkCapacity,
  classifyHold,
  fundingPolicy,
  isRewardFundingEnforced,
  resolveSessionCeiling,
  tripIssuanceCeiling,
} from "@/lib/reward-funding";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

/** Pure parts of lib/reward-funding.ts (B01a); the database paths run in tests/integration/reward-funding.test.ts. */
describe("REWARD_FUNDING_ENFORCED", () => {
  it("enforces only for the exact value true and fails closed on anything malformed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(isRewardFundingEnforced({})).toBe(false);
      expect(isRewardFundingEnforced({ [REWARD_FUNDING_ENFORCED_ENV]: "true" })).toBe(true);
      expect(isRewardFundingEnforced({ [REWARD_FUNDING_ENFORCED_ENV]: " TRUE " })).toBe(true);
      expect(isRewardFundingEnforced({ [REWARD_FUNDING_ENFORCED_ENV]: "false" })).toBe(false);
      expect(isRewardFundingEnforced({ [REWARD_FUNDING_ENFORCED_ENV]: "" })).toBe(false);
      for (const malformed of ["1", "yes", "on", "enforced", "truee"]) {
        expect(isRewardFundingEnforced({ [REWARD_FUNDING_ENFORCED_ENV]: malformed })).toBe(false);
      }
      expect(fundingPolicy({ [REWARD_FUNDING_ENFORCED_ENV]: "true" })).toEqual({ enforced: true });
      expect(fundingPolicy({})).toEqual({ enforced: false });
    } finally {
      warn.mockRestore();
    }
  });
});

describe("capacity checks (the brief's two conditions)", () => {
  it("reports the organization shortfall and the campaign shortfall separately", () => {
    expect(checkCapacity({ confirmedRupiah: 10_000, heldRupiah: 2_000 }, null, 8_000)).toEqual({ accountShortfall: 0, campaignShortfall: 0 });
    expect(checkCapacity({ confirmedRupiah: 10_000, heldRupiah: 2_000 }, null, 8_001)).toEqual({ accountShortfall: 1, campaignShortfall: 0 });
    const campaign = { rewardBudgetRupiah: 15_000, heldRupiah: 5_000, spentRupiah: 4_000 };
    expect(checkCapacity({ confirmedRupiah: 100_000, heldRupiah: 0 }, campaign, 6_000)).toEqual({ accountShortfall: 0, campaignShortfall: 0 });
    expect(checkCapacity({ confirmedRupiah: 100_000, heldRupiah: 0 }, campaign, 6_001)).toEqual({ accountShortfall: 0, campaignShortfall: 1 });
    // No campaign cap: only the organization's capacity applies.
    expect(checkCapacity({ confirmedRupiah: 0, heldRupiah: 0 }, { ...campaign, rewardBudgetRupiah: null }, 1))
      .toEqual({ accountShortfall: 1, campaignShortfall: 0 });
    // Held beyond confirmed (shadow mode) shows as a larger shortfall, never negative capacity hidden.
    expect(checkCapacity({ confirmedRupiah: 1_000, heldRupiah: 3_000 }, null, 500)).toEqual({ accountShortfall: 2_500, campaignShortfall: 0 });
  });
});

describe("ceilings", () => {
  it("prefers the campaign's per-session ceiling, then the machine's, else null", () => {
    expect(resolveSessionCeiling({ campaign: { maxRewardPerSessionRupiah: 5_000 }, machine: { maxRewardPerSessionRupiah: 20_000 } })).toBe(5_000);
    expect(resolveSessionCeiling({ campaign: { maxRewardPerSessionRupiah: null }, machine: { maxRewardPerSessionRupiah: 20_000 } })).toBe(20_000);
    expect(resolveSessionCeiling({ campaign: null, machine: { maxRewardPerSessionRupiah: 20_000 } })).toBe(20_000);
    expect(resolveSessionCeiling({ campaign: null, machine: { maxRewardPerSessionRupiah: null } })).toBeNull();
    expect(resolveSessionCeiling({ campaign: { maxRewardPerSessionRupiah: 0 }, machine: { maxRewardPerSessionRupiah: 20_000 } })).toBe(0);
  });

  it("a trip's issuance ceiling is bags x Rp2.000 x the campaign multiplier at full compliance, rounded up", () => {
    expect(tripIssuanceCeiling(0, null)).toBe(0);
    expect(tripIssuanceCeiling(3, null)).toBe(6_000);
    expect(tripIssuanceCeiling(3, 1.5)).toBe(9_000);
    expect(tripIssuanceCeiling(1, 0.3333)).toBe(667);
    expect(tripIssuanceCeiling(2, 0)).toBe(4_000);
    expect(() => tripIssuanceCeiling(2, 2_000_000_000)).toThrow(/batas/);
  });
});

describe("assertMoneyProgramConfigured", () => {
  const live = { status: "ACTIVE", rewardMode: "MONEY_REWARD", campaignType: "MACHINE_DEPOSIT", supportsMachine: false, maxRewardPerSessionRupiah: null };
  it("under enforcement, an ACTIVE money program at machines needs its per-session ceiling", () => {
    expect(() => assertMoneyProgramConfigured(live, { enforced: true })).toThrow(SESSION_CEILING_NOT_CONFIGURED);
    expect(() => assertMoneyProgramConfigured({ ...live, maxRewardPerSessionRupiah: 1_000 }, { enforced: true })).not.toThrow();
    expect(() => assertMoneyProgramConfigured({ ...live, campaignType: "EVENT", supportsMachine: true }, { enforced: true })).toThrow();
    // Programs that never run at machines, inactive or compliance-only programs, and shadow mode: never refused.
    expect(() => assertMoneyProgramConfigured({ ...live, campaignType: "EVENT" }, { enforced: true })).not.toThrow();
    expect(() => assertMoneyProgramConfigured({ ...live, campaignType: "TRASH_BAG" }, { enforced: true })).not.toThrow();
    expect(() => assertMoneyProgramConfigured({ ...live, status: "DRAFT" }, { enforced: true })).not.toThrow();
    expect(() => assertMoneyProgramConfigured({ ...live, rewardMode: "COMPLIANCE_ONLY" }, { enforced: true })).not.toThrow();
    expect(() => assertMoneyProgramConfigured(live, { enforced: false })).not.toThrow();
  });
});

describe("classifyHold (stale-hold monitoring)", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const row = {
    id: "res1", businessKey: "session:s1:admission", organizationId: "org1", userId: "u1", campaignId: null,
    sourceType: "SESSION" as const, sourceId: "s1", sourceStatus: "ACTIVE", ceilingRupiah: 20_000, remainingRupiah: 15_000,
    shortfallRupiah: 0, campaignShortfallRupiah: 0, createdAt: new Date(now.getTime() - 5 * 60_000),
  };

  it("names the owner and a reconciliation reason for closed sources, old open sources, missing ceilings and shortfalls", () => {
    expect(classifyHold(row, now)).toBeNull();
    const closed = classifyHold({ ...row, sourceStatus: "COMPLETED" }, now)!;
    expect(closed).toMatchObject({ userId: "u1", organizationId: "org1", reasons: ["SOURCE_CLOSED_AWAITING_WATERMARK"], ageMinutes: 5 });
    expect(closed.reconciliation).toMatch(/superadmin melepas sisa dana/);
    expect(classifyHold({ ...row, sourceStatus: "EXPIRED", remainingRupiah: 0 }, now)).toBeNull();
    expect(classifyHold({ ...row, createdAt: new Date(now.getTime() - STALE_HOLD_AFTER_MS - 1) }, now)?.reasons).toEqual(["SOURCE_OPEN_TOO_LONG"]);
    expect(classifyHold({ ...row, ceilingRupiah: 0, remainingRupiah: 0 }, now)?.reasons).toEqual(["CEILING_NOT_CONFIGURED"]);
    expect(classifyHold({ ...row, shortfallRupiah: 3_000 }, now)?.reasons).toEqual(["CAPACITY_SHORTFALL"]);
    expect(classifyHold({ ...row, campaignShortfallRupiah: 1 }, now)?.reasons).toEqual(["CAPACITY_SHORTFALL"]);
    // Trips: a COMPLETED or CANCELLED trip with residue is a closed source too.
    expect(classifyHold({ ...row, sourceType: "TRIP", sourceStatus: "CANCELLED" }, now)?.reasons).toEqual(["SOURCE_CLOSED_AWAITING_WATERMARK"]);
    expect(classifyHold({ ...row, sourceType: "TRIP", sourceStatus: "ACTIVE" }, now)).toBeNull();
    const several = classifyHold({ ...row, sourceStatus: "COMPLETED", shortfallRupiah: 10 }, now)!;
    expect(several.reasons).toEqual(["SOURCE_CLOSED_AWAITING_WATERMARK", "CAPACITY_SHORTFALL"]);
  });
});
