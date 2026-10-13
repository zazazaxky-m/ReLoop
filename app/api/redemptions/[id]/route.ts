import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { publicRedemption } from "@/lib/payout-destination";
import {
  flagRedemptionForReconciliation,
  redemptionPatchSchema,
  transitionRedemption,
} from "@/lib/wallet-service";

/**
 * Payout request transitions. The status and its ledger reserve change in one
 * transaction under User -> Redemption locks (lib/wallet-service.ts):
 *
 * - approve / process / success / fail (SUPERADMIN), cancel (owner USER or
 *   SUPERADMIN). Repeating the outcome the request already has answers 200
 *   `idempotent: true`; anything else that no longer fits is 409.
 * - flag_reconciliation (SUPERADMIN, note required): the transfer outcome is
 *   unknown; the request stays PROCESSING with its reserve held.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["USER", "SUPERADMIN"]);
    const { id } = await params;
    const body = redemptionPatchSchema.parse(await req.json());

    const { redemption, idempotent } =
      body.action === "flag_reconciliation"
        ? await flagRedemptionForReconciliation(user, id, { note: body.note ?? "" })
        : await transitionRedemption(user, id, {
            action: body.action,
            note: body.note,
            providerReference: body.providerReference,
          });

    return jsonOk({ redemption: publicRedemption(redemption), idempotent });
  } catch (error) {
    return handleApiError(error);
  }
}
