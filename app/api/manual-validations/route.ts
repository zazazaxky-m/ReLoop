import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { TRASH_BAG_REWARD_PER_BAG, isRewardableCondition } from "@/lib/trip";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  tripId: z.string().min(1),
  bagQrCode: z.string().max(60).optional(),
  returnedBagCount: z.number().int().min(0).max(500).default(0),
  actualWeightKg: z.number().min(0).max(100000).nullable().optional(),
  conditionStatus: z.enum(["GOOD", "PARTIAL", "POOR", "NOT_RETURNED"]).optional(),
  notes: z.string().max(500).optional(),
  rewardPerBag: z.number().int().min(0).max(1_000_000).optional(),
});

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    const trip = await prisma.trip.findUnique({
      where: { id: data.tripId },
      include: { campaign: { select: { organizationId: true } } },
    });
    if (!trip) throw new HttpError(404, "Trip tidak ditemukan");
    assertOrgScope(user, trip.campaign.organizationId);

    // If a specific bag QR is given, ensure it belongs to this trip.
    if (data.bagQrCode) {
      const bag = await prisma.trashBagAssignment.findUnique({
        where: { bagQrCode: data.bagQrCode },
      });
      if (!bag || bag.tripId !== trip.id) {
        throw new HttpError(422, "QR trash bag tidak valid untuk trip ini");
      }
    }

    const rewardPerBag = data.rewardPerBag ?? TRASH_BAG_REWARD_PER_BAG;
    const rewardable =
      trip.userId &&
      isRewardableCondition(data.conditionStatus) &&
      data.returnedBagCount > 0;
    const rewardAmount = rewardable ? data.returnedBagCount * rewardPerBag : 0;

    const result = await prisma.$transaction(async (tx) => {
      const validation = await tx.manualValidation.create({
        data: {
          tripId: trip.id,
          validatedById: user.id,
          bagQrCode: data.bagQrCode ?? null,
          returnedBagCount: data.returnedBagCount,
          actualWeightKg: data.actualWeightKg ?? null,
          conditionStatus: data.conditionStatus ?? null,
          notes: data.notes ?? null,
        },
      });

      if (rewardAmount > 0 && trip.userId) {
        await tx.rewardLedger.create({
          data: {
            userId: trip.userId,
            organizationId: trip.campaign.organizationId,
            campaignId: trip.campaignId,
            entryType: "EARN",
            amount: rewardAmount,
            status: "AVAILABLE",
            reasonCode: "TRASH_BAG_RETURN",
            referenceType: "ManualValidation",
            referenceId: validation.id,
          },
        });
      }
      return validation;
    });

    await logAudit({
      actorId: user.id,
      action: "MANUAL_VALIDATION",
      entityType: "ManualValidation",
      entityId: result.id,
      metadata: { tripId: trip.id, rewardAmount },
    });

    return jsonOk({ validation: result, rewardAmount }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
