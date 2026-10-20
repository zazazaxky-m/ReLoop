import { after, NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { userWhereEmail } from "@/lib/encryption";
import { sendPasswordResetEmail } from "@/lib/mailer";
import { createPasswordResetToken } from "@/lib/password-reset";
import { emailLinkBase, LINK_BASE_UNAVAILABLE } from "@/lib/site";

const schema = z.object({
  email: z.string().email("Email tidak valid"),
});

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 900_000; // 15 minutes

/** Issues the token, mails the link and records the audit entry (after the response). */
async function sendResetLink(input: { userId: string; email: string; linkBase: string; ip: string }) {
  try {
    const rawToken = await createPasswordResetToken(input.userId);
    await sendPasswordResetEmail({ to: input.email, resetUrl: `${input.linkBase}/reset-password?token=${rawToken}` });
    await logAudit({
      actorId: input.userId,
      action: "PASSWORD_RESET_REQUEST",
      entityType: "User",
      entityId: input.userId,
      metadata: { ip: input.ip },
    });
  } catch (error) {
    console.error("[forgot-password] reset link not sent", error instanceof Error ? error.name : "unknown");
  }
}

/**
 * Answers the same message, equally fast, for every email: the token, the mail
 * and the audit entry for an eligible account run after the response
 * (`after()`), so neither their duration nor a failure reveals whether the
 * email is registered. The link is built only from the configured base URL,
 * never the request Host; production without one fails closed (503).
 */
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

    const linkBase = emailLinkBase();
    if (!linkBase) {
      console.error("[forgot-password] NEXT_PUBLIC_BASE_URL is not configured; no reset link is sent");
      return jsonError(503, LINK_BASE_UNAVAILABLE);
    }

    const data = schema.parse(await req.json());
    const email = data.email.toLowerCase().trim();

    const user = await prisma.user.findUnique({ where: userWhereEmail(email) });

    // Only an active, credential-based account gets a token.
    if (user && user.status === "ACTIVE" && user.passwordHash) {
      const userId = user.id;
      after(() => sendResetLink({ userId, email, linkBase, ip }));
    }

    return jsonOk({
      message:
        "Jika email terdaftar, kami telah mengirimkan tautan reset kata sandi.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
