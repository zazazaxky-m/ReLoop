import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { qrDataUrl } from "@/lib/qr";
import { requireApiUser } from "@/lib/rbac";
import { beginMfaSetup, isPrivilegedRole } from "@/lib/mfa";

export async function POST() {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    if (!isPrivilegedRole(user.role)) {
      return jsonError(403, "MFA hanya tersedia untuk admin");
    }

    const setup = await beginMfaSetup(user.id, user.email);
    const qr = await qrDataUrl(setup.otpauthUrl);

    await logAudit({
      actorId: user.id,
      action: "MFA_SETUP_STARTED",
      entityType: "User",
      entityId: user.id,
    });

    return jsonOk({
      secret: setup.secret,
      otpauthUrl: setup.otpauthUrl,
      qrDataUrl: qr,
      message: "Scan QR di aplikasi authenticator, lalu verifikasi kode 6 digit.",
    });
  } catch (error) {
    return handleApiError(error);
  }
}
