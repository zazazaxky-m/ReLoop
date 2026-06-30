import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, assertActivePartnership, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { TRASH_BAG_REWARD_PER_BAG, isRewardableCondition } from "@/lib/trip";
import { calculateCompliance } from "@/lib/tourism";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  tripId: z.string().min(1),
  validationStage: z.enum(["CHECK_IN", "CHECK_OUT", "BANK_SAMPAH_PICKUP"]).default("CHECK_OUT"),
  gateType: z.enum(["ENTRY", "EXIT", "BANK_SAMPAH"]).optional(),
  bagQrCode: z.string().max(60).optional(),
  returnedBagCount: z.number().int().min(0).max(500).default(0),
  actualWeightKg: z.number().min(0).max(100000).nullable().optional(),
  conditionStatus: z.enum(["GOOD", "PARTIAL", "POOR", "NOT_RETURNED"]).optional(),
  appCompleted: z.boolean().default(false),
  notes: z.string().max(500).optional(),
  rewardPerBag: z.number().int().min(0).max(1_000_000).optional(),
  bags: z.array(z.object({
    id: z.string(),
    status: z.enum(["GOOD", "PARTIAL", "POOR", "NOT_RETURNED"])
  })).optional()
});

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "PENGEPUL", "SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    const trip = await prisma.trip.findUnique({
      where: { id: data.tripId },
      include: {
        campaign: { select: { organizationId: true, rewardMode: true, campaignType: true } },
        _count: { select: { bagAssignments: true } },
      },
    });
    if (!trip) throw new HttpError(404, "Trip tidak ditemukan");
    if (user.role === "PENGEPUL") {
      await assertActivePartnership(user.id, trip.campaign.organizationId);
      if (data.validationStage !== "BANK_SAMPAH_PICKUP") {
        throw new HttpError(403, "Pengepul hanya dapat mencatat pickup Bank Sampah");
      }
    } else {
      assertOrgScope(user, trip.campaign.organizationId);
    }

    if (data.bagQrCode) {
      const bag = await prisma.trashBagAssignment.findUnique({
        where: { bagQrCode: data.bagQrCode },
      });
      if (!bag || bag.tripId !== trip.id) {
        throw new HttpError(422, "QR trash bag tidak valid untuk trip ini");
      }
    }

    let finalReturnedBagCount = data.returnedBagCount;
    let finalConditionStatus = data.conditionStatus;
    
    if (data.bags && data.bags.length > 0) {
      finalReturnedBagCount = data.bags.filter(b => b.status !== "NOT_RETURNED").length;
      const allGood = data.bags.every(b => b.status === "GOOD");
      const anyPoor = data.bags.some(b => b.status === "POOR");
      const allLost = data.bags.every(b => b.status === "NOT_RETURNED");
      
      if (allLost) finalConditionStatus = "NOT_RETURNED";
      else if (allGood) finalConditionStatus = "GOOD";
      else if (anyPoor) finalConditionStatus = "POOR";
      else finalConditionStatus = "PARTIAL";
    }

    const rewardPerBag = data.rewardPerBag ?? TRASH_BAG_REWARD_PER_BAG;
    let rewardAmount = 0;
    if (trip.campaign.rewardMode === "MONEY_REWARD" && data.validationStage === "CHECK_OUT" && trip.userId) {
      if (data.bags && data.bags.length > 0) {
        const rewardableBags = data.bags.filter(b => isRewardableCondition(b.status)).length;
        rewardAmount = rewardableBags * rewardPerBag;
      } else if (isRewardableCondition(finalConditionStatus) && finalReturnedBagCount > 0) {
        rewardAmount = finalReturnedBagCount * rewardPerBag;
      }
    }

    const compliance = calculateCompliance({
      stage: data.validationStage,
      appCompleted: data.appCompleted,
      assignedBagCount: trip._count.bagAssignments,
      returnedBagCount: finalReturnedBagCount,
      conditionStatus: finalConditionStatus,
    });

    const result = await prisma.$transaction(async (tx) => {
      if (data.bags && data.bags.length > 0) {
        for (const b of data.bags) {
          await tx.trashBagAssignment.update({
            where: { id: b.id },
            data: { status: b.status, returnedAt: new Date() }
          });
        }
      }

      const validation = await tx.manualValidation.create({
        data: {
          tripId: trip.id,
          validatedById: user.id,
          validationStage: data.validationStage,
          gateType:
            data.gateType ??
            (data.validationStage === "CHECK_IN"
              ? "ENTRY"
              : data.validationStage === "CHECK_OUT"
                ? "EXIT"
                : "BANK_SAMPAH"),
          bagQrCode: data.bagQrCode ?? null,
          returnedBagCount: finalReturnedBagCount,
          actualWeightKg: data.actualWeightKg ?? null,
          conditionStatus: finalConditionStatus ?? null,
          appCompleted: data.appCompleted,
          complianceScore: compliance.score,
          complianceStatus: compliance.status,
          notes: data.notes ?? null,
        },
      });

      if (data.validationStage === "CHECK_IN") {
        await tx.trip.update({
          where: { id: trip.id },
          data: {
            status: "ACTIVE",
            complianceStatus: "CHECKED_IN",
            complianceScore: compliance.score,
            checkInAt: new Date(),
          },
        });
      } else if (data.validationStage === "CHECK_OUT") {
        await tx.trip.update({
          where: { id: trip.id },
          data: {
            status: "COMPLETED",
            complianceStatus: compliance.status,
            complianceScore: compliance.score,
            checkOutAt: new Date(),
          },
        });
      }

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

    return jsonOk({ validation: result, rewardAmount, compliance }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
