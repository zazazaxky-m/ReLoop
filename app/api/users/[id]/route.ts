import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  role: z.enum(["SUPERADMIN", "ADMIN", "PENGEPUL", "USER"]).optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).optional(),
  organizationId: z.string().nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const actor = await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target) throw new HttpError(404, "Pengguna tidak ditemukan");
    const data = patchSchema.parse(await req.json());

    const role = data.role ?? target.role;
    if (role === "ADMIN") {
      const orgId = data.organizationId ?? target.organizationId;
      if (!orgId) return jsonError(422, "Admin wajib terhubung ke organisasi");
    }

    // Prevent removing the last active superadmin.
    if (
      target.role === "SUPERADMIN" &&
      ((data.role && data.role !== "SUPERADMIN") || data.status === "INACTIVE" || data.status === "SUSPENDED")
    ) {
      const activeSupers = await prisma.user.count({
        where: { role: "SUPERADMIN", status: "ACTIVE" },
      });
      if (activeSupers <= 1) {
        return jsonError(409, "Tidak bisa menonaktifkan superadmin terakhir");
      }
    }

    const user = await prisma.user.update({
      where: { id },
      data: {
        role: data.role,
        status: data.status,
        organizationId: data.organizationId,
        phone: data.phone,
      },
      select: { id: true, role: true, status: true, organizationId: true },
    });

    await logAudit({
      actorId: actor.id,
      action: "USER_UPDATE",
      entityType: "User",
      entityId: id,
      metadata: data,
    });

    return jsonOk({ user });
  } catch (error) {
    return handleApiError(error);
  }
}
