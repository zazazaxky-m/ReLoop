import { describe, expect, it, vi, afterEach } from "vitest";

describe("lib/totp", () => {
  afterEach(() => {
    vi.doUnmock("node:crypto");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("generates and verifies a TOTP code", async () => {
    const { generateTotpSecret, generateTotpCode, verifyTotpCode } = await import("@/lib/totp");
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it("reports the time step a code matched within the window (RFC 6238 replay checks)", async () => {
    const { findTotpStep, generateTotpCode, generateTotpSecret } = await import("@/lib/totp");
    const secret = generateTotpSecret();
    const now = 1_791_900_015_000; // mid-step
    const step = Math.floor(now / 30_000);
    expect(findTotpStep(secret, generateTotpCode(secret, now), { timestampMs: now })).toBe(step);
    expect(findTotpStep(secret, generateTotpCode(secret, now - 30_000), { timestampMs: now })).toBe(step - 1);
    expect(findTotpStep(secret, generateTotpCode(secret, now + 30_000), { timestampMs: now })).toBe(step + 1);
    expect(findTotpStep(secret, generateTotpCode(secret, now + 60_000), { timestampMs: now })).toBeNull();
    expect(findTotpStep(secret, "12ab56", { timestampMs: now })).toBeNull();
  });

  it("rejects invalid codes", async () => {
    const { generateTotpSecret, verifyTotpCode } = await import("@/lib/totp");
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "000000")).toBe(false);
    expect(verifyTotpCode(secret, "abc")).toBe(false);
  });

  it("uses explicit window and timestampMs options", async () => {
    const { generateTotpSecret, generateTotpCode, verifyTotpCode } = await import("@/lib/totp");
    const secret = generateTotpSecret();
    const ts = 1_700_000_000_000;
    const code = generateTotpCode(secret, ts);
    expect(verifyTotpCode(secret, code, { window: 0, timestampMs: ts })).toBe(true);
    expect(verifyTotpCode(secret, code, { window: 0, timestampMs: ts + 60_000 })).toBe(false);
  });

  it("encodes secrets when leftover base32 bits remain", async () => {
    // 1 byte => (8 % 5) leftover bits in base32Encode padding branch.
    vi.resetModules();
    vi.doMock("node:crypto", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:crypto")>();
      return {
        ...actual,
        randomBytes: () => Buffer.from([0xab]),
      };
    });
    const { generateTotpSecret, generateTotpCode } = await import("@/lib/totp");
    const secret = generateTotpSecret();
    expect(secret.length).toBeGreaterThan(0);
    expect(generateTotpCode(secret)).toHaveLength(6);
  });
});
