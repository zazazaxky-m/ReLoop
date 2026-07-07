import { describe, expect, it, vi, beforeEach } from "vitest";
import * as mfa from "@/lib/mfa";
import { prisma } from "@/lib/prisma";
import { generateTotpCode, generateTotpSecret } from "@/lib/totp";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe("lib/mfa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects privileged roles", () => {
    expect(mfa.isPrivilegedRole("ADMIN")).toBe(true);
    expect(mfa.isPrivilegedRole("SUPERADMIN")).toBe(true);
    expect(mfa.isPrivilegedRole("USER")).toBe(false);
  });

  it("requires MFA at login only when enabled for privileged roles", () => {
    expect(mfa.requiresMfaAtLogin("ADMIN", true)).toBe(true);
    expect(mfa.requiresMfaAtLogin("ADMIN", false)).toBe(false);
    expect(mfa.requiresMfaAtLogin("USER", true)).toBe(false);
  });

  it("issues and verifies MFA challenge tokens", async () => {
    const token = await mfa.signMfaChallenge("user-1");
    const verified = await mfa.verifyMfaChallenge(token);
    expect(verified).toEqual({ userId: "user-1" });
  });

  it("verifies login MFA codes against stored secret", async () => {
    const secret = generateTotpSecret();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: secret,
      mfaEnabled: true,
      status: "ACTIVE",
    } as never);

    const code = generateTotpCode(secret);
    await expect(mfa.verifyMfaLoginCode("user-1", code)).resolves.toBe(true);
  });
});
