import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { verifySessionToken } from "@/lib/auth";
import { resolveWsSessionIdentity } from "@/lib/ws-session";

const schema = z.object({
  token: z.string().min(1),
});

function authorized(req: NextRequest): boolean {
  const secret = process.env.REALTIME_INTERNAL_SECRET;
  if (!secret) return false;
  const supplied =
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = Buffer.from(secret);
  const actual = Buffer.from(supplied);
  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}

/**
 * Internal-only live verifier for the realtime gateway (R04). Answers
 * `{ userId, role, organizationId, tokenVersion, expiresAt }` for a current
 * session (strict JWT check, then live DB status/tokenVersion/role/org), or
 * `null`, which the gateway treats as a definitive revocation.
 */
export async function POST(req: NextRequest) {
  try {
    if (!authorized(req)) {
      return jsonError(401, "Unauthorized");
    }

    const { token } = schema.parse(await req.json());
    const payload = await verifySessionToken(token);
    if (!payload) {
      return jsonOk(null);
    }

    return jsonOk(
      await resolveWsSessionIdentity({
        sub: payload.sub,
        tokenVersion: payload.tokenVersion,
        expiresAt: payload.expiresAt,
      }),
    );
  } catch (error) {
    return handleApiError(error);
  }
}
