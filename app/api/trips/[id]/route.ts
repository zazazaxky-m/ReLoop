import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { TRIP_CHANGED, canManuallySetTripStatus } from "@/lib/trip";
import { VERIFIED_MEMBERSHIP } from "@/lib/travel-agent-access";

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
  if (role === "USER") {
    if (trip.userId === userId) return trip;
    if (trip.travelAgentId) {
      const [userLink, orgLink] = await Promise.all([
        // A03: only a membership verified from the invited mailbox counts.
        prisma.travelAgentUser.findFirst({
          where: { userId, travelAgentId: trip.travelAgentId, ...VERIFIED_MEMBERSHIP },
          select: { id: true },
        }),
        prisma.travelAgentOrganization.findUnique({
          where: {
            travelAgentId_organizationId: {
              travelAgentId: trip.travelAgentId,
              organizationId: trip.campaign.organizationId,
            },
          },
          select: { status: true },
        }),
      ]);
      if (userLink && orgLink?.status === "INVITED") return trip;
    }
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
        campaign: { select: { id: true, name: true, rewardMode: true, campaignType: true } },
        travelAgent: { select: { id: true, name: true, email: true } },
        user: { select: { id: true, name: true, email: true } },
        bagAssignments: {
          orderBy: { assignedAt: "desc" },
          include: { wasteType: { select: { name: true } } },
        },
        validations: { orderBy: { createdAt: "desc" } },
      },
    });

    let trashBagRewardAmount = 0;
    if (trip?.userId) {
      const reward = await prisma.rewardLedger.aggregate({
        where: {
          userId: trip.userId,
          campaignId: trip.campaignId,
          reasonCode: "TRASH_BAG_RETURN",
          OR: [
            { referenceType: "Trip", referenceId: trip.id },
            {
              referenceType: "ManualValidation",
              referenceId: { in: trip.validations.map((v) => v.id) },
            },
          ],
        },
        _sum: { amount: true },
      });
      trashBagRewardAmount = reward._sum.amount ?? 0;
    }

    // loadScopedTrip already 404s if missing; a null here is a race — treat as not found.
    if (!trip) throw new HttpError(404, "Trip tidak ditemukan");
    return jsonOk({ trip: { ...trip, trashBagRewardAmount } });
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
    const existing = await loadScopedTrip(id, user.role, user.organizationId, user.id);
    const { status } = patchSchema.parse(await req.json());

    const allowed = canManuallySetTripStatus(existing.status, status);
    if (!allowed.ok) {
      throw new HttpError(422, allowed.reason!);
    }

    // Compare-and-set: a check-out that closed the trip meanwhile (under the
    // trip lock, lib/trip-validation.ts) must not be overwritten by a cancel
    // decided on the status read above.
    const { count } = await prisma.trip.updateMany({ where: { id, status: existing.status }, data: { status } });
    if (count !== 1) throw new HttpError(409, TRIP_CHANGED);
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id } });
    await logAudit({
      actorId: user.id,
      action: "TRIP_STATUS",
      entityType: "Trip",
      entityId: id,
      metadata: { from: existing.status, to: status },
    });
    return jsonOk({ trip });
  } catch (error) {
    return handleApiError(error);
  }
}
