import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { clearSessionCookie } from "@/lib/auth";
import { ERASURE_ONLY_USERS, getErasureStatus, requestErasure, runErasureJob } from "@/lib/erasure-jobs";
import { createUserDataExportStream } from "@/lib/gdpr";
import { requireApiUser } from "@/lib/rbac";

export async function GET() {
  try {
    const user = await requireApiUser();
    const stream = createUserDataExportStream(user.id);

    return new Response(stream, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="reloop-export-${user.id}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * The signed-in owner asks to erase their account. Always 202 Accepted with
 * the job status: `status`/`completed` say whether it finished, was held for
 * open balances (PENDING_RECONCILIATION, with `resolutionSteps`) or is being
 * retried (RETRYABLE_FAILED). `erased`/`retained` list what is removed and
 * what is kept and why. Repeating the call returns the same request.
 *
 * The first run happens here (after the request committed); the periodic
 * runner (scripts/process-erasure-jobs.ts) retries and resumes held requests.
 */
export async function DELETE() {
  try {
    const user = await requireApiUser();
    if (user.role !== "USER") {
      return jsonError(403, ERASURE_ONLY_USERS);
    }
    const { requestId, status } = await requestErasure(user.id);
    if (status === "PROCESSING") {
      try {
        await runErasureJob(requestId);
      } catch (error) {
        // The request is durable; the runner retries it. Report the stored status.
        console.error("[erasure] first run failed", error instanceof Error ? error.name : "unknown");
      }
    }
    const view = await getErasureStatus(requestId);
    // Sessions are already revoked (tokenVersion); drop the cookie as well.
    if (view.accountErased) await clearSessionCookie();
    return jsonOk(view, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
