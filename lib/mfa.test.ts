import bcrypt from "bcryptjs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as auth from "@/lib/auth";
import * as mfa from "@/lib/mfa";
import { prisma } from "@/lib/prisma";
import { generateTotpCode, generateTotpSecret } from "@/lib/totp";
import { decrypt, encrypt, isEncrypted } from "@/lib/encryption";

/** The TransactionClient handed to runWalletTransaction callbacks. */
const tx = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  user: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)),
  },
}));

// Real bcrypt, observable: proves when the password is (not) checked.
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, verifyPassword: vi.fn(actual.verifyPassword) };
});

const PASSWORD = "Correct-Horse-Battery-1";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
const sessionFields = { id: "u1", email: "a@example.com", name: "A", role: "ADMIN", organizationId: null };

const STEP_MS = 30_000;
/** A code of `secret` at `at` and the RFC 6238 time step it belongs to. */
function codeAt(secret: string, at = Date.now()) {
  return { code: generateTotpCode(secret, at), step: Math.floor(at / STEP_MS) };
}

/** A six-digit code that is not the current one. */
function otherCode(code: string) {
  return String((Number(code) + 500_000) % 1_000_000).padStart(6, "0");
}

function lockedBeforeRead() {
  expect(tx.$queryRaw).toHaveBeenCalledTimes(1); // lockUser: SELECT ... FOR NO KEY UPDATE
  expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.user.findUniqueOrThrow.mock.invocationCallOrder[0]);
}

describe("lib/mfa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: "u1" }]);
    tx.user.update.mockResolvedValue({ ...sessionFields, tokenVersion: 4 });
  });


  it("creates distinct challenge IDs and rejects sessions as challenges", async () => {
    const { signSession } = await import("./auth");
    const first = await mfa.verifyMfaChallenge(await mfa.signMfaChallenge("u1", 3));
    const second = await mfa.verifyMfaChallenge(await mfa.signMfaChallenge("u1", 3));
    expect(first?.challengeId).not.toBe(second?.challengeId);
    expect(first?.tokenVersion).toBe(3);
    expect(first?.expiresAt).toBeGreaterThan(Date.now() / 1000);
    expect(await mfa.verifyMfaChallenge(await signSession({ sub: "u1", email: "a@b.c", name: "A",
      role: "ADMIN", organizationId: null, tokenVersion: 3 }))).toBeNull();
  });

  it.each([
    ["legacy", { iss: undefined, aud: undefined, tokenVersion: undefined, jti: undefined }],
    ["wrong audience", { aud: "reloop-session" }], ["wrong issuer", { iss: "other" }],
    ["missing version", { tokenVersion: undefined }], ["string version", { tokenVersion: "0" }],
    ["missing ID", { jti: undefined }], ["invalid ID", { jti: "" }],
    ["missing issued time", { iat: undefined }], ["missing expiry", { exp: undefined }],
    ["expired", { exp: 1 }], ["missing subject", { sub: undefined }],
  ])("rejects %s MFA claims", async (_label, overrides) => {
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ purpose: "mfa", sub: "u1", tokenVersion: 0,
      jti: "c62e78bf-dd8c-4a96-ae50-e8e50eebfa80", iss: "reloop", aud: "reloop-mfa",
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60, ...overrides })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET || "dev-insecure-secret-change-me"));
    expect(await mfa.verifyMfaChallenge(token)).toBeNull();
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
    const token = await mfa.signMfaChallenge("user-1", 0);
    const verified = await mfa.verifyMfaChallenge(token);
    expect(verified).toMatchObject({ userId: "user-1", tokenVersion: 0, challengeId: expect.any(String), expiresAt: expect.any(Number) });
  });

  it("verifies login MFA codes against stored secret and records the step with a conditional update", async () => {
    const secret = generateTotpSecret();
    const sealed = encrypt(secret);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: sealed,
      mfaEnabled: true,
      status: "ACTIVE",
      totpLastUsedStep: null,
    } as never);
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 1 } as never);

    const { code, step } = codeAt(secret);
    await expect(mfa.verifyMfaLoginCode("user-1", code)).resolves.toBe(true);
    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: "user-1", mfaEnabled: true, status: "ACTIVE", totpSecret: sealed,
        OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }],
      },
      data: { totpLastUsedStep: step },
    });
  });

  it("rejects a login code whose step was already used (RFC 6238 single use)", async () => {
    const secret = generateTotpSecret();
    const { code, step } = codeAt(secret);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: encrypt(secret), mfaEnabled: true, status: "ACTIVE", totpLastUsedStep: step,
    } as never);

    await expect(mfa.verifyMfaLoginCode("user-1", code)).resolves.toBe(false);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a login code when a concurrent verifier recorded the step first", async () => {
    const secret = generateTotpSecret();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: encrypt(secret), mfaEnabled: true, status: "ACTIVE", totpLastUsedStep: null,
    } as never);
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 0 } as never);

    await expect(mfa.verifyMfaLoginCode("user-1", codeAt(secret).code)).resolves.toBe(false);
  });

  describe("beginMfaSetup", () => {
    it("starts a first setup with the password only and writes nothing but the pending fields", async () => {
      tx.user.findUniqueOrThrow.mockResolvedValue({
        status: "ACTIVE", passwordHash: PASSWORD_HASH, mfaEnabled: false, totpSecret: null, tokenVersion: 3,
      });
      const before = Date.now();

      const result = await mfa.beginMfaSetup("u1", "a@example.com", { currentPassword: PASSWORD });

      lockedBeforeRead();
      expect(result.replacement).toBe(false);
      expect(result.otpauthUrl).toContain(encodeURIComponent("a@example.com"));
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + mfa.MFA_PENDING_TTL_MS);
      expect(mfa.MFA_PENDING_TTL_MS).toBe(600_000);
      const { data } = tx.user.update.mock.calls[0][0];
      expect(Object.keys(data).sort()).toEqual(["pendingTotpExpiresAt", "pendingTotpSecret", "pendingTotpTokenVersion"]);
      expect(isEncrypted(data.pendingTotpSecret)).toBe(true);
      expect(decrypt(data.pendingTotpSecret)).toBe(result.secret);
      expect(data.pendingTotpExpiresAt).toEqual(result.expiresAt);
      expect(data.pendingTotpTokenVersion).toBe(3);
    });

    it("replaces an active factor only with password and a current code, leaving it active", async () => {
      const active = generateTotpSecret();
      tx.user.findUniqueOrThrow.mockResolvedValue({
        status: "ACTIVE", passwordHash: PASSWORD_HASH, mfaEnabled: true, totpSecret: encrypt(active), tokenVersion: 7,
        totpLastUsedStep: null,
      });

      const proof = codeAt(active);
      const result = await mfa.beginMfaSetup("u1", "a@example.com",
        { currentPassword: PASSWORD, currentCode: proof.code });

      expect(result.replacement).toBe(true);
      expect(result.secret).not.toBe(active);
      expect(JSON.stringify(result)).not.toContain(active);
      const { data } = tx.user.update.mock.calls[0][0];
      expect(data).not.toHaveProperty("totpSecret");
      expect(data).not.toHaveProperty("mfaEnabled");
      expect(data.pendingTotpTokenVersion).toBe(7);
      // The proof code is used up in the same update.
      expect(data.totpLastUsedStep).toBe(proof.step);
    });

    it("fails closed when the last used step was not read (undefined is not 'none used')", async () => {
      const active = generateTotpSecret();
      tx.user.findUniqueOrThrow.mockResolvedValue({
        status: "ACTIVE", passwordHash: PASSWORD_HASH, mfaEnabled: true, totpSecret: encrypt(active), tokenVersion: 0,
      });
      await expect(mfa.beginMfaSetup("u1", "a@example.com", { currentPassword: PASSWORD, currentCode: generateTotpCode(active) }))
        .rejects.toMatchObject({ status: 400 });
    });

    it("rejects a proof code whose step was already used (e.g. the login code), writing nothing", async () => {
      const active = generateTotpSecret();
      const proof = codeAt(active);
      tx.user.findUniqueOrThrow.mockResolvedValue({
        status: "ACTIVE", passwordHash: PASSWORD_HASH, mfaEnabled: true, totpSecret: encrypt(active),
        tokenVersion: 0, totpLastUsedStep: proof.step,
      });

      await expect(mfa.beginMfaSetup("u1", "a@example.com", { currentPassword: PASSWORD, currentCode: proof.code }))
        .rejects.toMatchObject({ status: 400 });
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it("requires the current code while MFA is active, before checking the password", async () => {
      tx.user.findUniqueOrThrow.mockResolvedValue({
        status: "ACTIVE", passwordHash: PASSWORD_HASH, mfaEnabled: true, totpSecret: encrypt(generateTotpSecret()), tokenVersion: 0,
      });

      await expect(mfa.beginMfaSetup("u1", "a@example.com", { currentPassword: PASSWORD }))
        .rejects.toMatchObject({ status: 422 });
      // No password oracle for a session without the TOTP.
      expect(auth.verifyPassword).not.toHaveBeenCalled();
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it("answers a wrong password and a wrong code with the same 400, writing nothing", async () => {
      const active = generateTotpSecret();
      tx.user.findUniqueOrThrow.mockResolvedValue({
        status: "ACTIVE", passwordHash: PASSWORD_HASH, mfaEnabled: true, totpSecret: encrypt(active), tokenVersion: 0,
        totpLastUsedStep: null,
      });
      const code = generateTotpCode(active);

      const wrongPassword = mfa.beginMfaSetup("u1", "a@example.com", { currentPassword: "wrong", currentCode: code });
      await expect(wrongPassword).rejects.toBeInstanceOf(mfa.MfaProofError);
      await expect(wrongPassword).rejects.toMatchObject({ status: 400, message: "Password atau kode MFA tidak valid" });
      await expect(mfa.beginMfaSetup("u1", "a@example.com", { currentPassword: PASSWORD, currentCode: otherCode(code) }))
        .rejects.toMatchObject({ status: 400, message: "Password atau kode MFA tidak valid" });
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it("rejects a wrong password on first setup, an undecryptable active factor and inactive accounts", async () => {
      tx.user.findUniqueOrThrow.mockResolvedValueOnce({
        status: "ACTIVE", passwordHash: PASSWORD_HASH, mfaEnabled: false, totpSecret: null, tokenVersion: 0,
      });
      await expect(mfa.beginMfaSetup("u1", "a@example.com", { currentPassword: "wrong" }))
        .rejects.toMatchObject({ status: 400, message: "Password saat ini tidak sesuai" });

      tx.user.findUniqueOrThrow.mockResolvedValueOnce({
        status: "ACTIVE", passwordHash: PASSWORD_HASH, mfaEnabled: true,
        totpSecret: "000000000000000000000000:00000000000000000000000000000000:deadbeef", tokenVersion: 0,
      });
      await expect(mfa.beginMfaSetup("u1", "a@example.com", { currentPassword: PASSWORD, currentCode: "123456" }))
        .rejects.toMatchObject({ status: 400 });

      tx.user.findUniqueOrThrow.mockResolvedValueOnce({
        status: "SUSPENDED", passwordHash: PASSWORD_HASH, mfaEnabled: false, totpSecret: null, tokenVersion: 0,
      });
      await expect(mfa.beginMfaSetup("u1", "a@example.com", { currentPassword: PASSWORD }))
        .rejects.toMatchObject({ status: 403 });
      expect(tx.user.update).not.toHaveBeenCalled();
    });
  });

  describe("enableMfa", () => {
    const pendingRow = (secret: string, overrides: Record<string, unknown> = {}) => ({
      status: "ACTIVE", mfaEnabled: true, tokenVersion: 4,
      pendingTotpSecret: encrypt(secret), pendingTotpExpiresAt: new Date(Date.now() + 60_000), pendingTotpTokenVersion: 4,
      ...overrides,
    });

    it("promotes the pending secret atomically and increments tokenVersion", async () => {
      const pending = generateTotpSecret();
      const row = pendingRow(pending);
      tx.user.findUniqueOrThrow.mockResolvedValue(row);
      tx.user.update.mockResolvedValue({ ...sessionFields, tokenVersion: 5 });

      const confirm = codeAt(pending);
      const result = await mfa.enableMfa("u1", confirm.code);

      lockedBeforeRead();
      expect(result).toEqual({ ok: true, replaced: true, user: { ...sessionFields, tokenVersion: 5 } });
      expect(tx.user.update).toHaveBeenCalledTimes(1);
      expect(tx.user.update.mock.calls[0][0]).toMatchObject({
        where: { id: "u1" },
        data: {
          totpSecret: row.pendingTotpSecret, mfaEnabled: true,
          pendingTotpSecret: null, pendingTotpExpiresAt: null,
          pendingTotpTokenVersion: null, tokenVersion: { increment: 1 },
          // The new factor's confirm code is its first used code.
          totpLastUsedStep: confirm.step,
        },
      });
    });

    it("reports a first enable as not replaced", async () => {
      const pending = generateTotpSecret();
      tx.user.findUniqueOrThrow.mockResolvedValue(pendingRow(pending, { mfaEnabled: false }));
      await expect(mfa.enableMfa("u1", generateTotpCode(pending))).resolves.toMatchObject({ ok: true, replaced: false });
    });

    it("keeps the pending setup on a wrong code", async () => {
      const pending = generateTotpSecret();
      tx.user.findUniqueOrThrow.mockResolvedValue(pendingRow(pending));
      await expect(mfa.enableMfa("u1", otherCode(generateTotpCode(pending))))
        .resolves.toEqual({ ok: false, reason: "invalid_code" });
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it.each([
      ["expired", { pendingTotpExpiresAt: new Date(Date.now() - 1) }],
      ["stale", { pendingTotpTokenVersion: 3 }],
    ])("discards an %s pending setup even with the right code", async (reason, overrides) => {
      const pending = generateTotpSecret();
      tx.user.findUniqueOrThrow.mockResolvedValue(pendingRow(pending, overrides));
      await expect(mfa.enableMfa("u1", generateTotpCode(pending))).resolves.toEqual({ ok: false, reason });
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: mfa.PENDING_MFA_CLEARED });
    });

    it("refuses without a pending setup and discards an undecryptable one", async () => {
      tx.user.findUniqueOrThrow.mockResolvedValueOnce(pendingRow(generateTotpSecret(), {
        pendingTotpSecret: null, pendingTotpExpiresAt: null, pendingTotpTokenVersion: null,
      }));
      await expect(mfa.enableMfa("u1", "123456")).resolves.toEqual({ ok: false, reason: "no_pending" });
      expect(tx.user.update).not.toHaveBeenCalled();

      tx.user.findUniqueOrThrow.mockResolvedValueOnce(pendingRow(generateTotpSecret(), {
        pendingTotpSecret: "000000000000000000000000:00000000000000000000000000000000:deadbeef",
      }));
      await expect(mfa.enableMfa("u1", "123456")).resolves.toEqual({ ok: false, reason: "no_pending" });
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: mfa.PENDING_MFA_CLEARED });
    });

    it("rejects inactive accounts", async () => {
      tx.user.findUniqueOrThrow.mockResolvedValue(pendingRow(generateTotpSecret(), { status: "SUSPENDED" }));
      await expect(mfa.enableMfa("u1", "123456")).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("disableMfa", () => {
    it("needs password and a code of the active factor, then clears everything and increments tokenVersion", async () => {
      const active = generateTotpSecret();
      tx.user.findUniqueOrThrow.mockResolvedValue({
        status: "ACTIVE", passwordHash: PASSWORD_HASH, mfaEnabled: true, totpSecret: encrypt(active), totpLastUsedStep: null,
      });
      tx.user.update.mockResolvedValue({ ...sessionFields, tokenVersion: 9 });

      const result = await mfa.disableMfa("u1", { currentPassword: PASSWORD, code: generateTotpCode(active) });

      lockedBeforeRead();
      expect(result).toEqual({ ok: true, user: { ...sessionFields, tokenVersion: 9 } });
      expect(tx.user.update.mock.calls[0][0]).toMatchObject({
        where: { id: "u1" },
        data: {
          mfaEnabled: false, totpSecret: null, totpLastUsedStep: null, ...mfa.PENDING_MFA_CLEARED,
          tokenVersion: { increment: 1 },
        },
      });
    });

    it("rejects a disable proof code whose step was already used", async () => {
      const active = generateTotpSecret();
      const proof = codeAt(active);
      tx.user.findUniqueOrThrow.mockResolvedValue({
        status: "ACTIVE", passwordHash: PASSWORD_HASH, mfaEnabled: true, totpSecret: encrypt(active),
        totpLastUsedStep: proof.step,
      });
      await expect(mfa.disableMfa("u1", { currentPassword: PASSWORD, code: proof.code }))
        .resolves.toEqual({ ok: false, reason: "invalid_proof" });
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it("rejects a wrong password or code and a disabled factor without writing", async () => {
      const active = generateTotpSecret();
      const row = { status: "ACTIVE", passwordHash: PASSWORD_HASH, mfaEnabled: true, totpSecret: encrypt(active), totpLastUsedStep: null };
      tx.user.findUniqueOrThrow.mockResolvedValue(row);
      const code = generateTotpCode(active);

      await expect(mfa.disableMfa("u1", { currentPassword: "wrong", code })).resolves.toEqual({ ok: false, reason: "invalid_proof" });
      await expect(mfa.disableMfa("u1", { currentPassword: PASSWORD, code: otherCode(code) }))
        .resolves.toEqual({ ok: false, reason: "invalid_proof" });
      tx.user.findUniqueOrThrow.mockResolvedValue({ ...row, mfaEnabled: false, totpSecret: null });
      await expect(mfa.disableMfa("u1", { currentPassword: PASSWORD, code })).resolves.toEqual({ ok: false, reason: "not_enabled" });
      expect(tx.user.update).not.toHaveBeenCalled();
    });
  });

  describe("cancelMfaSetup", () => {
    it("clears only the pending fields when a setup is pending", async () => {
      tx.user.findUniqueOrThrow.mockResolvedValueOnce({ pendingTotpSecret: encrypt(generateTotpSecret()) });
      await expect(mfa.cancelMfaSetup("u1")).resolves.toBe(true);
      lockedBeforeRead();
      expect(tx.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: mfa.PENDING_MFA_CLEARED });

      tx.user.update.mockClear();
      tx.user.findUniqueOrThrow.mockResolvedValueOnce({ pendingTotpSecret: null });
      await expect(mfa.cancelMfaSetup("u1")).resolves.toBe(false);
      expect(tx.user.update).not.toHaveBeenCalled();
    });
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

  it("rejects login verification when the encrypted secret cannot be decrypted", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      totpSecret: "000000000000000000000000:00000000000000000000000000000000:deadbeef",
      mfaEnabled: true,
      status: "ACTIVE",
    } as never);

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
      await expect(mfa.signMfaChallenge("u1", 0)).rejects.toThrow(
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
      const token = await mfa.signMfaChallenge("user-x", 0);
      const verified = await mfa.verifyMfaChallenge(token);
      expect(verified).toMatchObject({ userId: "user-x", tokenVersion: 0, challengeId: expect.any(String), expiresAt: expect.any(Number) });
    } finally {
      process.env.AUTH_JWT_SECRET = prev;
    }
  });
});
