import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, PATCH } from "@/app/api/auth/me/route";
import { POST as verifyPasswordPost } from "@/app/api/auth/verify-password/route";
import * as audit from "@/lib/audit";
import * as auth from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import * as rateLimit from "@/lib/rate-limit";
import * as rbac from "@/lib/rbac";

vi.mock("@/lib/prisma", () => {
  const user = { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() };
  // runWalletTransaction's client: lockUser's SELECT ... FOR NO KEY UPDATE, then the same user mocks.
  const tx = { $executeRaw: vi.fn(async () => 0), $queryRaw: vi.fn(async () => [{ id: "u1" }]), user };
  return { prisma: { user, $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) } };
});

vi.mock("@/lib/rbac", () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

vi.mock("@/lib/auth", () => ({
  buildSessionPayload: vi.fn((user) => ({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion })),
  hashPassword: vi.fn(),
  setSessionCookie: vi.fn(),
  verifyPassword: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));

const sessionUser = { id: "u1", email: "old@example.com", role: "USER" };
const dbUser = {
  id: "u1",
  email: "old@example.com",
  name: "Old",
  phone: null,
  role: "USER",
  organizationId: null,
  tokenVersion: 0,
  passwordHash: "hash",
};

function req(body: unknown) {
  return new NextRequest("http://localhost/api/auth/me", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("auth profile routes", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(rbac.requireApiUser).mockResolvedValue(sessionUser as never);
    // Re-read under the User lock: the password verified above is still current.
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ passwordHash: "hash" } as never);
    vi.mocked(auth.buildSessionPayload).mockImplementation((user) => ({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      tokenVersion: user.tokenVersion,
    }));
  });

  it("returns the session user and refreshes the cookie from DB", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: sessionUser });
    expect(auth.setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ sub: "u1", role: "USER", tokenVersion: 0 }));
  });

  it("skips cookie refresh when DB user is missing on GET", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(auth.setSessionCookie).not.toHaveBeenCalled();
  });

  it("returns handled error when GET auth fails", async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValueOnce(new Error("get boom"));
    expect((await GET()).status).toBe(500);
  });

  it("updates basic profile fields without requiring password", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
    vi.mocked(prisma.user.update).mockResolvedValue({ ...dbUser, name: "New", phone: "123" } as never);

    const res = await PATCH(req({ name: " New ", phone: " 123 " }));

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { name: "New", phone: "123" },
    }));
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "PROFILE_UPDATE" }));
  });

  it("clears blank phone to null", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
    vi.mocked(prisma.user.update).mockResolvedValue({ ...dbUser, phone: null } as never);

    const res = await PATCH(req({ phone: "   " }));
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { phone: null } }),
    );
  });

  it("rejects password change when passwordHash is missing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...dbUser,
      passwordHash: null,
    } as never);

    const res = await PATCH(req({ newPassword: "Password123!xy", currentPassword: "x" }));
    expect(res.status).toBe(401);
  });

  it("uses empty string when currentPassword is omitted during email change", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
    vi.mocked(auth.verifyPassword).mockResolvedValue(false);

    const res = await PATCH(req({ email: "new@example.com" }));
    expect(res.status).toBe(401);
    expect(auth.verifyPassword).toHaveBeenCalledWith("", "hash");
  });

  it("rejects profile changes for missing users", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    expect((await PATCH(req({ name: "New" }))).status).toBe(404);
  });

  it("requires current password for email or password changes", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
    vi.mocked(auth.verifyPassword).mockResolvedValue(false);

    expect((await PATCH(req({ email: "new@example.com", currentPassword: "bad" }))).status).toBe(401);
  });

  it("refuses an email change to the reserved erased-account domain", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
    vi.mocked(auth.verifyPassword).mockResolvedValue(true);

    const res = await PATCH(req({ email: "erased-u2@invalid.reloop", currentPassword: "ok" }));
    expect(res.status).toBe(422);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("rejects duplicate email changes", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(dbUser as never)
      .mockResolvedValueOnce({ id: "other" } as never);
    vi.mocked(auth.verifyPassword).mockResolvedValue(true);

    expect((await PATCH(req({ email: "new@example.com", currentPassword: "ok" }))).status).toBe(409);
  });

  it("updates email and password after current password verification", async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(dbUser as never)
      .mockResolvedValueOnce(null);
    vi.mocked(auth.verifyPassword).mockResolvedValue(true);
    vi.mocked(auth.hashPassword).mockResolvedValue("new-hash");
    vi.mocked(prisma.user.update).mockResolvedValue({
      ...dbUser,
      email: "new@example.com",
      tokenVersion: 1,
      passwordHash: "new-hash",
    } as never);

    const res = await PATCH(req({
      email: "New@Example.com",
      currentPassword: "ok",
      newPassword: "Password123!xy",
    }));

    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: "new@example.com", passwordHash: "new-hash" }),
    }));
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "PROFILE_AND_PASSWORD_UPDATE" }));
  });

  it("a password change discards a pending MFA setup under the User lock", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
    vi.mocked(auth.verifyPassword).mockResolvedValue(true);
    vi.mocked(auth.hashPassword).mockResolvedValue("new-hash");
    vi.mocked(prisma.user.update).mockResolvedValue({ ...dbUser, tokenVersion: 1, passwordHash: "new-hash" } as never);

    const res = await PATCH(req({ currentPassword: "ok", newPassword: "Password123!xy" }));

    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: {
        passwordHash: "new-hash", tokenVersion: { increment: 1 },
        pendingTotpSecret: null, pendingTotpExpiresAt: null, pendingTotpTokenVersion: null,
      },
      select: expect.objectContaining({ id: true, tokenVersion: true }),
    });
    expect(auth.setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ tokenVersion: 1 }));
  });

  it("refuses a credential change when the password changed after it was verified", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
    vi.mocked(auth.verifyPassword).mockResolvedValue(true);
    vi.mocked(prisma.user.findUniqueOrThrow).mockResolvedValue({ passwordHash: "changed-meanwhile" } as never);

    const res = await PATCH(req({ currentPassword: "ok", newPassword: "Password123!xy" }));

    expect(res.status).toBe(409);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("selects and returns only profile fields, never secrets, pending MFA, emailLookup or passwordHash", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
    // Even if the row came back with every column, only the allowlist leaves.
    vi.mocked(prisma.user.update).mockResolvedValue({
      ...dbUser, name: "New", status: "ACTIVE", payoutEligible: true, createdAt: new Date(0), updatedAt: new Date(0),
      emailLookup: "lookup-hmac", totpSecret: "iv:tag:active", pendingTotpSecret: "iv:tag:pending",
      pendingTotpExpiresAt: new Date(0), pendingTotpTokenVersion: 0, totpLastUsedStep: 1, mfaEnabled: true,
      authProvider: "CREDENTIALS",
    } as never);

    const res = await PATCH(req({ name: "New" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body.user).sort()).toEqual([
      "createdAt", "email", "id", "name", "organizationId", "payoutEligible", "phone", "role", "status", "updatedAt",
    ]);
    const { select } = vi.mocked(prisma.user.update).mock.calls[0][0] as { select: Record<string, boolean> };
    expect(Object.keys(select).sort()).toEqual([
      "createdAt", "email", "id", "name", "organizationId", "payoutEligible", "phone", "role", "status", "tokenVersion", "updatedAt",
    ]);
    expect(auth.setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ tokenVersion: 0 }));
  });

  it("returns handled error when PATCH throws", async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValueOnce(new Error("patch boom"));
    expect((await PATCH(req({ name: "X" }))).status).toBe(500);
  });
});

describe("verify password route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(rbac.requireApiUser).mockResolvedValue(sessionUser as never);
    vi.mocked(auth.buildSessionPayload).mockImplementation((user) => ({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      organizationId: user.organizationId,
      tokenVersion: user.tokenVersion,
    }));
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({ allowed: true } as never);
  });

  it("rate limits password verification", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({ allowed: false } as never);

    expect((await verifyPasswordPost(req({ password: "secret" }))).status).toBe(429);
  });

  it("rejects missing users and invalid passwords", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    expect((await verifyPasswordPost(req({ password: "secret" }))).status).toBe(404);

    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(dbUser as never);
    vi.mocked(auth.verifyPassword).mockResolvedValue(false);
    expect((await verifyPasswordPost(req({ password: "wrong" }))).status).toBe(401);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "BIOMETRIC_VERIFY_FAILED" }));
  });

  it("accepts valid passwords", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(dbUser as never);
    vi.mocked(auth.verifyPassword).mockResolvedValue(true);

    const res = await verifyPasswordPost(req({ password: "secret" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ valid: true });
  });

  it("returns handled error when verify throws", async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValueOnce(new Error("verify boom"));
    expect((await verifyPasswordPost(req({ password: "secret" }))).status).toBe(500);
  });
});
