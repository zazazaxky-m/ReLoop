import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as verify } from "@/app/api/auth/mfa/verify/route";
import { GET as adminUsers } from "@/app/api/users/route";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as ws } from "@/app/api/internal/ws-session/route";
import { signMfaChallenge } from "@/lib/mfa";
import { verifySessionToken } from "@/lib/auth";
import { requireApiUser } from "@/lib/rbac";
import { generateTotpCode } from "@/lib/totp";
import { SignJWT } from "jose";

const state = vi.hoisted(() => ({ cookie: "", issued: "", user: {} as Record<string, unknown>, available: true }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: () => state.cookie ? { value: state.cookie } : undefined,
  set: (name: string, value: string) => { if (name === "reloop_session") state.issued = value; },
}) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: async () => state.user } } }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: async () => ({ allowed: state.available, unavailable: !state.available }) }));
const secret = "JBSWY3DPEHPK3PXP";
const req = (body: unknown) => new NextRequest("http://localhost/api/auth/mfa/verify", {
  method: "POST", body: JSON.stringify(body),
});
async function complete(challengeToken: string, code = generateTotpCode(secret)) {
  return verify(req({ challengeToken, code }));
}
beforeEach(async () => {
  state.cookie = ""; state.issued = ""; state.available = true;
  state.user = { id: "admin-1", email: "admin@example.com", name: "Admin", role: "ADMIN",
    status: "ACTIVE", organizationId: null, tokenVersion: 0, mfaEnabled: true,
    totpSecret: secret, passwordHash: "$2a$04$Rnuw53joWdW8suLO1tAAdeacn0dT.G4zfQBmfSCG/lALzoNSluA82" };
  process.env.REALTIME_INTERNAL_SECRET = "internal-test";
});

afterEach(() => vi.unstubAllEnvs());

describe("real JWT and route boundaries", () => {
  it("login at version zero issues a challenge that cannot authorize me or admin, then TOTP issues a session", async () => {
    // Generate a real bcrypt fixture without mocking the auth library.
    const bcrypt = await import("bcryptjs");
    state.user.passwordHash = await bcrypt.hash("correct-password", 4);
    const response = await login(req({ email: "admin@example.com", password: "correct-password" }));
    expect(response.status).toBe(200);
    const { challengeToken, requiresMfa } = await response.json();
    expect(requiresMfa).toBe(true);
    expect(state.issued).toBe("");
    state.cookie = challengeToken;
    expect((await me()).status).toBe(401);
    expect((await adminUsers(new Request("http://localhost/api/users"))).status).toBe(401);
    await expect(requireApiUser(["ADMIN"])).rejects.toMatchObject({ status: 401 });
    expect((await complete(challengeToken)).status).toBe(200);
    expect(await verifySessionToken(state.issued)).toMatchObject({ sub: "admin-1", role: "ADMIN", tokenVersion: 0 });
  });
  it("allows only one concurrent successful completion and rejects replay", async () => {
    const token = await signMfaChallenge("admin-1", 0);
    const responses = await Promise.all([complete(token), complete(token)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 401]);
    expect((await complete(token)).status).toBe(401);
  });
  it("does not consume a challenge for an invalid code", async () => {
    const token = await signMfaChallenge("admin-1", 0);
    const badCode = (Number(generateTotpCode(secret)) + 123) % 1000000;
    expect((await complete(token, String(badCode).padStart(6, "0"))).status).toBe(401);
    expect((await complete(token)).status).toBe(200);
  });
  it("rejects a password-reset version before consuming the challenge", async () => {
    const token = await signMfaChallenge("admin-1", 0);
    state.user.tokenVersion = 1;
    expect((await complete(token)).status).toBe(401);
    expect(state.issued).toBe("");
  });
  it("rejects an account suspended during the challenge", async () => {
    const token = await signMfaChallenge("admin-1", 0);
    state.user.status = "SUSPENDED";
    expect((await complete(token)).status).toBeGreaterThanOrEqual(400);
    expect(state.issued).toBe("");
  });
  it("returns 503 on rate-limit infrastructure failure", async () => {
    state.available = false;
    expect((await complete(await signMfaChallenge("admin-1", 0))).status).toBe(503);
    expect(state.issued).toBe("");
  });
  it("returns 503 rather than issuing a session when production challenge storage is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_JWT_SECRET", "production-test-secret"); vi.stubEnv("REDIS_URL", "");
    expect((await complete(await signMfaChallenge("admin-1", 0))).status).toBe(503);
    expect(state.issued).toBe("");
  });
  it("denies challenge and legacy JWTs at the live websocket verifier", async () => {
    const legacy = await new SignJWT({ sub: "admin-1", role: "ADMIN", tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET || "dev-insecure-secret-change-me"));
    for (const token of [await signMfaChallenge("admin-1", 0), legacy]) {
      const request = req({ token }); request.headers.set("authorization", "Bearer internal-test");
      expect(await (await ws(request)).json()).toEqual({ role: null });
    }
  });
});
