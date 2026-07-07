import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { verifySessionToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

/** Internal-only: validates a session JWT against live DB role/tokenVersion. */
export async function POST(req: NextRequest) {
  try {
    if (!authorized(req)) {
      return jsonError(401, "Unauthorized");
    }

    const { token } = schema.parse(await req.json());
    const payload = await verifySessionToken(token);
    if (!payload) {
      return jsonOk({ role: null });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { role: true, status: true, tokenVersion: true },
    });

    if (!user || user.status !== "ACTIVE") {
      return jsonOk({ role: null });
    }
    if ((payload.tokenVersion ?? 0) !== (user.tokenVersion ?? 0)) {
      return jsonOk({ role: null });
    }

    return jsonOk({ role: user.role });
  } catch (error) {
    return handleApiError(error);
  }
}
