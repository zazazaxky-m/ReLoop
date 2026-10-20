import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { getReconciliationReport } from "@/lib/reconciliation-report";

/**
 * Platform-wide financial reconciliation (M05): net liabilities from the
 * ledger (available, pending, reserved, paid), payout requests compared with
 * their reserves per request, gross issuance per organization with the
 * UNALLOCATED_LEGACY bucket until B01, and open M04 reward cases, all from one
 * read-only snapshot. SUPERADMIN only. Contract:
 * tests/fixtures/contracts/reconciliation-report.v1.json.
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
