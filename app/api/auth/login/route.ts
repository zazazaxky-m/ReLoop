import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { setSessionCookie, verifyPassword } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { dashboardPath, type AppRole } from "@/lib/roles";
import { checkRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().email("Email tidak valid"),
  password: z.string().min(1, "Password wajib diisi"),
});

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 300_000;

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip") ?? "unknown";
    const rl = checkRateLimit(`login:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (!rl.allowed) {
      return jsonError(429, "Terlalu banyak percobaan login. Coba lagi nanti.");
    }

    const data = schema.parse(await req.json());
    const email = data.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: { email } });
    const valid =
      user?.passwordHash &&
      (await verifyPassword(data.password, user.passwordHash));

    if (!user || !valid) {
      await logAudit({
        actorId: null,
        action: "LOGIN_FAILED",
        entityType: "User",
        entityId: email,
        metadata: { ip, reason: "invalid_credentials" },
      });
      return jsonError(401, "Email atau password salah");
    }
    if (user.status !== "ACTIVE") {
      await logAudit({
        actorId: user.id,
        action: "LOGIN_FAILED",
        entityType: "User",
        entityId: user.id,
        metadata: { ip, reason: "account_inactive" },
      });
      return jsonError(403, "Akun tidak aktif. Hubungi admin.");
    }

    await setSessionCookie({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role as AppRole,
      organizationId: user.organizationId,
    });

    await logAudit({
      actorId: user.id,
      action: "USER_LOGIN",
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
