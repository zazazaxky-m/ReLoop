import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const updateSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    unit: z.enum(["ITEM", "KG"]).optional(),
    minWeightGrams: z.number().int().min(0).max(100000).nullable().optional(),
    maxWeightGrams: z.number().int().min(0).max(100000).nullable().optional(),
    defaultRewardPerItem: z.number().int().min(0).max(10_000_000).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    active: z.boolean().optional(),
  })
  .refine(
    (d) =>
      d.minWeightGrams == null ||
      d.maxWeightGrams == null ||
      d.minWeightGrams <= d.maxWeightGrams,
    { message: "Berat minimum tidak boleh melebihi maksimum", path: ["minWeightGrams"] },
  );

/** Loads a waste type and enforces who may edit it. */
async function loadEditable(id: string, role: string, orgId: string | null) {
  const wasteType = await prisma.wasteType.findUnique({ where: { id } });
  if (!wasteType) throw new HttpError(404, "Jenis sampah tidak ditemukan");
  if (role === "SUPERADMIN") return wasteType;
  // Admin may only edit their own org's waste types (not globals).
  if (wasteType.organizationId == null) {
    throw new HttpError(403, "Jenis sampah global hanya dapat diubah superadmin");
  }
  if (wasteType.organizationId !== orgId) {
    throw new HttpError(403, "Di luar scope organisasi Anda");
  }
  return wasteType;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id } = await params;
    await loadEditable(id, user.role, user.organizationId);
    const data = updateSchema.parse(await req.json());

    const wasteType = await prisma.wasteType.update({
      where: { id },
      data,
    });

    await logAudit({
      actorId: user.id,
      action: "WASTE_TYPE_UPDATE",
      entityType: "WasteType",
      entityId: id,
      metadata: data,
    });

    return jsonOk({ wasteType });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id } = await params;
    await loadEditable(id, user.role, user.organizationId);

    const [items, machineLinks] = await Promise.all([
      prisma.depositItem.count({ where: { wasteTypeId: id } }),
      prisma.machineWasteType.count({ where: { wasteTypeId: id } }),
    ]);
    if (items || machineLinks) {
      // Preserve history: deactivate rather than hard-delete.
      await prisma.wasteType.update({ where: { id }, data: { active: false } });
      await logAudit({
        actorId: user.id,
        action: "WASTE_TYPE_DEACTIVATE",
        entityType: "WasteType",
        entityId: id,
      });
      return jsonOk({ deactivated: true });
    }

    await prisma.wasteType.delete({ where: { id } });
    await logAudit({
      actorId: user.id,
      action: "WASTE_TYPE_DELETE",
      entityType: "WasteType",
      entityId: id,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
