import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  requireApiUser,
  assertActivePartnership,
  HttpError,
} from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { resolvePickupTransition, type PickupAction } from "@/lib/pickup";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  action: z.enum(["assign", "start", "arrive", "collect", "complete", "fail", "cancel"]),
  collectorUserId: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "PENGEPUL", "SUPERADMIN"]);
    const { id } = await params;

    const pickup = await prisma.pickupRequest.findUnique({
      where: { id },
      include: {
        machine: { select: { id: true, name: true, machineCode: true, fillLevelPercent: true } },
        organization: { select: { id: true, name: true, address: true, contactName: true, contactPhone: true } },
        assignedCollector: { select: { id: true, name: true, phone: true } },
        items: { include: { wasteType: { select: { name: true } } } },
      },
    });
    if (!pickup) throw new HttpError(404, "Pickup tidak ditemukan");

    // Scope: admin -> own org; pengepul -> assigned to them.
    if (user.role === "ADMIN" && pickup.organizationId !== user.organizationId) {
      throw new HttpError(403, "Di luar scope organisasi Anda");
    }
    if (user.role === "PENGEPUL" && pickup.assignedCollectorId !== user.id) {
      throw new HttpError(403, "Pickup tidak ditugaskan kepada Anda");
    }

    return jsonOk({ pickup });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "PENGEPUL", "SUPERADMIN"]);
    const { id } = await params;
    const body = patchSchema.parse(await req.json());

    const pickup = await prisma.pickupRequest.findUnique({ where: { id } });
    if (!pickup) throw new HttpError(404, "Pickup tidak ditemukan");

    const isOrgAdmin =
      user.role === "ADMIN" && user.organizationId === pickup.organizationId;
    const isAssignedCollector = pickup.assignedCollectorId === user.id;

    if (user.role === "ADMIN" && !isOrgAdmin) {
      throw new HttpError(403, "Di luar scope organisasi Anda");
    }

    const resolution = resolvePickupTransition(body.action as PickupAction, {
      status: pickup.status,
      role: user.role,
      isAssignedCollector,
      isOrgAdmin,
    });
    if (!resolution.ok || !resolution.to) {
      throw new HttpError(409, resolution.error ?? "Transisi tidak diizinkan");
    }

    // --- assign: validate the collector has an ACTIVE partnership ---
    let assignedCollectorId = pickup.assignedCollectorId;
    let collectorPartnerId = pickup.collectorPartnerId;
    if (body.action === "assign") {
      if (!body.collectorUserId) throw new HttpError(422, "collectorUserId wajib diisi");
      const partner = await assertActivePartnership(
        body.collectorUserId,
        pickup.organizationId,
      );
      assignedCollectorId = body.collectorUserId;
      collectorPartnerId = partner.id;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.pickupRequest.update({
        where: { id },
        data: {
          status: resolution.to,
          assignedCollectorId,
          collectorPartnerId,
          notes: body.notes ?? undefined,
        },
      });

      // On completion, reset the machine so it can accept deposits again.
      if (body.action === "complete" && pickup.machineId) {
        const machine = await tx.machine.findUnique({ where: { id: pickup.machineId } });
        if (machine) {
          await tx.machine.update({
            where: { id: pickup.machineId },
            data: {
              fillLevelPercent: 0,
              status: machine.status === "FULL" ? "ONLINE" : machine.status,
            },
          });
        }
      }
      return row;
    });

    await logAudit({
      actorId: user.id,
      action: `PICKUP_${body.action.toUpperCase()}`,
      entityType: "PickupRequest",
      entityId: id,
      metadata: { from: pickup.status, to: resolution.to, assignedCollectorId },
    });

    return jsonOk({ pickup: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
