import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as disableMfaPost } from "@/app/api/auth/mfa/disable/route";
import { POST as enableMfaPost } from "@/app/api/auth/mfa/enable/route";
import { POST as setupMfaPost } from "@/app/api/auth/mfa/setup/route";
import { GET as statusMfaGet } from "@/app/api/auth/mfa/status/route";
import { POST as verifyMfaPost } from "@/app/api/auth/mfa/verify/route";
import * as audit from "@/lib/audit";
import * as auth from "@/lib/auth";
import * as mfa from "@/lib/mfa";
import { prisma } from "@/lib/prisma";
import * as rateLimit from "@/lib/rate-limit";
import * as rbac from "@/lib/rbac";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/rbac", () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

vi.mock("@/lib/mfa", () => ({
  MfaChallengeStoreUnavailable: class extends Error {},
  consumeMfaChallenge: vi.fn(),
  beginMfaSetup: vi.fn(),
  disableMfa: vi.fn(),
  enableMfa: vi.fn(),
  getMfaStatus: vi.fn(),
  isPrivilegedRole: vi.fn(),
  verifyMfaChallenge: vi.fn(),
  verifyMfaLoginCode: vi.fn(),
}));

vi.mock("@/lib/qr", () => ({ qrDataUrl: vi.fn().mockResolvedValue("data:image/png;base64,qr") }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  buildSessionPayload: vi.fn((user) => ({ sub: user.id, role: user.role })),
  setSessionCookie: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));

const admin = { id: "admin-1", email: "admin@example.com", role: "ADMIN" };

function req(body: unknown, ip = "127.0.0.1") {
  return new Request("http://localhost/api/auth/mfa", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

describe("MFA API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mfa.consumeMfaChallenge).mockResolvedValue(true);
    vi.mocked(rbac.requireApiUser).mockResolvedValue(admin as never);
  });

  it("returns MFA status or the disabled default", async () => {
    vi.mocked(mfa.getMfaStatus).mockResolvedValue(null);
    expect(await (await statusMfaGet()).json()).toEqual({ mfaEnabled: false, requiredForRole: false });

    vi.mocked(mfa.getMfaStatus).mockResolvedValue({ role: "ADMIN", mfaEnabled: true, requiredForRole: true });
    expect(await (await statusMfaGet()).json()).toEqual({ role: "ADMIN", mfaEnabled: true, requiredForRole: true });
  });

  it("returns handled error when MFA status lookup fails", async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValueOnce(new (rbac as any).HttpError(403, "Forbidden"));
    expect((await statusMfaGet()).status).toBe(403);
  });

  it("returns handled error when MFA setup throws", async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValueOnce(new Error("setup boom"));
    expect((await setupMfaPost()).status).toBe(500);
  });

  it("returns handled error when MFA disable throws", async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValueOnce(new Error("disable boom"));
    expect((await disableMfaPost(req({ code: "123456" }))).status).toBe(500);
  });

  it("starts MFA setup for privileged users", async () => {
    vi.mocked(mfa.isPrivilegedRole).mockReturnValue(true);
    vi.mocked(mfa.beginMfaSetup).mockResolvedValue({ secret: "secret", otpauthUrl: "otpauth://totp/x" });

    const res = await setupMfaPost();

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ secret: "secret", qrDataUrl: "data:image/png;base64,qr" });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MFA_SETUP_STARTED" }));
  });

  it("rejects setup for non-privileged users", async () => {
    vi.mocked(mfa.isPrivilegedRole).mockReturnValue(false);

    const res = await setupMfaPost();

    expect(res.status).toBe(403);
  });

  it("enables and disables MFA when the code is valid", async () => {
    vi.mocked(mfa.enableMfa).mockResolvedValue(true);
    vi.mocked(mfa.disableMfa).mockResolvedValue(true);

    expect((await enableMfaPost(req({ code: "123456" }))).status).toBe(200);
    expect((await disableMfaPost(req({ code: "123456" }))).status).toBe(200);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MFA_ENABLED" }));
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MFA_DISABLED" }));
  });

  it("rejects invalid enable and disable codes", async () => {
    vi.mocked(mfa.enableMfa).mockResolvedValue(false);
    vi.mocked(mfa.disableMfa).mockResolvedValue(false);

    expect((await enableMfaPost(req({ code: "123456" }))).status).toBe(400);
    expect((await disableMfaPost(req({ code: "123456" }))).status).toBe(400);
    expect((await enableMfaPost(req({ code: "bad" }))).status).toBe(422);
  });

  it("rate-limits MFA verification", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({ allowed: false } as never);

    const res = await verifyMfaPost(req({ challengeToken: "token", code: "123456" }));

    expect(res.status).toBe(429);
  });

  it("rejects expired and invalid MFA verification challenges", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({ allowed: true } as never);
    vi.mocked(mfa.verifyMfaChallenge).mockResolvedValueOnce(null);

    expect((await verifyMfaPost(req({ challengeToken: "token", code: "123456" }))).status).toBe(401);

    vi.mocked(mfa.verifyMfaChallenge).mockResolvedValueOnce({ userId: "admin-1", tokenVersion: 0, challengeId: "challenge-id", expiresAt: 2000000000 });
    vi.mocked(mfa.verifyMfaLoginCode).mockResolvedValue(false);

    expect((await verifyMfaPost(req({ challengeToken: "token", code: "123456" }))).status).toBe(401);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MFA_VERIFY_FAILED" }));
  });

  it("verifies MFA and creates a session for active users", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({ allowed: true } as never);
    vi.mocked(mfa.verifyMfaChallenge).mockResolvedValue({ userId: "admin-1", tokenVersion: 0, challengeId: "challenge-id", expiresAt: 2000000000 });
    vi.mocked(mfa.verifyMfaLoginCode).mockResolvedValue(true);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "admin-1",
      email: "admin@example.com",
      name: "Admin",
      role: "ADMIN",
      organizationId: "org-1",
      tokenVersion: 0,
      mfaEnabled: true,
      status: "ACTIVE",
    } as never);

    const res = await verifyMfaPost(req({ challengeToken: "token", code: "123456" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ redirectTo: "/dashboard/admin" });
    expect(auth.setSessionCookie).toHaveBeenCalledWith({ sub: "admin-1", role: "ADMIN" });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MFA_VERIFY_SUCCESS" }));
  });

  it("rejects MFA verification for inactive accounts", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({ allowed: true } as never);
    vi.mocked(mfa.verifyMfaChallenge).mockResolvedValue({ userId: "admin-1", tokenVersion: 0, challengeId: "challenge-id", expiresAt: 2000000000 });
    vi.mocked(mfa.verifyMfaLoginCode).mockResolvedValue(true);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ status: "SUSPENDED" } as never);

    expect((await verifyMfaPost(req({ challengeToken: "token", code: "123456" }))).status).toBe(403);
  });

  it("returns handled error when MFA verify throws", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockRejectedValue(new Error("verify boom"));
    expect((await verifyMfaPost(req({ challengeToken: "token", code: "123456" }))).status).toBe(500);
  });
});
