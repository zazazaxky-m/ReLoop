import { handleApiError, jsonOk } from "@/lib/api";
import { latestErasureForUser } from "@/lib/erasure-jobs";
import { requireApiUser } from "@/lib/rbac";

/**
 * Status of the signed-in owner's latest verified account-erasure request
 * (`{ erasure: null }` when there is none). Used by clients to show a held
 * (PENDING_RECONCILIATION) or retrying request while the account is active.
 */
export async function GET() {
  try {
    const user = await requireApiUser(["USER"]);
    return jsonOk({ erasure: await latestErasureForUser(user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}
