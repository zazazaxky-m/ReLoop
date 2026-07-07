import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { getDepositReviewQueue } from "@/lib/security-events";
import { buildPaginationMeta, parsePagination } from "@/lib/pagination";

/**
 * Review queue for deposit items that were flagged during acceptance:
 * sensor/fraud anomalies (50% reward, EARN/PENDING) and the unknown-waste-type
 * fallback (0 reward, no ledger entry yet). SUPERADMIN sees every
 * organization; ADMIN is scoped to their own.
 */
export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const url = new URL(req.url);
    const organizationId =
      user.role === "ADMIN"
        ? user.organizationId ?? "__none__"
        : url.searchParams.get("organizationId") ?? undefined;

    const pagination = parsePagination(url, { defaultLimit: 50 });
    const { items, total } = await getDepositReviewQueue({
      organizationId,
      skip: pagination.skip,
      take: pagination.take,
    });
    return jsonOk({
      items,
      pagination: buildPaginationMeta(total, pagination),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
