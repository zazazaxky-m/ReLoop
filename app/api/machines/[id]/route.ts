import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  regionId: z.string().nullable().optional(),
  status: z.enum(["ONLINE", "OFFLINE", "FULL", "MAINTENANCE", "ERROR"]).optional(),
  fillLevelPercent: z.number().int().min(0).max(100).optional(),
  capacityKg: z.number().positive().nullable().optional(),
  chamberTimeoutSeconds: z.number().int().min(5).max(120).optional(),
  qrRotationSeconds: z.number().int().min(10).max(300).optional(),
  hasInputChamber: z.boolean().optional(),
  hasConveyor: z.boolean().optional(),
  hasCompactor: z.boolean().optional(),
  hasExternalCamera: z.boolean().optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  wasteTypeIds: z.array(z.string()).optional(),
});

async function loadScoped(id: string, userRole: string, userOrg: string | null) {
  const machine = await prisma.machine.findUnique({ where: { id } });
  if (!machine) throw new HttpError(404, "Mesin tidak ditemukan");
  if (userRole === "ADMIN" && machine.organizationId !== userOrg) {
    throw new HttpError(403, "Di luar scope organisasi Anda");
  }
  return machine;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id } = await params;
    await loadScoped(id, user.role, user.organizationId);

    const machine = await prisma.machine.findUnique({
      where: { id },
      include: {
        organization: { select: { id: true, name: true } },
        region: { select: { id: true, name: true } },
        wasteTypes: { include: { wasteType: true } },
        sessions: { orderBy: { startedAt: "desc" }, take: 10 },
        _count: { select: { sessions: true, events: true } },
      },
    });
    return jsonOk({ machine });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id } = await params;
    const current = await loadScoped(id, user.role, user.organizationId);
    assertOrgScope(user, current.organizationId);

    const data = updateSchema.parse(await req.json());
    const { wasteTypeIds, ...rest } = data;

    const machine = await prisma.$transaction(async (tx) => {
      const updated = await tx.machine.update({
        where: { id },
        data: rest,
      });
      if (wasteTypeIds) {
        await tx.machineWasteType.deleteMany({ where: { machineId: id } });
        if (wasteTypeIds.length) {
          await tx.machineWasteType.createMany({
            data: wasteTypeIds.map((wasteTypeId) => ({
              machineId: id,
              wasteTypeId,
              active: true,
            })),
          });
        }
      }
      return updated;
    });

    await logAudit({
      actorId: user.id,
      action: "MACHINE_UPDATE",
      entityType: "Machine",
      entityId: id,
      metadata: rest,
    });

    return jsonOk({ machine });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Only superadmin can decommission a machine (provisioning lifecycle).
    const user = await requireApiUser(["SUPERADMIN"]);
    const { id } = await params;
    const current = await loadScoped(id, user.role, user.organizationId);

    const [sessions, events, pickups] = await Promise.all([
      prisma.depositSession.count({ where: { machineId: id } }),
      prisma.machineEvent.count({ where: { machineId: id } }),
      prisma.pickupRequest.count({ where: { machineId: id } }),
    ]);
    if (sessions || events || pickups) {
      return jsonError(
        409,
        "Mesin memiliki riwayat dan tidak bisa dihapus. Set status OFFLINE/MAINTENANCE saja.",
      );
    }

    await prisma.machineWasteType.deleteMany({ where: { machineId: id } });
    await prisma.machine.delete({ where: { id } });

    await logAudit({
      actorId: user.id,
      action: "MACHINE_DELETE",
      entityType: "Machine",
      entityId: id,
      metadata: { machineCode: current.machineCode },
    });

    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
