import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
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
});
