import { z } from "zod";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAuditInTransaction } from "@/lib/audit";
import { lockPickupForFieldWork } from "@/lib/pickup-dispatch";
import { runWalletTransaction } from "@/lib/wallet-service";

const itemSchema = z.object({
  wasteTypeId: z.string().nullable().optional(),
  itemCount: z.number().int().min(0).nullable().optional(),
  estimatedWeightKg: z.number().min(0).nullable().optional(),
  actualWeightKg: z.number().min(0).nullable().optional(),
  source: z.enum(["MACHINE_COUNT", "MANUAL_WEIGHING"]).default("MANUAL_WEIGHING"),
  notes: z.string().max(500).nullable().optional(),
});

/** Statuses in which material may be recorded on the task. */
const RECORDABLE = ["ARRIVED", "COLLECTED", "COMPLETED"];

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["PENGEPUL", "SUPERADMIN"]);
    const { id } = await params;
    const data = itemSchema.parse(await req.json());

    // B05: a material record is a field action like the PATCH steps. Under the
    // pickup lock the assignee, the collector's live partnership (FOR SHARE)
    // and the status are re-read, so a revoked or reassigned collector cannot
    // record, and a concurrent cancel is decided first.
    const item = await runWalletTransaction(async (tx) => {
      const current = await lockPickupForFieldWork(tx, user, id);
      if (!RECORDABLE.includes(current.status)) {
        throw new HttpError(409, "Material hanya dapat dicatat setelah tiba di lokasi");
      }
      const created = await tx.pickupItem.create({
        data: {
          pickupRequestId: id,
          wasteTypeId: data.wasteTypeId ?? null,
          itemCount: data.itemCount ?? null,
          estimatedWeightKg: data.estimatedWeightKg ?? null,
          actualWeightKg: data.actualWeightKg ?? null,
          source: data.source,
          notes: data.notes ?? null,
        },
      });
      await logAuditInTransaction(tx, {
        actorId: user.id,
        action: "PICKUP_ITEM_RECORD",
        entityType: "PickupItem",
        entityId: created.id,
        metadata: { pickupRequestId: id, pickupVersion: current.version, status: current.status },
      });
      return created;
    });

    return jsonOk({ item }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
