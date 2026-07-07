import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  setSessionCookie,
  buildSessionPayload,
} from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { dashboardPath, type AppRole } from "@/lib/roles";
import { verifyMfaChallenge, verifyMfaLoginCode } from "@/lib/mfa";

const schema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, "Kode MFA harus 6 digit"),
});

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 300_000;

export async function POST(req: Request) {
  try {
    const ip = getClientIp(req);
    const rl = await checkRateLimit(`mfa-verify:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return jsonError(429, "Terlalu banyak percobaan MFA. Coba lagi nanti.");
    }

    const { challengeToken, code } = schema.parse(await req.json());
    const challenge = await verifyMfaChallenge(challengeToken);
    if (!challenge) return jsonError(401, "Sesi MFA kedaluwarsa. Silakan login ulang.");

    const ok = await verifyMfaLoginCode(challenge.userId, code);
    if (!ok) {
      await logAudit({
        actorId: challenge.userId,
        action: "MFA_VERIFY_FAILED",
        entityType: "User",
        entityId: challenge.userId,
        metadata: { ip },
      });
      return jsonError(401, "Kode MFA tidak valid");
    }

    const user = await prisma.user.findUnique({ where: { id: challenge.userId } });
    if (!user || user.status !== "ACTIVE") {
      return jsonError(403, "Akun tidak aktif");
    }

    await setSessionCookie(
      buildSessionPayload({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role as AppRole,
        organizationId: user.organizationId,
        tokenVersion: user.tokenVersion,
      }),
    );

    await logAudit({
      actorId: user.id,
      action: "MFA_VERIFY_SUCCESS",
      entityType: "User",
      entityId: user.id,
      metadata: { ip },
    });

    return jsonOk({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
      redirectTo: dashboardPath(user.role as AppRole),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
