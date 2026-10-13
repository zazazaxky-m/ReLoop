import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { signMfaChallenge } from "@/lib/mfa";
import { SignJWT } from "jose";
import { proxy } from "@/proxy";
import { buildSessionPayload, signSession, SESSION_COOKIE } from "@/lib/auth";

async function authedRequest(
  url: string,
  init: ConstructorParameters<typeof NextRequest>[1] = {},
) {
  const token = await signSession(
    buildSessionPayload({
      id: "u1",
      email: "user@test.local",
      name: "User",
      role: "USER",
      organizationId: null,
      tokenVersion: 0,
    }),
  );
  const req = new NextRequest(url, init);
  req.cookies.set(SESSION_COOKIE, token);
  return req;
}

describe("proxy", () => {
  it.each(["/api/auth/me", "/api/users", "/dashboard/admin"])("rejects MFA cookies at %s", async (path) => {
    const req = new NextRequest(`http://localhost${path}`);
    req.cookies.set(SESSION_COOKIE, await signMfaChallenge("admin-1", 0));
    expect((await proxy(req)).status).toBe(path.startsWith("/api") ? 401 : 307);
  });
  it("rejects legacy sessions", async () => {
    const token = await new SignJWT({ sub: "admin-1", role: "ADMIN", tokenVersion: 0 })
      .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET || "dev-insecure-secret-change-me"));
    const req = new NextRequest("http://localhost/api/users");
    req.cookies.set(SESSION_COOKIE, token);
    expect((await proxy(req)).status).toBe(401);
  });
  it("rejects cross-site unsafe API requests even with a valid session", async () => {
    const req = await authedRequest("http://localhost/api/wallet", {
      method: "POST",
      headers: { origin: "https://evil.test" },
    });

    const res = await proxy(req);
    expect(res.status).toBe(403);
  });

  it("allows same-origin unsafe API requests with a valid session", async () => {
    const req = await authedRequest("http://localhost/api/wallet", {
      method: "POST",
      headers: { origin: "http://localhost" },
    });

    const res = await proxy(req);
    expect(res.status).toBe(200);
  });

  it("rejects unauthenticated protected API requests", async () => {
    const res = await proxy(new NextRequest("http://localhost/api/wallet"));
    expect(res.status).toBe(401);
  });

  it("allows public API paths without a session", async () => {
    const res = await proxy(new NextRequest("http://localhost/api/auth/login"));
    expect(res.status).toBe(200);
  });

  it("lets a signed-out owner reach the public deletion forms and the account-deletion confirmation", async () => {
    for (const path of ["/api/account-deletion-requests", "/api/account-deletion-requests/confirm", "/api/data-deletion-requests"]) {
      const res = await proxy(new NextRequest(`http://localhost${path}`, { method: "POST" }));
      expect(res.status).toBe(200);
    }
    // The signed-in erasure endpoint stays behind the session check.
    expect((await proxy(new NextRequest("http://localhost/api/user/data", { method: "DELETE" }))).status).toBe(401);
  });

  it("allows public API prefix paths without a session", async () => {
    const res = await proxy(new NextRequest("http://localhost/api/display/ABC123"));
    expect(res.status).toBe(200);
  });

  it("rejects cross-site unsafe requests via sec-fetch-site", async () => {
    const req = await authedRequest("http://localhost/api/wallet", {
      method: "DELETE",
      headers: { "sec-fetch-site": "cross-site" },
    });
    const res = await proxy(req);
    expect(res.status).toBe(403);
  });

  it("allows dashboard access with a valid session", async () => {
    const req = await authedRequest("http://localhost/dashboard/user");
    const res = await proxy(req);
    expect(res.status).toBe(200);
  });

  it("redirects unauthenticated dashboard requests to login", async () => {
    const res = await proxy(new NextRequest("http://localhost/dashboard/admin"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("passes through non-API non-dashboard paths", async () => {
    const res = await proxy(new NextRequest("http://localhost/about"));
    expect(res.status).toBe(200);
  });

  it("treats invalid session cookies as unauthenticated", async () => {
    const req = new NextRequest("http://localhost/api/wallet");
    req.cookies.set(SESSION_COOKIE, "not.a.valid.jwt");
    const res = await proxy(req);
    expect(res.status).toBe(401);
  });

  it("uses configured AUTH_JWT_SECRET when set", async () => {
    const prev = process.env.AUTH_JWT_SECRET;
    process.env.AUTH_JWT_SECRET = "unit-test-secret-value";
    try {
      // Cookie forces getJwtSecret() so the configured-secret return path runs.
      const req = new NextRequest("http://localhost/api/wallet");
      req.cookies.set(SESSION_COOKIE, "not.a.valid.jwt");
      const res = await proxy(req);
      expect(res.status).toBe(401);
    } finally {
      process.env.AUTH_JWT_SECRET = prev;
    }
  });

  it("treats insecure AUTH_JWT_SECRET as invalid session in production", async () => {
    const prevSecret = process.env.AUTH_JWT_SECRET;
    const prevEnv = process.env.NODE_ENV;
    process.env.AUTH_JWT_SECRET = "dev-insecure-secret-change-me";
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    try {
      // getJwtSecret throws; hasValidSession catches it and returns false → 401.
      const req = new NextRequest("http://localhost/api/wallet");
      req.cookies.set(SESSION_COOKIE, "any.token.value");
      const res = await proxy(req);
      expect(res.status).toBe(401);
    } finally {
      process.env.AUTH_JWT_SECRET = prevSecret;
      (process.env as Record<string, string | undefined>).NODE_ENV = prevEnv;
    }
  });
});
