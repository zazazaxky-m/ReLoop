import { handleApiError, jsonOk } from "@/lib/api";
import { requireApiUser } from "@/lib/rbac";
import { resolveRewardCase, rewardCaseResolveSchema } from "@/lib/reward-cases";

/**
 * SUPERADMIN closes an OPEN reward reconciliation case with a written outcome
 * (lib/reward-cases.ts). Repeating it answers 200 `idempotent: true` and keeps
 * the first outcome.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;
    const body = rewardCaseResolveSchema.parse(await req.json().catch(() => ({})));
    const { rewardCase, idempotent } = await resolveRewardCase(user, id, body);
    return jsonOk({
      rewardCase: { id: rewardCase.id, status: rewardCase.status, resolvedAt: rewardCase.resolvedAt },
      idempotent,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
