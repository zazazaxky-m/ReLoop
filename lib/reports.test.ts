import { describe, expect, it } from "vitest";
import { toCsv } from "@/lib/csv";
import { isRewardableCondition, generateBagQrCode } from "@/lib/trip";

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
});
