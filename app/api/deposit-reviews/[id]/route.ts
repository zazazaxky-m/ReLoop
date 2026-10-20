import { z } from "zod";
import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { decideDepositReview } from "@/lib/deposit-review";

const patchSchema = z.object({
  action: z.enum(["approve", "reject"]),
  // Reclassification target when the item was created via the unknown
  // waste-type fallback (or the reviewer determines the original guess was
  // wrong). Required for "approve" when the item has no resolvable type.
  wasteTypeId: z.string().min(1).max(191).optional(),
  quantity: z.number().int().min(1).max(999).optional(),
  note: z.string().max(500).optional(),
  // SUPERADMIN only: approve a legacy review row (no acceptance event, or no
  // acceptance time) of a session that already ended, created before the M04
  // cutover. Priced at the item's recorded time, marked and audited
  // (lib/deposit-review.ts).
  legacy: z.boolean().optional(),
  // With `legacy`: the item version the superadmin saw (`updatedAt`, ISO-8601,
  // as GET /api/deposit-reviews returns it). Required; 409 if the row changed.
  itemVersion: z.string().datetime({ offset: true }).optional(),
});

/**
 * Resolves a deposit item held in REVIEW (sensor/fraud anomaly, AI material
 * mismatch, or the unknown-waste-type fallback). The decision runs once under
 * the reward recipient's User lock (lib/deposit-review.ts): `approve` pays the
 * reward the central policy allows (0 in a COMPLIANCE_ONLY program), `reject`
 * pays nothing; existing holds are released or rejected and the difference to
 * what was already credited is one ledger row keyed `review:<id>:decision:v1`.
 *
 * 200 `{ item, idempotent, targetAmount, ledgerEntry, reconciliationCase }`.
 * Repeating the same decision answers `idempotent: true` without writing;
 * a different decision on an already reviewed item is 409. A correction the
 * balance no longer covers (already paid out) is not debited: it is returned
 * as `reconciliationCase` for the finance team.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id } = await params;
    const body = patchSchema.parse(await req.json());
    const result = await decideDepositReview(user, id, body);
    return jsonOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}
