import { z } from "zod";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { requireApiUser } from "@/lib/rbac";
import { disableMfa } from "@/lib/mfa";

const schema = z.object({
  code: z.string().regex(/^\d{6}$/, "Kode MFA harus 6 digit"),
});

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { code } = schema.parse(await req.json());

    const ok = await disableMfa(user.id, code);
    if (!ok) return jsonError(400, "Kode MFA tidak valid");

    await logAudit({
      actorId: user.id,
      action: "MFA_DISABLED",
      entityType: "User",
      entityId: user.id,
    });

    return jsonOk({ message: "MFA berhasil dinonaktifkan" });
  } catch (error) {
    return handleApiError(error);
  }
}
