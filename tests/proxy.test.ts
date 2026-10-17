import { afterEach, describe, expect, it, vi } from "vitest";
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
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-robots-tag")).toBeNull();
  });

  it.each(["/accept-invitation", "/verify-email"])(
    "keeps the emailed-token page %s out of Referer headers, indexes and caches (A03)",
    async (path) => {
      const res = await proxy(new NextRequest(`http://localhost${path}`));
      expect(res.status).toBe(200);
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-security-policy")).toContain("script-src 'self' 'nonce-");
    },
  );

  it("requires a session for the invitation accept and email verification APIs (A03)", async () => {
    for (const path of ["/api/travel-agent-invitations/accept", "/api/auth/verify-email", "/api/auth/verify-email/resend"]) {
      const res = await proxy(new NextRequest(`http://localhost${path}`, { method: "POST" }));
      expect(res.status).toBe(401);
    }
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

/**
 * P01: the CSRF Origin check compares the browser's Origin with the configured
 * public origin (NEXT_PUBLIC_BASE_URL), never with request.nextUrl. Next 16
 * builds nextUrl from the server's bind address (the Docker image runs
 * HOSTNAME=0.0.0.0 PORT=3000 behind nginx), so nextUrl.origin is
 * http://0.0.0.0:3000 while a browser sends the public host.
 */
describe("proxy Origin check against the configured public origin (P01)", () => {
  const PUBLIC = "https://reloop.example";
  const BIND = "http://0.0.0.0:3000";
  const api = (base: string) => `${base}/api/notifications`;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function env(nodeEnv: string, baseUrl: string | undefined) {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("AUTH_JWT_SECRET", "p01-unit-test-secret-not-the-dev-default");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", baseUrl);
  }

  async function write(url: string, headers: Record<string, string>, method = "PATCH") {
    return (await proxy(await authedRequest(url, { method, headers }))).status;
  }

  it("accepts a signed-in browser write from the public origin on a server bound to 0.0.0.0", async () => {
    env("production", PUBLIC);
    const logged = vi.spyOn(console, "error");
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(await write(api(BIND), {
        origin: PUBLIC, host: "reloop.example", "x-forwarded-proto": "https", "sec-fetch-site": "same-origin",
      }, method)).toBe(200);
    }
    expect(logged).not.toHaveBeenCalled();
  });

  it("accepts the public origin whatever path or trailing slash the configured base URL has", async () => {
    env("production", "https://reloop.example/");
    expect(await write(api(BIND), { origin: PUBLIC })).toBe(200);
    env("production", "  https://reloop.example/app  ");
    expect(await write(api(BIND), { origin: PUBLIC })).toBe(200);
  });

  it("rejects a foreign Origin with a valid session", async () => {
    env("production", PUBLIC);
    for (const origin of ["https://evil.test", "https://reloop.example.evil.test", "http://reloop.example", "https://reloop.example:8443", "null"]) {
      expect(await write(api(BIND), { origin }), origin).toBe(403);
    }
  });

  it("no longer trusts the server's own bind or loopback origin in production", async () => {
    env("production", PUBLIC);
    for (const origin of [BIND, "http://localhost:3000", "http://127.0.0.1:3000"]) {
      expect(await write(api(BIND), { origin }), origin).toBe(403);
    }
  });

  it("is not satisfied by a spoofed Host or X-Forwarded-Host", async () => {
    env("production", PUBLIC);
    expect(await write(api(BIND), {
      origin: "https://evil.test", host: "evil.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "https",
    })).toBe(403);
    // Even if Next ever built nextUrl from the Host header (trustHostHeader),
    // a request URL on the attacker's host must not make its Origin trusted.
    expect(await write(api("https://evil.test"), { origin: "https://evil.test", host: "evil.test" })).toBe(403);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["unparsable", "reloop.example"],
    ["not http(s)", "ftp://reloop.example"],
    ["javascript:", "javascript:alert(1)"],
  ])("fails closed in production when NEXT_PUBLIC_BASE_URL is %s", async (_label, baseUrl) => {
    env("production", baseUrl);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const origin of [PUBLIC, BIND, "http://localhost:3000"]) {
      expect(await write(api(BIND), { origin }), origin).toBe(403);
    }
    // The misconfiguration is logged (without the client's Origin value).
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("NEXT_PUBLIC_BASE_URL is not configured or invalid"));
    expect(logged.mock.calls.flat().join(" ")).not.toContain("reloop.example");
    // Requests without an Origin are unchanged (SameSite=Lax + Sec-Fetch-Site).
    expect(await write(api(BIND), {})).toBe(200);
  });

  it("leaves requests without an Origin, safe methods and public paths as before", async () => {
    env("production", PUBLIC);
    expect(await write(api(BIND), {})).toBe(200);
    expect(await write(api(BIND), { "sec-fetch-site": "same-origin" })).toBe(200);
    expect(await write(api(BIND), { "sec-fetch-site": "cross-site" })).toBe(403);
    expect(await write(api(BIND), { origin: "https://evil.test" }, "GET")).toBe(200);
    // Non-auth public paths (machines, token-authorized forms) skip the check; the route itself decides.
    expect((await proxy(new NextRequest(`${BIND}/api/machine-events`, { method: "POST", headers: { origin: "https://evil.test" } }))).status).toBe(200);
    // Origin passes, session still required.
    expect((await proxy(new NextRequest(api(BIND), { method: "PATCH", headers: { origin: PUBLIC } }))).status).toBe(401);
  });

  it("refuses cross-site writes to the browser auth endpoints (login CSRF)", async () => {
    env("production", PUBLIC);
    const post = async (path: string, headers: Record<string, string>) =>
      (await proxy(new NextRequest(`${BIND}${path}`, { method: "POST", headers }))).status;
    for (const path of [
      "/api/auth/login",
      "/api/auth/register",
      "/api/auth/mfa/verify",
      "/api/auth/logout",
      "/api/auth/forgot-password",
      "/api/auth/reset-password",
    ]) {
      // A cross-site form (enctype=text/plain carries JSON) must not log the
      // victim's browser into an attacker's account.
      expect(await post(path, { origin: "https://evil.test" }), path).toBe(403);
      expect(await post(path, { "sec-fetch-site": "cross-site" }), path).toBe(403);
      expect(await post(path, { origin: PUBLIC }), path).toBe(200);
      // The mobile app and server-side clients send no Origin.
      expect(await post(path, {}), path).toBe(200);
    }
  });

  it("in development accepts the configured origin and loopback origins on the dev server's port", async () => {
    // The audit harness runs `next dev --hostname 127.0.0.1` with
    // NEXT_PUBLIC_BASE_URL=http://127.0.0.1:<port>; Next reports nextUrl as localhost.
    env("development", "http://127.0.0.1:4123");
    for (const origin of ["http://127.0.0.1:4123", "http://localhost:4123", "http://[::1]:4123"]) {
      expect(await write(api("http://localhost:4123"), { origin }), origin).toBe(200);
    }
    for (const origin of ["http://localhost:5000", "http://127.0.0.1:5000", "https://evil.test", "http://192.168.0.107:4123"]) {
      expect(await write(api("http://localhost:4123"), { origin }), origin).toBe(403);
    }
    // Unset base URL in development: the local default and the dev port still work.
    env("development", undefined);
    expect(await write(api("http://localhost:3000"), { origin: "http://localhost:3000" })).toBe(200);
    expect(await write(api("http://localhost:3001"), { origin: "http://127.0.0.1:3001" })).toBe(200);
    expect(await write(api("http://localhost:3001"), { origin: "https://evil.test" })).toBe(403);
  });
});
