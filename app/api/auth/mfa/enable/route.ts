import { z } from "zod";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { buildSessionPayload, setSessionCookie } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { enableMfa } from "@/lib/mfa";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireApiUser } from "@/lib/rbac";
import { afterCommitSafely } from "@/lib/wallet-service";

/**
 * Confirms the pending setup started by POST /api/auth/mfa/setup with a code
 * of the new secret. Success makes it the active factor, revokes every session
 * (tokenVersion + 1) and re-issues the requester's session cookie.
 */
const schema = z.object({
  code: z.string().regex(/^\d{6}$/, "Kode MFA harus 6 digit"),
});

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 300_000;

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const ip = getClientIp(req);
    const rl = await checkRateLimit(`mfa-enable:${user.id}:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (rl.unavailable) return jsonError(503, "Layanan keamanan akun sementara tidak tersedia. Silakan coba lagi.");
    if (!rl.allowed) return jsonError(429, "Terlalu banyak percobaan MFA. Coba lagi nanti.");

    const { code } = schema.parse(await req.json().catch(() => undefined));

    const result = await enableMfa(user.id, code);
    if (!result.ok) {
      if (result.reason === "invalid_code") {
        await afterCommitSafely("audit MFA_ENABLE_FAILED", () => logAudit({
          actorId: user.id,
          action: "MFA_ENABLE_FAILED",
          entityType: "User",
          entityId: user.id,
          metadata: { ip },
        }));
        return jsonError(400, "Kode MFA tidak valid");
      }
      return jsonError(409, "Tidak ada setup MFA yang menunggu konfirmasi atau setup sudah kedaluwarsa. Mulai setup ulang.");
    }

    // Committed: every older session is revoked; keep the requester signed in.
    await setSessionCookie(buildSessionPayload(result.user));

    const action = result.replaced ? "MFA_REPLACED" : "MFA_ENABLED";
    await afterCommitSafely(`audit ${action}`, () => logAudit({
      actorId: user.id,
      action,
      entityType: "User",
      entityId: user.id,
      metadata: { ip },
    }));

    return jsonOk({
      replaced: result.replaced,
      message: result.replaced
        ? "Perangkat MFA berhasil diganti. Sesi di perangkat lain telah dikeluarkan."
        : "MFA berhasil diaktifkan. Sesi di perangkat lain telah dikeluarkan.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
