import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import {
  PickupDispatchError,
  assignPickup,
  escalateOnAdminRead,
  transitionPickup,
  versionRequired,
  withDispatch,
} from "@/lib/pickup-dispatch";

const patchSchema = z.object({
  action: z.enum(["assign", "start", "arrive", "collect", "complete", "fail", "cancel"]),
  /** Existing request field; stored as PickupRequest.assignedCollectorId. */
  collectorUserId: z.string().max(128).optional(),
  /** B05: the PickupRequest.version the client last saw (compare-and-set). */
  expectedVersion: z.number().int().min(0).max(2_147_483_647).optional(),
  /** B05 (assign): start deadline chosen by the operator, ISO-8601 with offset. */
  expectedStartAt: z.string().max(64).nullable().optional(),
  /** B05 (cancel/fail): required reason. */
  reason: z.string().max(1000).optional(),
  notes: z.string().max(500).optional(),
});

function pickupErrorResponse(error: unknown) {
  if (error instanceof PickupDispatchError) {
    return jsonError(error.status, error.message, { code: error.code });
  }
  return handleApiError(error);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "PENGEPUL", "SUPERADMIN"]);
    const { id } = await params;

    // B05: admin detail reads run the once-per-version overdue escalation.
    await escalateOnAdminRead(user, { pickupIds: [id] });

    const pickup = await prisma.pickupRequest.findUnique({
      where: { id },
      include: {
        machine: { select: { id: true, name: true, machineCode: true, fillLevelPercent: true } },
        organization: { select: { id: true, name: true, address: true, contactName: true, contactPhone: true } },
        assignedCollector: { select: { id: true, name: true, phone: true } },
        items: { include: { wasteType: { select: { name: true } } } },
        replacedBy: { select: { id: true, status: true } },
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

    return jsonOk({ pickup: withDispatch(pickup) });
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

    let pickup;
    if (body.action === "assign") {
      if (user.role !== "ADMIN" && user.role !== "SUPERADMIN") {
        throw new HttpError(403, "Penugasan pengepul dilakukan oleh admin organisasi");
      }
      // No permissive fallback: a dispatch decision always carries the operator's version.
      if (body.expectedVersion === undefined) throw versionRequired();
      if (!body.collectorUserId) throw new HttpError(422, "collectorUserId wajib diisi");
      pickup = await assignPickup(user, id, {
        collectorId: body.collectorUserId,
        expectedVersion: body.expectedVersion,
        expectedStartAt: body.expectedStartAt ?? undefined,
      });
    } else {
      pickup = await transitionPickup(user, id, {
        action: body.action,
        expectedVersion: body.expectedVersion,
        reason: body.reason,
        notes: body.notes,
      });
    }

    return jsonOk({ pickup: withDispatch(pickup) });
  } catch (error) {
    return pickupErrorResponse(error);
  }
}
