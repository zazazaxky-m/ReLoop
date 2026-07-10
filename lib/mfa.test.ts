import { describe, expect, it, vi, beforeEach } from "vitest";
import * as mfa from "@/lib/mfa";
import { prisma } from "@/lib/prisma";
import { generateTotpCode, generateTotpSecret } from "@/lib/totp";
import { encrypt } from "@/lib/encryption";

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

  it("begins MFA setup and stores encrypted secret", async () => {
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "u1" } as never);
    const result = await mfa.beginMfaSetup("u1", "a@example.com");
    expect(result.secret).toBeDefined();
    expect(result.otpauthUrl).toContain(encodeURIComponent("a@example.com"));
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: expect.objectContaining({ mfaEnabled: false }),
    });
  });

  it("enables MFA with valid code", async () => {
    const secret = generateTotpSecret();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: encrypt(secret),
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "u1" } as never);

    const code = generateTotpCode(secret);
    await expect(mfa.enableMfa("u1", code)).resolves.toBe(true);
  });

  it("does not enable MFA with invalid code", async () => {
    const secret = generateTotpSecret();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: encrypt(secret),
    } as never);

    await expect(mfa.enableMfa("u1", "000000")).resolves.toBe(false);
  });

  it("disables MFA with valid code", async () => {
    const secret = generateTotpSecret();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: encrypt(secret),
      mfaEnabled: true,
    } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({ id: "u1" } as never);

    const code = generateTotpCode(secret);
    await expect(mfa.disableMfa("u1", code)).resolves.toBe(true);
  });

  it("returns true when disabling MFA that is already disabled", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: null,
      mfaEnabled: false,
    } as never);

    await expect(mfa.disableMfa("u1", "000000")).resolves.toBe(true);
  });

  it("returns MFA status", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN",
      mfaEnabled: true,
    } as never);

    const status = await mfa.getMfaStatus("u1");
    expect(status).toEqual({
      role: "ADMIN",
      mfaEnabled: true,
      requiredForRole: true,
    });
  });

  it("returns null status when user not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);
    await expect(mfa.getMfaStatus("u1")).resolves.toBeNull();
  });

  it("handles corrupted encrypted totp secret gracefully", async () => {
    // Valid encrypted format starts with ENC:, so isEncrypted returns true, but decrypt throws
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: "ENC:bad-data",
      mfaEnabled: true,
      status: "ACTIVE",
    } as never);
    await expect(mfa.verifyMfaLoginCode("user-1", "000000")).resolves.toBe(false);
  });

  it("returns null for invalid or corrupted MFA challenge tokens", async () => {
    // jwtVerify throws error
    const verified = await mfa.verifyMfaChallenge("invalid.jwt.token");
    expect(verified).toBeNull();
  });

  it("returns null if MFA challenge token has wrong purpose", async () => {
    // We sign a token with wrong purpose
    const { SignJWT } = await import("jose");
    const getJwtSecret = () => new TextEncoder().encode(process.env.AUTH_JWT_SECRET || "dev-insecure-secret-change-me");
    const wrongToken = await new SignJWT({ purpose: "other", sub: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(getJwtSecret());
      
    const verified = await mfa.verifyMfaChallenge(wrongToken);
    expect(verified).toBeNull();
  });

  it("returns null when MFA challenge token has no subject", async () => {
    const { SignJWT } = await import("jose");
    const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET || "dev-insecure-secret-change-me");
    const token = await new SignJWT({ purpose: "mfa" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(secret);
    await expect(mfa.verifyMfaChallenge(token)).resolves.toBeNull();
  });

  it("rejects enable/disable/verify when encrypted secret cannot be decrypted", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: "000000000000000000000000:00000000000000000000000000000000:deadbeef",
      mfaEnabled: true,
      status: "ACTIVE",
    } as never);

    await expect(mfa.enableMfa("u1", "123456")).resolves.toBe(false);
    await expect(mfa.disableMfa("u1", "123456")).resolves.toBe(false);
    await expect(mfa.verifyMfaLoginCode("u1", "123456")).resolves.toBe(false);
  });

  it("rejects verify when MFA is disabled or user inactive", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: "plain-secret",
      mfaEnabled: false,
      status: "ACTIVE",
    } as never);
    await expect(mfa.verifyMfaLoginCode("u1", "123456")).resolves.toBe(false);

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: "plain-secret",
      mfaEnabled: true,
      status: "SUSPENDED",
    } as never);
    await expect(mfa.verifyMfaLoginCode("u1", "123456")).resolves.toBe(false);
  });

  it("rejects verify when totpSecret is missing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: null,
      mfaEnabled: true,
      status: "ACTIVE",
    } as never);
    await expect(mfa.verifyMfaLoginCode("u1", "123456")).resolves.toBe(false);
  });

  it("throws in production when AUTH_JWT_SECRET is insecure", async () => {
    const prevSecret = process.env.AUTH_JWT_SECRET;
    const prevEnv = process.env.NODE_ENV;
    process.env.AUTH_JWT_SECRET = "dev-insecure-secret-change-me";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      await expect(mfa.signMfaChallenge("u1")).rejects.toThrow(
        "AUTH_JWT_SECRET must be set in production",
      );
    } finally {
      process.env.AUTH_JWT_SECRET = prevSecret;
      (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
    }
  });

  it("signs MFA challenge with a configured AUTH_JWT_SECRET", async () => {
    const prev = process.env.AUTH_JWT_SECRET;
    process.env.AUTH_JWT_SECRET = "configured-mfa-secret";
    try {
      const token = await mfa.signMfaChallenge("user-x");
      const verified = await mfa.verifyMfaChallenge(token);
      expect(verified).toEqual({ userId: "user-x" });
    } finally {
      process.env.AUTH_JWT_SECRET = prev;
    }
  });
});
