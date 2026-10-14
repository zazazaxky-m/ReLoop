import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  CAMPAIGN_BUDGET_REQUIRED_FOR_ACTIVATION,
  FUNDING_CUTOVER_ENV,
  REWARD_FUNDING_ENFORCED_ENV,
  REWARD_FUNDING_MIGRATION,
  SESSION_CEILING_NOT_CONFIGURED,
  STALE_HOLD_AFTER_MS,
  assertMoneyProgramConfigured,
  checkCapacity,
  classifyHold,
  configuredCap,
  effectiveMultiplier,
  fundingPolicy,
  fundingCashKey,
  fundingCorrectionKey,
  effectiveProgramModes,
  isRewardFundingEnforced,
  isFundingReferenceConflict,
  normalizeFundingReference,
  resolveFundingCutover,
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
  it("prefers the campaign's per-session ceiling, then the machine's, else null; zero is never a ceiling (I3)", () => {
    expect(resolveSessionCeiling({ campaign: { maxRewardPerSessionRupiah: 5_000 }, machine: { maxRewardPerSessionRupiah: 20_000 } })).toBe(5_000);
    expect(resolveSessionCeiling({ campaign: { maxRewardPerSessionRupiah: null }, machine: { maxRewardPerSessionRupiah: 20_000 } })).toBe(20_000);
    expect(resolveSessionCeiling({ campaign: null, machine: { maxRewardPerSessionRupiah: 20_000 } })).toBe(20_000);
    expect(resolveSessionCeiling({ campaign: null, machine: { maxRewardPerSessionRupiah: null } })).toBeNull();
    // A zero (or negative) cap is "not configured": it falls through, and a zero everywhere is null.
    expect(resolveSessionCeiling({ campaign: { maxRewardPerSessionRupiah: 0 }, machine: { maxRewardPerSessionRupiah: 20_000 } })).toBe(20_000);
    expect(resolveSessionCeiling({ campaign: { maxRewardPerSessionRupiah: -5 }, machine: { maxRewardPerSessionRupiah: 20_000 } })).toBe(20_000);
    expect(resolveSessionCeiling({ campaign: null, machine: { maxRewardPerSessionRupiah: 0 } })).toBeNull();
    expect(resolveSessionCeiling({ campaign: { maxRewardPerSessionRupiah: 0 }, machine: { maxRewardPerSessionRupiah: 0 } })).toBeNull();
    expect(configuredCap(1)).toBe(1);
    expect(configuredCap(0)).toBeNull();
    expect(configuredCap(null)).toBeNull();
    expect(configuredCap(1.5)).toBeNull();
    expect(effectiveMultiplier(null)).toBe(1);
    expect(effectiveMultiplier(0)).toBe(1);
    expect(effectiveMultiplier(1.5)).toBe(1.5);
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
  const live = {
    status: "ACTIVE", rewardMode: "MONEY_REWARD", campaignType: "MACHINE_DEPOSIT", supportsMachine: false,
    maxRewardPerSessionRupiah: null, rewardBudgetRupiah: 50_000,
  };
  it("under enforcement, an ACTIVE money program at machines needs its per-session ceiling (at least Rp1)", () => {
    expect(() => assertMoneyProgramConfigured(live, { enforced: true })).toThrow(SESSION_CEILING_NOT_CONFIGURED);
    expect(() => assertMoneyProgramConfigured({ ...live, maxRewardPerSessionRupiah: 0 }, { enforced: true })).toThrow(SESSION_CEILING_NOT_CONFIGURED);
    expect(() => assertMoneyProgramConfigured({ ...live, maxRewardPerSessionRupiah: 1 }, { enforced: true })).not.toThrow();
    expect(() => assertMoneyProgramConfigured({ ...live, campaignType: "EVENT", supportsMachine: true }, { enforced: true })).toThrow();
    // Programs that never run at machines, inactive or compliance-only programs, and shadow mode: never refused.
    expect(() => assertMoneyProgramConfigured({ ...live, campaignType: "EVENT" }, { enforced: true })).not.toThrow();
    expect(() => assertMoneyProgramConfigured({ ...live, campaignType: "TRASH_BAG" }, { enforced: true })).not.toThrow();
    expect(() => assertMoneyProgramConfigured({ ...live, status: "DRAFT" }, { enforced: true })).not.toThrow();
    expect(() => assertMoneyProgramConfigured({ ...live, rewardMode: "COMPLIANCE_ONLY" }, { enforced: true })).not.toThrow();
    expect(() => assertMoneyProgramConfigured(live, { enforced: false })).not.toThrow();
  });

  it("under enforcement, every ACTIVE money program needs a budget of at least Rp1; null is never unlimited (C1)", () => {
    const configured = { ...live, maxRewardPerSessionRupiah: 1_000 };
    for (const type of ["MACHINE_DEPOSIT", "TRASH_BAG", "TOURISM_PROGRAM", "EVENT"]) {
      expect(() => assertMoneyProgramConfigured({ ...configured, campaignType: type, rewardBudgetRupiah: null }, { enforced: true }))
        .toThrow(CAMPAIGN_BUDGET_REQUIRED_FOR_ACTIVATION);
      expect(() => assertMoneyProgramConfigured({ ...configured, campaignType: type, rewardBudgetRupiah: 0 }, { enforced: true }))
        .toThrow(CAMPAIGN_BUDGET_REQUIRED_FOR_ACTIVATION);
      expect(() => assertMoneyProgramConfigured({ ...configured, campaignType: type, rewardBudgetRupiah: 1 }, { enforced: true })).not.toThrow();
    }
    expect(() => assertMoneyProgramConfigured({ ...configured, rewardBudgetRupiah: null, status: "PAUSED" }, { enforced: true })).not.toThrow();
    expect(() => assertMoneyProgramConfigured({ ...configured, rewardBudgetRupiah: null }, { enforced: false })).not.toThrow();
  });
});

describe("evidence keys and the funding cutover", () => {
  it("every cash-confirming entry shares one trimmed, case-insensitive reference space; reversals have their own (C2, C4)", () => {
    expect(normalizeFundingReference(" bank-001 ")).toBe("BANK-001");
    expect(fundingCashKey("BANK-001")).toBe("cash:BANK-001");
    expect(fundingCashKey(" bank-001 ")).toBe("cash:BANK-001");
    expect(fundingCorrectionKey("Bank-001")).toBe("correction:BANK-001");
    const race = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "6", meta: { modelName: "FundingEntry", target: ["businessKey"] } });
    expect(isFundingReferenceConflict(race)).toBe(true);
    expect(isFundingReferenceConflict(new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002", clientVersion: "6", meta: { modelName: "RewardLedger", target: ["businessKey"] } }))).toBe(true);
    expect(isFundingReferenceConflict(new Prisma.PrismaClientKnownRequestError("other", {
      code: "P2002", clientVersion: "6", meta: { modelName: "Redemption", target: ["userId", "idempotencyKey"] } }))).toBe(false);
    expect(isFundingReferenceConflict(new Error("x"))).toBe(false);
  });

  it("the effective modes follow campaignType and supportsMachine, not only rewardMode (I2-a)", () => {
    const money = { rewardMode: "MONEY_REWARD", rewardMultiplier: null, supportsMachine: false };
    expect(effectiveProgramModes({ ...money, campaignType: "TRASH_BAG" })).toEqual({ trips: true, machines: false });
    expect(effectiveProgramModes({ ...money, campaignType: "TOURISM_PROGRAM" })).toEqual({ trips: true, machines: false });
    expect(effectiveProgramModes({ ...money, campaignType: "MACHINE_DEPOSIT" })).toEqual({ trips: false, machines: true });
    expect(effectiveProgramModes({ ...money, campaignType: "EVENT" })).toEqual({ trips: false, machines: false });
    expect(effectiveProgramModes({ ...money, campaignType: "EVENT", supportsMachine: true })).toEqual({ trips: false, machines: true });
    expect(effectiveProgramModes({ ...money, campaignType: "TRASH_BAG", rewardMode: "COMPLIANCE_ONLY" })).toEqual({ trips: false, machines: false });
  });

  it("resolves the funding cutover as the earlier of the explicit setting and the applied migration, failing closed (C3)", async () => {
    const reader = () => ({ $queryRaw: vi.fn() });
    const finishedAt = new Date("2026-10-14T15:00:00.000Z");
    const withMigration = () => {
      const db = reader();
      db.$queryRaw.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([{ finishedAt }]);
      return db;
    };
    const db = withMigration();
    expect(await resolveFundingCutover(db as never, {})).toEqual({ at: finishedAt, source: "migration" });
    expect(db.$queryRaw.mock.calls[1][1]).toBe(REWARD_FUNDING_MIGRATION);
    expect(REWARD_FUNDING_MIGRATION).toBe("20261014150000_reward_funding");

    // A setting later than the migration never widens the legacy window: the migration wins.
    expect(await resolveFundingCutover(withMigration() as never, { [FUNDING_CUTOVER_ENV]: "2026-10-20T00:00:00Z" }))
      .toEqual({ at: finishedAt, source: "migration" });
    // An earlier setting narrows it.
    expect(await resolveFundingCutover(withMigration() as never, { [FUNDING_CUTOVER_ENV]: "2026-10-10T00:00:00Z" }))
      .toEqual({ at: new Date("2026-10-10T00:00:00.000Z"), source: "env" });
    // Setting only (migration not applied), unparsable setting (closed, even with a migration), nothing.
    const notApplied = reader();
    notApplied.$queryRaw.mockResolvedValueOnce([{ present: true }]).mockResolvedValueOnce([]);
    expect(await resolveFundingCutover(notApplied as never, { [FUNDING_CUTOVER_ENV]: "2026-10-10T00:00:00Z" }))
      .toEqual({ at: new Date("2026-10-10T00:00:00.000Z"), source: "env" });
    const invalid = withMigration();
    expect(await resolveFundingCutover(invalid as never, { [FUNDING_CUTOVER_ENV]: "bukan-tanggal" }))
      .toEqual({ at: null, source: "env-invalid" });
    expect(invalid.$queryRaw).not.toHaveBeenCalled();
    const missing = reader();
    missing.$queryRaw.mockResolvedValueOnce([{ present: false }]);
    expect(await resolveFundingCutover(missing as never, {})).toEqual({ at: null, source: "migration-missing" });
  });
});

describe("classifyHold (stale-hold monitoring)", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  const row = {
    id: "res1", businessKey: "session:s1:admission", organizationId: "org1", userId: "u1", campaignId: null,
    sourceType: "SESSION" as const, sourceId: "s1", sourceStatus: "ACTIVE", ceilingRupiah: 20_000, remainingRupiah: 15_000,
    shortfallRupiah: 0, campaignShortfallRupiah: 0, lateReservation: false, createdAt: new Date(now.getTime() - 5 * 60_000),
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
    // A source admitted without a reservation (I2) is told apart from a configured zero ceiling, for sessions and trips.
    const late = classifyHold({ ...row, ceilingRupiah: 0, remainingRupiah: 0, lateReservation: true }, now)!;
    expect(late.reasons).toEqual(["ADMITTED_WITHOUT_RESERVATION"]);
    expect(late.reconciliation).toMatch(/tanpa reservasi/);
    expect(classifyHold({ ...row, sourceType: "TRIP", ceilingRupiah: 0, remainingRupiah: 0, lateReservation: true }, now)?.reasons)
      .toEqual(["ADMITTED_WITHOUT_RESERVATION"]);
  });
});
