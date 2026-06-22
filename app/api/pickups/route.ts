import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  requireApiUser,
  assertOrgScope,
  activePartnerOrgIds,
  HttpError,
} from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { PICKUP_OPEN } from "@/lib/pickup";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  machineId: z.string().optional(),
  organizationId: z.string().optional(),
  reason: z.enum(["FULL", "SCHEDULED", "MANUAL", "ERROR"]).default("MANUAL"),
  priority: z.number().int().min(0).max(5).optional(),
  notes: z.string().max(500).optional(),
});

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "PENGEPUL", "SUPERADMIN"]);
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope"); // "available" for collectors
    const statusFilter = url.searchParams.get("status") ?? undefined;

    let where: Prisma.PickupRequestWhereInput = {};
    if (user.role === "ADMIN") {
      where.organizationId = user.organizationId ?? "__none__";
    } else if (user.role === "PENGEPUL") {
      if (scope === "available") {
        // Unassigned open pickups within the collector's ACTIVE partner orgs.
        const orgIds = await activePartnerOrgIds(user.id);
        where = {
          organizationId: { in: orgIds.length ? orgIds : ["__none__"] },
          assignedCollectorId: null,
          status: { in: PICKUP_OPEN },
        };
      } else {
        where.assignedCollectorId = user.id;
      }
    }
    if (statusFilter) {
      where.status = statusFilter as Prisma.EnumPickupStatusFilter["equals"];
    }

    const pickups = await prisma.pickupRequest.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      include: {
        machine: { select: { id: true, name: true, machineCode: true, fillLevelPercent: true } },
        organization: { select: { id: true, name: true, contactName: true, contactPhone: true, address: true } },
        assignedCollector: { select: { id: true, name: true } },
        items: { include: { wasteType: { select: { name: true } } } },
        _count: { select: { items: true } },
      },
    });

    return jsonOk({ pickups });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    let organizationId = user.role === "ADMIN" ? user.organizationId : data.organizationId;

    if (data.machineId) {
      const machine = await prisma.machine.findUnique({ where: { id: data.machineId } });
      if (!machine) throw new HttpError(404, "Mesin tidak ditemukan");
      organizationId = organizationId ?? machine.organizationId;
      if (machine.organizationId !== organizationId) {
        throw new HttpError(422, "Mesin bukan milik organisasi ini");
      }
    }
    if (!organizationId) throw new HttpError(422, "organizationId wajib diisi");
    assertOrgScope(user, organizationId);

    // Avoid duplicate open pickups for the same machine.
    if (data.machineId) {
      const open = await prisma.pickupRequest.findFirst({
        where: { machineId: data.machineId, status: { in: PICKUP_OPEN } },
      });
      if (open) {
        return jsonOk({ pickup: open, existing: true });
      }
    }

    const pickup = await prisma.pickupRequest.create({
      data: {
        machineId: data.machineId ?? null,
        organizationId,
        requestedById: user.id,
        reason: data.reason,
        priority: data.priority ?? 0,
        notes: data.notes ?? null,
        status: "REQUESTED",
      },
    });

    await logAudit({
      actorId: user.id,
      action: "PICKUP_CREATE",
      entityType: "PickupRequest",
      entityId: pickup.id,
      metadata: { organizationId, machineId: data.machineId, reason: data.reason },
    });

    return jsonOk({ pickup }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
