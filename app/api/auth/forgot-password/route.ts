import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { userWhereEmail } from "@/lib/encryption";
import { sendPasswordResetEmail } from "@/lib/mailer";
import { createPasswordResetToken } from "@/lib/password-reset";

const schema = z.object({
  email: z.string().email("Email tidak valid"),
});

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 900_000; // 15 minutes

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await checkRateLimit(
      `forgot-password:${ip}`,
      RATE_LIMIT,
      RATE_WINDOW_MS,
    );
    if (!rl.allowed) {
      return jsonError(429, "Terlalu banyak permintaan. Coba lagi nanti.");
    }

    const data = schema.parse(await req.json());
    const email = data.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: userWhereEmail(email) });

    // Only issue a token for an active, credential-based account. We still
    // return the same generic response in every branch so the endpoint can't
    // be used to enumerate which emails are registered.
    let devResetUrl: string | undefined;
    if (user && user.status === "ACTIVE" && user.passwordHash) {
      const rawToken = await createPasswordResetToken(user.id);
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/+$/, "") ?? req.nextUrl.origin;
      const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

      await sendPasswordResetEmail({ to: email, resetUrl });

      await logAudit({
        actorId: user.id,
        action: "PASSWORD_RESET_REQUEST",
        entityType: "User",
        entityId: user.id,
        metadata: { ip },
      });

      // Surfaced only outside production to make the flow testable without an
      // email provider. Never leaked in production.
      if (process.env.NODE_ENV !== "production") {
        devResetUrl = resetUrl;
      }
    }

    return jsonOk({
      message:
        "Jika email terdaftar, kami telah mengirimkan tautan reset kata sandi.",
      ...(devResetUrl ? { devResetUrl } : {}),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
