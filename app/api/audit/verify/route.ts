import { handleApiError, jsonOk } from "@/lib/api";
import { verifyAuditChain } from "@/lib/audit";
import { requireApiUser } from "@/lib/rbac";

export async function POST() {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const result = await verifyAuditChain();
    // `valid` covers the v2 chain only; the legacy (v1) archive is reported
    // apart from it (A05). Explicit fields: nothing else leaves this route.
    return jsonOk({
      valid: result.valid,
      ...(result.valid ? {} : { brokenAt: result.brokenAt, reason: result.reason }),
      checkedVersion: result.checkedVersion,
      checkedCount: result.checkedCount,
      legacyStatus: result.legacyStatus,
      legacyCount: result.legacyCount,
      legacyCheckpoint: result.legacyCheckpoint,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
