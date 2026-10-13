import { z } from "zod";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { buildSessionPayload, setSessionCookie } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { disableMfa } from "@/lib/mfa";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireApiUser } from "@/lib/rbac";
import { afterCommitSafely } from "@/lib/wallet-service";

/**
 * Turns MFA off with `{ currentPassword, code }`. Success revokes every
 * session (tokenVersion + 1) and re-issues the requester's session cookie.
 */
const schema = z.object({
  currentPassword: z.string().min(1, "Password saat ini wajib diisi").max(1024),
  code: z.string().regex(/^\d{6}$/, "Kode MFA harus 6 digit"),
});

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 900_000;

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const ip = getClientIp(req);
    const rl = await checkRateLimit(`mfa-disable:${user.id}:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (rl.unavailable) return jsonError(503, "Layanan keamanan akun sementara tidak tersedia. Silakan coba lagi.");
    if (!rl.allowed) return jsonError(429, "Terlalu banyak percobaan MFA. Coba lagi nanti.");

    const proof = schema.parse(await req.json().catch(() => undefined));

    const result = await disableMfa(user.id, proof);
    if (!result.ok) {
      if (result.reason === "not_enabled") return jsonError(409, "MFA belum aktif");
      await afterCommitSafely("audit MFA_DISABLE_FAILED", () => logAudit({
        actorId: user.id,
        action: "MFA_DISABLE_FAILED",
        entityType: "User",
        entityId: user.id,
        metadata: { ip },
      }));
      return jsonError(400, "Password atau kode MFA tidak valid");
    }

    // Committed: every older session is revoked; keep the requester signed in.
    await setSessionCookie(buildSessionPayload(result.user));

    await afterCommitSafely("audit MFA_DISABLED", () => logAudit({
      actorId: user.id,
      action: "MFA_DISABLED",
      entityType: "User",
      entityId: user.id,
      metadata: { ip },
    }));

    return jsonOk({ message: "MFA berhasil dinonaktifkan. Sesi di perangkat lain telah dikeluarkan." });
  } catch (error) {
    return handleApiError(error);
  }
}
