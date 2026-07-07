import { handleApiError, jsonOk } from "@/lib/api";
import { verifyAuditChain } from "@/lib/audit";
import { requireApiUser } from "@/lib/rbac";

export async function POST() {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const result = await verifyAuditChain();
    return jsonOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}
