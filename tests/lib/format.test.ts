import { describe, expect, it } from "vitest";
import {
  formatRupiah,
  formatNumber,
  formatDateTime,
  formatDate,
  timeAgo,
} from "@/lib/format";

describe("format", () => {
  it("formats rupiah and numbers", () => {
    expect(formatRupiah(1500)).toContain("1.500");
    expect(formatNumber(12345)).toContain("12.345");
  });

  it("formatDateTime handles null, string, and Date", () => {
    expect(formatDateTime(null)).toBe("-");
    expect(formatDateTime(undefined)).toBe("-");
    expect(formatDateTime("2024-01-15T10:30:00.000Z")).not.toBe("-");
    expect(formatDateTime(new Date("2024-01-15T10:30:00.000Z"))).not.toBe("-");
  });

  it("formatDate handles null, string, and Date", () => {
    expect(formatDate(null)).toBe("-");
    expect(formatDate(undefined)).toBe("-");
    expect(formatDate("2024-06-01T00:00:00.000Z")).not.toBe("-");
    expect(formatDate(new Date("2024-06-01T00:00:00.000Z"))).not.toBe("-");
  });

  it("timeAgo covers all buckets", () => {
    expect(timeAgo(null)).toBe("-");
    expect(timeAgo(undefined)).toBe("-");

    const now = Date.now();
    expect(timeAgo(new Date(now - 10_000))).toContain("detik");
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString())).toContain("menit");
    expect(timeAgo(new Date(now - 3 * 3_600_000))).toContain("jam");
    expect(timeAgo(new Date(now - 2 * 86_400_000))).toContain("hari");
  });
});
