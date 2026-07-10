import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { isRewardableCondition, generateBagQrCode, computeTrashBagRewardAmount, requiresTravelAgent, canManuallySetTripStatus, canValidateTripStage } from "@/lib/trip";

describe("toCsv", () => {
  it("emits a header and rows", () => {
    const csv = toCsv(
      [{ a: "x", b: 1 }],
      [
        { key: "a", header: "A" },
        { key: "b", header: "B" },
      ],
    );
    expect(csv).toBe("A,B\r\nx,1");
  });

  it("escapes commas, quotes, and newlines", () => {
    const csv = toCsv(
      [{ name: 'He said "hi", ok\nnext' }],
      [{ key: "name", header: "Name" }],
    );
    expect(csv).toBe('Name\r\n"He said ""hi"", ok\nnext"');
  });

  it("returns just the header for empty rows", () => {
    expect(toCsv([], [{ key: "a", header: "A" }])).toBe("A");
  });
});

describe("trash bag helpers", () => {
  it("rewards only good/partial conditions", () => {
    expect(isRewardableCondition("GOOD")).toBe(true);
    expect(isRewardableCondition("PARTIAL")).toBe(true);
    expect(isRewardableCondition("POOR")).toBe(false);
    expect(isRewardableCondition("NOT_RETURNED")).toBe(false);
    expect(isRewardableCondition(null)).toBe(false);
  });

  it("generates unique BAG- prefixed QR codes", () => {
    const a = generateBagQrCode();
    const b = generateBagQrCode();
    expect(a).toMatch(/^BAG-[0-9A-F]{12}$/);
    expect(a).not.toBe(b);
  });

  it("requires travel agent only for tourism programs", () => {
    expect(requiresTravelAgent("TOURISM_PROGRAM")).toBe(true);
    expect(requiresTravelAgent("TRASH_BAG")).toBe(false);
    expect(requiresTravelAgent("MACHINE_DEPOSIT")).toBe(false);
  });

  it("applies campaign multiplier and compliance to trash bag reward", () => {
    expect(
      computeTrashBagRewardAmount({
        rewardableBagCount: 2,
        complianceScore: 100,
        rewardMultiplier: 1,
      }),
    ).toBe(4000);
    expect(
      computeTrashBagRewardAmount({
        rewardableBagCount: 2,
        complianceScore: 50,
        rewardMultiplier: 1.5,
      }),
    ).toBe(3000);
    expect(
      computeTrashBagRewardAmount({
        rewardableBagCount: 0,
        complianceScore: 100,
      }),
    ).toBe(0);
  });

  it("guards manual trip status transitions", () => {
    expect(canManuallySetTripStatus("PLANNED", "CANCELLED").ok).toBe(true);
    expect(canManuallySetTripStatus("CANCELLED", "PLANNED").ok).toBe(true);
    expect(canManuallySetTripStatus("PLANNED", "COMPLETED").ok).toBe(false);
    expect(canManuallySetTripStatus("ACTIVE", "COMPLETED").ok).toBe(false);
  });

  it("guards validation stages against trip status", () => {
    expect(canValidateTripStage("PLANNED", "CHECK_IN").ok).toBe(true);
    expect(canValidateTripStage("PLANNED", "CHECK_OUT").ok).toBe(false);
    expect(canValidateTripStage("ACTIVE", "CHECK_OUT").ok).toBe(true);
    expect(canValidateTripStage("COMPLETED", "CHECK_OUT").ok).toBe(false);
    expect(canValidateTripStage("COMPLETED", "BANK_SAMPAH_PICKUP").ok).toBe(true);
  });
});
