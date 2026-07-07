import { handleApiError, jsonOk } from "@/lib/api";
import { requireApiUser } from "@/lib/rbac";
import { getMfaStatus } from "@/lib/mfa";

export async function GET() {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const status = await getMfaStatus(user.id);
    if (!status) return jsonOk({ mfaEnabled: false, requiredForRole: false });
    return jsonOk(status);
  } catch (error) {
    return handleApiError(error);
  }
}
