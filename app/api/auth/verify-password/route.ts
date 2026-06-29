import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { requireApiUser } from "@/lib/rbac";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  password: z.string().min(1, "Password wajib diisi"),
});

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 300_000;

export async function POST(req: NextRequest) {
  try {
    const sessionUser = await requireApiUser();
    const rl = checkRateLimit(
      `verify-password:${sessionUser.id}`,
      RATE_LIMIT,
      RATE_WINDOW_MS,
    );
    if (!rl.allowed) {
      return jsonError(429, "Terlalu banyak percobaan. Coba lagi nanti.");
    }

    const data = schema.parse(await req.json());
    const user = await prisma.user.findUnique({
      where: { id: sessionUser.id },
    });
    if (!user) return jsonError(404, "Pengguna tidak ditemukan");

    const valid =
      Boolean(user.passwordHash) &&
      (await verifyPassword(data.password, user.passwordHash!));

    if (!valid) {
      await logAudit({
        actorId: user.id,
        action: "BIOMETRIC_VERIFY_FAILED",
        entityType: "User",
        entityId: user.id,
        metadata: { reason: "invalid_password" },
      });
      return jsonError(401, "Password tidak sesuai");
    }

    return jsonOk({ valid: true });
  } catch (error) {
    return handleApiError(error);
  }
}
