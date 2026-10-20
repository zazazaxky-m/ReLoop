import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  requireApiUser,
  assertOrgScope,
  HttpError,
} from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { PICKUP_OPEN } from "@/lib/pickup";
import { createReplacementPickup, escalateOnAdminRead, withDispatch } from "@/lib/pickup-dispatch";
import { logAudit } from "@/lib/audit";
import { buildPaginationMeta, parsePagination } from "@/lib/pagination";

const createSchema = z.object({
  machineId: z.string().optional(),
  organizationId: z.string().optional(),
  reason: z.enum(["FULL", "SCHEDULED", "MANUAL", "ERROR"]).default("MANUAL"),
  priority: z.number().int().min(0).max(5).optional(),
  notes: z.string().max(500).optional(),
  /** B05: the FAILED/CANCELLED task this request replaces (recorded reassignment path). */
  replacesPickupId: z.string().max(128).optional(),
});

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "PENGEPUL", "SUPERADMIN"]);
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope");
    const statusFilter = url.searchParams.get("status") ?? undefined;
    const pagination = parsePagination(url);

    // B05: pickup is admin dispatch. There is no pool of unassigned tasks for
    // collectors to claim; older apps asking for scope=available get an empty
    // list in the same shape.
    if (user.role === "PENGEPUL" && scope === "available") {
      return jsonOk({ pickups: [], pagination: buildPaginationMeta(0, pagination) });
    }

    const where: Prisma.PickupRequestWhereInput = {};
    if (user.role === "ADMIN") {
      where.organizationId = user.organizationId ?? "__none__";
    } else if (user.role === "PENGEPUL") {
      where.assignedCollectorId = user.id;
    }
    if (statusFilter) {
      where.status = statusFilter as Prisma.EnumPickupStatusFilter["equals"];
    }

    // B05: admin list reads run the once-per-version overdue escalation.
    await escalateOnAdminRead(user);

    const [total, pickups] = await Promise.all([
      prisma.pickupRequest.count({ where }),
      prisma.pickupRequest.findMany({
        where,
        orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
        skip: pagination.skip,
        take: pagination.take,
        include: {
          machine: { select: { id: true, name: true, machineCode: true, fillLevelPercent: true } },
          organization: { select: { id: true, name: true, contactName: true, contactPhone: true, address: true } },
          assignedCollector: { select: { id: true, name: true } },
          items: { include: { wasteType: { select: { name: true } } } },
          replacedBy: { select: { id: true, status: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);

    const now = new Date();
    return jsonOk({
      pickups: pickups.map((pickup) => withDispatch(pickup, now)),
      pagination: buildPaginationMeta(total, pagination),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    if (data.replacesPickupId) {
      const { pickup, existing } = await createReplacementPickup(user, data.replacesPickupId, {
        priority: data.priority,
        notes: data.notes,
      });
      return jsonOk({ pickup, existing }, existing ? 200 : 201);
    }

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
