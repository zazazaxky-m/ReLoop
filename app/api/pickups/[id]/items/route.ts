import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const itemSchema = z.object({
  wasteTypeId: z.string().nullable().optional(),
  itemCount: z.number().int().min(0).nullable().optional(),
  estimatedWeightKg: z.number().min(0).nullable().optional(),
  actualWeightKg: z.number().min(0).nullable().optional(),
  source: z.enum(["MACHINE_COUNT", "MANUAL_WEIGHING"]).default("MANUAL_WEIGHING"),
  notes: z.string().max(500).nullable().optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["PENGEPUL", "SUPERADMIN"]);
    const { id } = await params;
    const data = itemSchema.parse(await req.json());

    const pickup = await prisma.pickupRequest.findUnique({ where: { id } });
    if (!pickup) throw new HttpError(404, "Pickup tidak ditemukan");

    if (user.role === "PENGEPUL" && pickup.assignedCollectorId !== user.id) {
      throw new HttpError(403, "Pickup tidak ditugaskan kepada Anda");
    }
    if (!["ARRIVED", "COLLECTED", "COMPLETED"].includes(pickup.status)) {
      throw new HttpError(409, "Material hanya dapat dicatat setelah tiba di lokasi");
    }

    const item = await prisma.pickupItem.create({
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

    await logAudit({
      actorId: user.id,
      action: "PICKUP_ITEM_RECORD",
      entityType: "PickupItem",
      entityId: item.id,
      metadata: { pickupRequestId: id },
    });

    return jsonOk({ item }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
