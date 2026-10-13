import { NextRequest } from "next/server";
import { z } from "zod";
import { hashPassword, clearSessionCookie } from "@/lib/auth";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { checkRateLimit } from "@/lib/rate-limit";
import { passwordSchema } from "@/lib/password-policy";
import { consumePasswordResetToken, findPasswordResetTokenOwner } from "@/lib/password-reset";
import { lockUser } from "@/lib/db-locks";
import { PENDING_MFA_CLEARED } from "@/lib/mfa";
import { runWalletTransaction } from "@/lib/wallet-service";

const schema = z.object({
  token: z.string().min(1, "Token tidak valid"),
  password: passwordSchema,
});

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 900_000; // 15 minutes

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const rl = await checkRateLimit(
      `reset-password:${ip}`,
      RATE_LIMIT,
      RATE_WINDOW_MS,
    );
    if (!rl.allowed) {
      return jsonError(429, "Terlalu banyak percobaan. Coba lagi nanti.");
    }

    const data = schema.parse(await req.json());

    const invalidLink = () => jsonError(
      400,
      "Tautan reset tidak valid atau sudah kedaluwarsa. Silakan minta tautan baru.",
    );
    // The token's owner is immutable: read it, lock that User, then claim the
    // token inside the same transaction as the password change, so a failure
    // (e.g. a lock_timeout 503) rolls the claim back and the link stays usable.
    const ownerId = await findPasswordResetTokenOwner(data.token);
    if (!ownerId) return invalidLink();

    // Hash before the transaction (CPU only); the write also discards any
    // pending MFA setup, under the same User lock as the MFA routes.
    const passwordHash = await hashPassword(data.password);
    const userId = await runWalletTransaction(async (tx) => {
      await lockUser(tx, ownerId);
      const claimedBy = await consumePasswordResetToken(data.token, tx);
      if (claimedBy !== ownerId) return null; // used or expired meanwhile
      await tx.user.update({
        where: { id: ownerId },
        data: { passwordHash, tokenVersion: { increment: 1 }, ...PENDING_MFA_CLEARED },
      });
      return ownerId;
    });
    if (!userId) return invalidLink();

    await clearSessionCookie();

    await logAudit({
      actorId: userId,
      action: "PASSWORD_RESET",
      entityType: "User",
      entityId: userId,
      metadata: { ip },
    });

    return jsonOk({
      message: "Kata sandi berhasil diperbarui. Silakan masuk.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
