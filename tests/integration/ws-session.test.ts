import { decodeJwt } from "jose";
import { describe, expect, it } from "vitest";
import { signMfaChallenge } from "@/lib/mfa";
import { f } from "../support/audit-fixture";

/**
 * R04: the internal live verifier end to end (real Next route, strict JWT
 * check, live PostgreSQL row). The realtime gateway trusts exactly this answer.
 */
async function verify(token: string, secret = process.env.REALTIME_INTERNAL_SECRET ?? "") {
  const response = await fetch(new URL("/api/internal/ws-session", process.env.AUDIT_BASE_URL), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify({ token }),
  });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

describe("POST /api/internal/ws-session (R04, real PostgreSQL)", () => {
  it("answers the live identity: role and organization from the database, expiry from the verified JWT", async () => {
    const token = await f.sessionCookie("adminA");
    const user = await f.db.user.findUniqueOrThrow({ where: { id: f.ids.adminA } });

    expect(await verify(token)).toEqual({
      status: 200,
      body: {
        userId: f.ids.adminA, role: "ADMIN", organizationId: f.ids.orgA,
        tokenVersion: user.tokenVersion, expiresAt: decodeJwt(token).exp,
      },
    });

    // Organization move and role downgrade without a tokenVersion bump: the
    // same cookie now answers the new capability.
    await f.db.user.update({ where: { id: f.ids.adminA }, data: { organizationId: f.ids.orgB, role: "USER" } });
    expect((await verify(token)).body).toMatchObject({ role: "USER", organizationId: f.ids.orgB });
  });

  it.each([
    ["suspension", { status: "SUSPENDED" as const }],
    ["deactivation", { status: "INACTIVE" as const }],
    ["a tokenVersion bump", { tokenVersion: { increment: 1 } }],
  ])("answers null after %s", async (_case, data) => {
    const token = await f.sessionCookie("adminB");
    expect((await verify(token)).body).toMatchObject({ userId: f.ids.adminB });

    await f.db.user.update({ where: { id: f.ids.adminB }, data });

    expect(await verify(token)).toEqual({ status: 200, body: null });
  });

  it("answers null for a non-session token and 401 without the internal secret", async () => {
    const user = await f.db.user.findUniqueOrThrow({ where: { id: f.ids.adminA } });
    expect(await verify(await signMfaChallenge(f.ids.adminA, user.tokenVersion))).toEqual({ status: 200, body: null });
    expect(await verify("not-a-jwt")).toEqual({ status: 200, body: null });
    expect((await verify(await f.sessionCookie("adminA"), "wrong-secret")).status).toBe(401);
  });
});
