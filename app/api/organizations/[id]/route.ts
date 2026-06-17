import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  type: z
    .enum(["SCHOOL", "CAMPUS", "VILLAGE", "TOURISM_SITE", "OFFICE", "COMMUNITY", "WASTE_BANK", "OTHER"])
    .optional(),
  regionId: z.string().nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  contactName: z.string().max(120).nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;
    const existing = await prisma.organization.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Organisasi tidak ditemukan");
    const data = patchSchema.parse(await req.json());

    const organization = await prisma.organization.update({ where: { id }, data });
    await logAudit({
      actorId: user.id,
      action: "ORGANIZATION_UPDATE",
      entityType: "Organization",
      entityId: id,
      metadata: data,
    });
    return jsonOk({ organization });
  } catch (error) {
    return handleApiError(error);
  }
}
