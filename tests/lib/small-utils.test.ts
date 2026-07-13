import { describe, expect, it, vi } from "vitest";

import { csvResponse, toCsv } from "@/lib/csv";
import { formatDate, formatDateTime, formatNumber, formatRupiah, timeAgo } from "@/lib/format";
import { DEFAULT_HERO_SLIDES, parseHeroSlides } from "@/lib/hero-slides";
import { machineCentroid } from "@/lib/map";
import { parsePageSearchParams } from "@/lib/page-pagination";
import { formatRewardPoints, toRewardPoints } from "@/lib/reward-points";
import { calculateCompliance, normalizeTravelAgentEmail } from "@/lib/tourism";

describe("small utility modules", () => {
  it("formats money, numbers, dates, and relative time", () => {
    vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));

    expect(formatRupiah(12000)).toContain("12.000");
    expect(formatNumber(1234567)).toBe("1.234.567");
    expect(formatDate(null)).toBe("-");
    expect(formatDateTime(undefined)).toBe("-");
    expect(formatDate("2026-01-02T00:00:00.000Z")).toContain("2026");
    expect(formatDateTime(new Date("2026-01-02T00:00:00.000Z"))).toContain("2026");
    expect(timeAgo(null)).toBe("-");
    expect(timeAgo(new Date("2026-01-01T23:59:30.000Z"))).toBe("30 detik lalu");
    expect(timeAgo(new Date("2026-01-01T23:30:00.000Z"))).toBe("30 menit lalu");
    expect(timeAgo(new Date("2026-01-01T21:00:00.000Z"))).toBe("3 jam lalu");
    expect(timeAgo(new Date("2025-12-30T00:00:00.000Z"))).toBe("3 hari lalu");

    vi.useRealTimers();
  });

  it("parses hero slides with fallback, trimming, limits, and URL safety", () => {
    expect(parseHeroSlides()).toBe(DEFAULT_HERO_SLIDES);
    expect(parseHeroSlides("not json")).toBe(DEFAULT_HERO_SLIDES);
    expect(parseHeroSlides(JSON.stringify({}))).toBe(DEFAULT_HERO_SLIDES);
    expect(parseHeroSlides(JSON.stringify([{ title: "", imageUrl: "/x", href: "/" }]))).toBe(DEFAULT_HERO_SLIDES);
    expect(parseHeroSlides(JSON.stringify([{ title: "X", imageUrl: "javascript:x", href: "/" }]))).toBe(DEFAULT_HERO_SLIDES);

    const slides = parseHeroSlides(JSON.stringify([
      { eyebrow: " e ", title: " T ", description: " D ", imageUrl: "", href: "" },
      { title: "bad", imageUrl: "/ok", href: "ftp://bad" },
    ]));

    expect(slides).toEqual([
      { eyebrow: "e", title: "T", description: "D", imageUrl: "/hero-ai-community.webp", href: "" },
    ]);
  });

  it("builds CSV and CSV responses", async () => {
    const csv = toCsv(
      [{ name: "A, B", note: 'say "hi"', empty: null }],
      [
        { key: "name", header: "Name" },
        { key: "note", header: "Note" },
        { key: "empty", header: "Empty" },
      ],
    );

    expect(csv).toBe('Name,Note,Empty\r\n"A, B","say ""hi""",');
    expect(toCsv([], [{ key: "name", header: "Name" }])).toBe("Name");

    const res = csvResponse(csv, "report.csv");
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="report.csv"');
    expect(await res.text()).toBe(csv);
  });

  it("calculates pagination, centroids, rewards, and tourism compliance", () => {
    expect(parsePageSearchParams({ page: "2", limit: "500" }, { maxLimit: 25 })).toEqual({
      page: 2,
      limit: 25,
      skip: 25,
      take: 25,
    });
    expect(parsePageSearchParams({ page: "0", limit: "bad" }, { defaultLimit: 10 })).toEqual({
      page: 1,
      limit: 10,
      skip: 0,
      take: 10,
    });

    expect(machineCentroid([{ latitude: null, longitude: 1 }])).toBeNull();
    expect(machineCentroid([
      { latitude: -6, longitude: 106 },
      { latitude: -8, longitude: 108 },
    ])).toEqual({ latitude: -7, longitude: 107 });

    expect(toRewardPoints(12500, 1000)).toBe(12);
    expect(toRewardPoints(12500, 0)).toBe(0);
    expect(formatRewardPoints(12500, 1000)).toBe("12 poin");

    expect(normalizeTravelAgentEmail(" A@Example.COM ")).toBe("a@example.com");
    expect(calculateCompliance({ stage: "CHECK_IN", appCompleted: true })).toEqual({ score: 30, status: "CHECKED_IN" });
    expect(calculateCompliance({ stage: "BANK_SAMPAH_PICKUP" })).toEqual({ score: 100, status: "COMPLIANT" });
    expect(calculateCompliance({ stage: "CHECK_OUT", appCompleted: true, assignedBagCount: 2, returnedBagCount: 2, conditionStatus: "GOOD" })).toEqual({ score: 100, status: "COMPLIANT" });
    expect(calculateCompliance({ stage: "CHECK_OUT", assignedBagCount: 2, returnedBagCount: 1, conditionStatus: "PARTIAL" })).toEqual({ score: 40, status: "NON_COMPLIANT" });
    expect(calculateCompliance({ stage: "CHECK_OUT", appCompleted: true, assignedBagCount: 0, returnedBagCount: 1 })).toEqual({ score: 70, status: "NEEDS_REVIEW" });
  });

  it("builds security headers correctly", async () => {
    const { buildSecurityHeaders, HSTS_HEADER } = await import("@/lib/security-headers");
    
    // Default without nonce
    const h1 = buildSecurityHeaders();
    expect(h1).toEqual([
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
    ]);

    // With nonce and strict policies (default allowUnsafe options are false)
    const h2 = buildSecurityHeaders({ nonce: "test-nonce" });
    const csp2 = h2.find((h) => h.key === "Content-Security-Policy")?.value;
    expect(csp2).toContain("'nonce-test-nonce'");
    expect(csp2).toContain("script-src 'self' 'nonce-test-nonce' 'strict-dynamic'");
    expect(csp2).toContain("style-src 'self' 'nonce-test-nonce'");
    expect(csp2).not.toContain("'unsafe-eval'");
    expect(csp2).not.toContain("'unsafe-inline'");
    expect(csp2).toContain("connect-src 'self'");
    // No scheme-only wildcards (old: connect-src 'self' ws: wss: https:)
    expect(csp2).not.toContain("ws: wss: https:");
    expect(csp2).not.toMatch(/connect-src[^;]*\shttps:(;|$)/);

    // With unsafe options and HSTS
    const h3 = buildSecurityHeaders({
      nonce: "test-nonce-2",
      allowUnsafeEval: true,
      allowUnsafeInlineStyles: true,
      hsts: true,
    });
    const csp3 = h3.find((h) => h.key === "Content-Security-Policy")?.value;
    expect(csp3).toContain("'unsafe-eval'");
    expect(csp3).toContain("'unsafe-inline'");
    expect(h3).toContainEqual(HSTS_HEADER);
  });
});
