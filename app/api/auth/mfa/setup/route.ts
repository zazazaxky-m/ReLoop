import { z } from "zod";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { getClientIp } from "@/lib/client-ip";
import { beginMfaSetup, cancelMfaSetup, isPrivilegedRole, MfaProofError } from "@/lib/mfa";
import { qrDataUrl } from "@/lib/qr";
import { checkRateLimit } from "@/lib/rate-limit";
import { requireApiUser } from "@/lib/rbac";
import { afterCommitSafely } from "@/lib/wallet-service";

/**
 * POST starts a first setup or a replacement and needs fresh proof:
 * `{ currentPassword, currentCode? }` (`currentCode` is required while MFA is
 * active). The new secret waits in the pending fields for 10 minutes; the
 * active factor keeps working until POST /api/auth/mfa/enable confirms it.
 * DELETE discards the pending setup only.
 */
const schema = z.object({
  currentPassword: z.string().min(1, "Password saat ini wajib diisi").max(1024),
  currentCode: z.string().regex(/^\d{6}$/, "Kode MFA harus 6 digit").optional(),
});

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 900_000;

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    if (!isPrivilegedRole(user.role)) {
      return jsonError(403, "MFA hanya tersedia untuk admin");
    }

    const ip = getClientIp(req);
    const rl = await checkRateLimit(`mfa-setup:${user.id}:${ip}`, RATE_LIMIT, RATE_WINDOW_MS);
    if (rl.unavailable) return jsonError(503, "Layanan keamanan akun sementara tidak tersedia. Silakan coba lagi.");
    if (!rl.allowed) return jsonError(429, "Terlalu banyak percobaan MFA. Coba lagi nanti.");

    // No body (clients before A02) fails validation: there is no session-only setup.
    const proof = schema.parse(await req.json().catch(() => undefined));

    let setup;
    try {
      setup = await beginMfaSetup(user.id, user.email, proof);
    } catch (error) {
      if (error instanceof MfaProofError) {
        await afterCommitSafely("audit MFA_SETUP_PROOF_FAILED", () => logAudit({
          actorId: user.id,
          action: "MFA_SETUP_PROOF_FAILED",
          entityType: "User",
          entityId: user.id,
          metadata: { ip },
        }));
      }
      throw error;
    }
    const qr = await qrDataUrl(setup.otpauthUrl);

    await afterCommitSafely("audit MFA_SETUP_STARTED", () => logAudit({
      actorId: user.id,
      action: "MFA_SETUP_STARTED",
      entityType: "User",
      entityId: user.id,
      metadata: { ip, replacement: setup.replacement },
    }));

    return jsonOk({
      secret: setup.secret,
      otpauthUrl: setup.otpauthUrl,
      qrDataUrl: qr,
      replacement: setup.replacement,
      expiresAt: setup.expiresAt.toISOString(),
      message: setup.replacement
        ? "Scan QR di aplikasi authenticator pada perangkat baru, lalu masukkan kode 6 digit dalam 10 menit. MFA lama tetap aktif sampai penggantian dikonfirmasi."
        : "Scan QR di aplikasi authenticator, lalu masukkan kode 6 digit dalam 10 menit.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const cancelled = await cancelMfaSetup(user.id);
    if (cancelled) {
      const ip = getClientIp(req);
      await afterCommitSafely("audit MFA_SETUP_CANCELLED", () => logAudit({
        actorId: user.id,
        action: "MFA_SETUP_CANCELLED",
        entityType: "User",
        entityId: user.id,
        metadata: { ip },
      }));
    }
    return jsonOk({ cancelled, message: "Setup MFA dibatalkan. Pengaturan MFA yang aktif tidak berubah." });
  } catch (error) {
    return handleApiError(error);
  }
}
