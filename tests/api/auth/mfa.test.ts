import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as disableMfaPost } from "@/app/api/auth/mfa/disable/route";
import { POST as enableMfaPost } from "@/app/api/auth/mfa/enable/route";
import { DELETE as setupMfaDelete, POST as setupMfaPost } from "@/app/api/auth/mfa/setup/route";
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

vi.mock("@/lib/mfa", async () => ({
  MfaChallengeStoreUnavailable: class extends Error {},
  // Like the real one: an HttpError(400), so handleApiError answers with its message.
  MfaProofError: class MfaProofError extends (await import("@/lib/rbac")).HttpError {
    constructor(message: string) {
      super(400, message);
    }
  },
  consumeMfaChallenge: vi.fn(),
  beginMfaSetup: vi.fn(),
  cancelMfaSetup: vi.fn(),
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
  buildSessionPayload: vi.fn((user) => ({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion })),
  setSessionCookie: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));

const admin = { id: "admin-1", email: "admin@example.com", role: "ADMIN" };
const sessionUser = { id: "admin-1", email: "admin@example.com", name: "Admin", role: "ADMIN" as const,
  organizationId: "org-1", tokenVersion: 4 };
const PASSWORD = "Correct-Horse-Battery-1";
const CODE = "482913";

function req(body: unknown, ip = "127.0.0.1", method = "POST") {
  return new Request("http://localhost/api/auth/mfa", {
    method,
    headers: { "x-forwarded-for": ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Everything written to the audit log in this test, as text. */
function auditText() {
  return JSON.stringify(vi.mocked(audit.logAudit).mock.calls);
}

describe("MFA API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mfa.consumeMfaChallenge).mockResolvedValue(true);
    vi.mocked(rbac.requireApiUser).mockResolvedValue(admin as never);
    vi.mocked(mfa.isPrivilegedRole).mockReturnValue(true);
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({ allowed: true, remaining: 4, resetAt: 0 });
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
    expect((await setupMfaPost(req({ currentPassword: PASSWORD }))).status).toBe(500);
  });

  it("returns handled error when MFA disable throws", async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValueOnce(new Error("disable boom"));
    expect((await disableMfaPost(req({ currentPassword: PASSWORD, code: CODE }))).status).toBe(500);
  });

  it("starts a replacement with fresh proof and returns only the new pending secret", async () => {
    const expiresAt = new Date("2026-10-14T03:10:00.000Z");
    vi.mocked(mfa.beginMfaSetup).mockResolvedValue({
      secret: "NEWSECRET", otpauthUrl: "otpauth://totp/x", replacement: true, expiresAt,
    });

    const res = await setupMfaPost(req({ currentPassword: PASSWORD, currentCode: CODE }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      secret: "NEWSECRET", qrDataUrl: "data:image/png;base64,qr", replacement: true,
      expiresAt: "2026-10-14T03:10:00.000Z",
    });
    expect(rateLimit.checkRateLimit).toHaveBeenCalledWith("mfa-setup:admin-1:127.0.0.1", 5, 900_000);
    expect(mfa.beginMfaSetup).toHaveBeenCalledWith("admin-1", "admin@example.com",
      { currentPassword: PASSWORD, currentCode: CODE });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "MFA_SETUP_STARTED", metadata: { ip: "127.0.0.1", replacement: true },
    }));
    expect(auditText()).not.toContain(CODE);
    expect(auditText()).not.toContain(PASSWORD);
    expect(auditText()).not.toContain("NEWSECRET");
  });

  it.each([
    ["no body", undefined],
    ["an empty body", {}],
    ["a non-digit code", { currentPassword: PASSWORD, currentCode: "12ab56" }],
  ])("rejects setup with %s before touching MFA (422)", async (_label, body) => {
    const res = await setupMfaPost(req(body));
    expect(res.status).toBe(422);
    expect(mfa.beginMfaSetup).not.toHaveBeenCalled();
  });

  it("audits a wrong password/code during setup without the secret, code or password", async () => {
    vi.mocked(mfa.beginMfaSetup).mockRejectedValue(new (mfa as any).MfaProofError("Password atau kode MFA tidak valid"));

    const res = await setupMfaPost(req({ currentPassword: PASSWORD, currentCode: CODE }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ error: "Password atau kode MFA tidak valid" });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "MFA_SETUP_PROOF_FAILED", metadata: { ip: "127.0.0.1" },
    }));
    expect(auditText()).not.toContain(CODE);
    expect(auditText()).not.toContain(PASSWORD);
  });

  it("rejects setup for non-privileged users", async () => {
    vi.mocked(mfa.isPrivilegedRole).mockReturnValue(false);

    const res = await setupMfaPost(req({ currentPassword: PASSWORD }));

    expect(res.status).toBe(403);
    expect(mfa.beginMfaSetup).not.toHaveBeenCalled();
  });

  it.each([
    ["setup", () => setupMfaPost(req({ currentPassword: PASSWORD, currentCode: CODE })), "mfa-setup:admin-1:10.0.0.9"],
    ["enable", () => enableMfaPost(req({ code: CODE })), "mfa-enable:admin-1:10.0.0.9"],
    ["disable", () => disableMfaPost(req({ currentPassword: PASSWORD, code: CODE })), "mfa-disable:admin-1:10.0.0.9"],
  ])("rate-limits %s per user and IP: 429 when exhausted, 503 when the limiter is down", async (_label, call, key) => {
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 });
    const limited = await (call as () => Promise<Response>)();
    expect(limited.status).toBe(429);

    vi.mocked(rateLimit.checkRateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0, unavailable: true });
    const unavailable = await (call as () => Promise<Response>)();
    expect(unavailable.status).toBe(503);

    expect(vi.mocked(rateLimit.checkRateLimit).mock.calls.map(([k]) => k)).toEqual([
      key.replace("10.0.0.9", "127.0.0.1"), key.replace("10.0.0.9", "127.0.0.1"),
    ]);
    expect(mfa.beginMfaSetup).not.toHaveBeenCalled();
    expect(mfa.enableMfa).not.toHaveBeenCalled();
    expect(mfa.disableMfa).not.toHaveBeenCalled();
  });

  it("keys the MFA rate limits by the client IP as well as the user", async () => {
    vi.mocked(mfa.enableMfa).mockResolvedValue({ ok: false, reason: "invalid_code" });
    await enableMfaPost(req({ code: CODE }, "10.0.0.9"));
    expect(rateLimit.checkRateLimit).toHaveBeenCalledWith("mfa-enable:admin-1:10.0.0.9", 10, 300_000);
  });

  it("confirms a replacement, re-issues the requester's session at the new version and audits it", async () => {
    vi.mocked(mfa.enableMfa).mockResolvedValue({ ok: true, user: { ...sessionUser, tokenVersion: 5 }, replaced: true });

    const res = await enableMfaPost(req({ code: CODE }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ replaced: true });
    expect(mfa.enableMfa).toHaveBeenCalledWith("admin-1", CODE);
    expect(auth.setSessionCookie).toHaveBeenCalledWith({ sub: "admin-1", role: "ADMIN", tokenVersion: 5 });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MFA_REPLACED" }));
    expect(auditText()).not.toContain(CODE);
  });

  it("audits a first enable as MFA_ENABLED", async () => {
    vi.mocked(mfa.enableMfa).mockResolvedValue({ ok: true, user: { ...sessionUser, tokenVersion: 1 }, replaced: false });

    expect((await enableMfaPost(req({ code: CODE }))).status).toBe(200);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MFA_ENABLED" }));
  });

  it("rejects a wrong confirm code (400) and a missing, expired or stale setup (409) without a new session", async () => {
    vi.mocked(mfa.enableMfa).mockResolvedValueOnce({ ok: false, reason: "invalid_code" });
    expect((await enableMfaPost(req({ code: CODE }))).status).toBe(400);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MFA_ENABLE_FAILED" }));

    for (const reason of ["no_pending", "expired", "stale"] as const) {
      vi.mocked(mfa.enableMfa).mockResolvedValueOnce({ ok: false, reason });
      const res = await enableMfaPost(req({ code: CODE }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/Mulai setup ulang/);
    }
    expect((await enableMfaPost(req({ code: "bad" }))).status).toBe(422);
    expect(auth.setSessionCookie).not.toHaveBeenCalled();
    expect(auditText()).not.toContain(CODE);
  });

  it("disables MFA with password and code and re-issues the requester's session", async () => {
    vi.mocked(mfa.disableMfa).mockResolvedValue({ ok: true, user: { ...sessionUser, tokenVersion: 5 } });

    const res = await disableMfaPost(req({ currentPassword: PASSWORD, code: CODE }));

    expect(res.status).toBe(200);
    expect(mfa.disableMfa).toHaveBeenCalledWith("admin-1", { currentPassword: PASSWORD, code: CODE });
    expect(auth.setSessionCookie).toHaveBeenCalledWith({ sub: "admin-1", role: "ADMIN", tokenVersion: 5 });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MFA_DISABLED" }));
    expect(auditText()).not.toContain(CODE);
    expect(auditText()).not.toContain(PASSWORD);
  });

  it("rejects disable without a password, with a wrong proof or when MFA is off", async () => {
    expect((await disableMfaPost(req({ code: CODE }))).status).toBe(422);

    vi.mocked(mfa.disableMfa).mockResolvedValueOnce({ ok: false, reason: "invalid_proof" });
    const wrong = await disableMfaPost(req({ currentPassword: PASSWORD, code: CODE }));
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "Password atau kode MFA tidak valid" });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MFA_DISABLE_FAILED" }));

    vi.mocked(mfa.disableMfa).mockResolvedValueOnce({ ok: false, reason: "not_enabled" });
    expect((await disableMfaPost(req({ currentPassword: PASSWORD, code: CODE }))).status).toBe(409);
    expect(auth.setSessionCookie).not.toHaveBeenCalled();
  });

  it("cancels only the pending setup and audits it when one existed", async () => {
    vi.mocked(mfa.cancelMfaSetup).mockResolvedValueOnce(true);
    const res = await setupMfaDelete(req(undefined, "127.0.0.1", "DELETE"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ cancelled: true });
    expect(mfa.cancelMfaSetup).toHaveBeenCalledWith("admin-1");
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: "MFA_SETUP_CANCELLED" }));

    vi.mocked(audit.logAudit).mockClear();
    vi.mocked(mfa.cancelMfaSetup).mockResolvedValueOnce(false);
    const none = await setupMfaDelete(req(undefined, "127.0.0.1", "DELETE"));
    expect(await none.json()).toMatchObject({ cancelled: false });
    expect(audit.logAudit).not.toHaveBeenCalled();
    expect(auth.setSessionCookie).not.toHaveBeenCalled();
  });

  it("returns handled error when MFA cancel throws", async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValueOnce(new Error("cancel boom"));
    expect((await setupMfaDelete(req(undefined, "127.0.0.1", "DELETE"))).status).toBe(500);
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
    expect(auth.setSessionCookie).toHaveBeenCalledWith({ sub: "admin-1", role: "ADMIN", tokenVersion: 0 });
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
