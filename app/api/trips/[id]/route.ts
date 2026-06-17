import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  status: z.enum(["PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"]),
});

async function loadScopedTrip(id: string, role: string, orgId: string | null, userId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id },
    include: { campaign: { select: { organizationId: true } } },
  });
  if (!trip) throw new HttpError(404, "Trip tidak ditemukan");
  if (role === "ADMIN" && trip.campaign.organizationId !== orgId) {
    throw new HttpError(403, "Di luar scope organisasi Anda");
  }
  if (role === "USER" && trip.userId !== userId) {
    throw new HttpError(403, "Bukan trip Anda");
  }
  return trip;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN", "USER"]);
    const { id } = await params;
    await loadScopedTrip(id, user.role, user.organizationId, user.id);

    const trip = await prisma.trip.findUnique({
      where: { id },
      include: {
        campaign: { select: { id: true, name: true } },
        bagAssignments: { orderBy: { assignedAt: "desc" } },
        validations: { orderBy: { createdAt: "desc" } },
      },
    });
    return jsonOk({ trip });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id } = await params;
    await loadScopedTrip(id, user.role, user.organizationId, user.id);
    const { status } = patchSchema.parse(await req.json());

    const trip = await prisma.trip.update({ where: { id }, data: { status } });
    await logAudit({
      actorId: user.id,
      action: "TRIP_STATUS",
      entityType: "Trip",
      entityId: id,
      metadata: { status },
    });
    return jsonOk({ trip });
  } catch (error) {
    return handleApiError(error);
  }
}
