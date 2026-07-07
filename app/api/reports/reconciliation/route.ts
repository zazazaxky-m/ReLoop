import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { getReconciliationReport } from "@/lib/ledger";

/**
 * Platform-wide financial reconciliation: per-organization outstanding
 * liability plus a global payout cross-check of the REDEEM ledger against
 * Redemption records. SUPERADMIN only.
 */
export async function GET() {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const report = await getReconciliationReport();
    return jsonOk({ report });
  } catch (error) {
    return handleApiError(error);
  }
}
