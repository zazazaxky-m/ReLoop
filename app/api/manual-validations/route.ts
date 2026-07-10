import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, assertActivePartnership, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { TRASH_BAG_REWARD_PER_BAG, isRewardableCondition, computeTrashBagRewardAmount, canValidateTripStage, getTripTravelAgentGateBlockReason } from "@/lib/trip";
import { calculateCompliance } from "@/lib/tourism";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { formatRupiah } from "@/lib/format";

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
        campaign: { select: { organizationId: true, rewardMode: true, campaignType: true, rewardMultiplier: true, name: true } },
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

    // Gate ops require invited agent; bank-sampah pickup after COMPLETED is allowed even if later suspended.
    if (data.validationStage !== "BANK_SAMPAH_PICKUP") {
      const agentBlock = await getTripTravelAgentGateBlockReason({
        travelAgentId: trip.travelAgentId,
        organizationId: trip.campaign.organizationId,
      });
      if (agentBlock) throw new HttpError(422, agentBlock);
    }

    const stageGuard = canValidateTripStage(trip.status, data.validationStage);
    if (!stageGuard.ok) {
      throw new HttpError(422, stageGuard.reason!);
    }

    if (data.validationStage === "BANK_SAMPAH_PICKUP") {
      const existingPickup = await prisma.manualValidation.findFirst({
        where: { tripId: trip.id, validationStage: "BANK_SAMPAH_PICKUP" },
        select: { id: true },
      });
      if (existingPickup) {
        throw new HttpError(422, "Pickup bank sampah untuk trip ini sudah dicatat");
      }
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

    const compliance = calculateCompliance({
      stage: data.validationStage,
      appCompleted: data.appCompleted,
      assignedBagCount: trip._count.bagAssignments,
      returnedBagCount: finalReturnedBagCount,
      conditionStatus: finalConditionStatus,
    });

    const rewardPerBag = TRASH_BAG_REWARD_PER_BAG;
    let rewardableBagCount = 0;
    let rewardAmount = 0;
    if (trip.campaign.rewardMode === "MONEY_REWARD" && data.validationStage === "CHECK_OUT" && trip.userId) {
      if (data.bags && data.bags.length > 0) {
        rewardableBagCount = data.bags.filter((b) => isRewardableCondition(b.status)).length;
      } else if (isRewardableCondition(finalConditionStatus) && finalReturnedBagCount > 0) {
        rewardableBagCount = finalReturnedBagCount;
      }

      rewardAmount = computeTrashBagRewardAmount({
        rewardableBagCount,
        complianceScore: compliance.score,
        rewardMultiplier: trip.campaign.rewardMultiplier,
        rewardPerBag,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      if (data.bags && data.bags.length > 0) {
        const returnedAt = new Date();
        await Promise.all(
          data.bags.map((b) =>
            tx.trashBagAssignment.update({
              where: { id: b.id },
              data: {
                status: b.status,
                // NOT_RETURNED means the bag was never returned — do not stamp returnedAt.
                returnedAt: b.status === "NOT_RETURNED" ? null : returnedAt,
              },
            }),
          ),
        );
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
        // Prefer Trip-scoped idempotency so progressive PATCH + bulk CHECK_OUT cannot double-pay.
        const existingReward = await tx.rewardLedger.findFirst({
          where: {
            userId: trip.userId,
            campaignId: trip.campaignId,
            reasonCode: "TRASH_BAG_RETURN",
            OR: [
              { referenceType: "Trip", referenceId: trip.id },
              { referenceType: "ManualValidation", referenceId: validation.id },
            ],
          },
          select: { id: true },
        });
        if (!existingReward) {
          await tx.rewardLedger.create({
            data: {
              userId: trip.userId,
              organizationId: trip.campaign.organizationId,
              campaignId: trip.campaignId,
              entryType: "EARN",
              amount: rewardAmount,
              status: "AVAILABLE",
              reasonCode: "TRASH_BAG_RETURN",
              referenceType: "Trip",
              referenceId: trip.id,
            },
          });
          return { validation, rewardAmount };
        }
      }
      return { validation, rewardAmount: 0 };
    });

    await logAudit({
      actorId: user.id,
      action: "MANUAL_VALIDATION",
      entityType: "ManualValidation",
      entityId: result.validation.id,
      metadata: { tripId: trip.id, rewardAmount: result.rewardAmount },
    });

    // Best-effort in-app notifications for trip stakeholders.
    const notifyUserIds = new Set<string>();
    if (trip.userId) notifyUserIds.add(trip.userId);
    if (trip.travelAgentId) {
      const agentUsers = await prisma.travelAgentUser.findMany({
        where: { travelAgentId: trip.travelAgentId },
        select: { userId: true },
      });
      const invited = await prisma.travelAgentOrganization.findMany({
        where: {
          travelAgentId: trip.travelAgentId,
          organizationId: trip.campaign.organizationId,
          status: "INVITED",
        },
        select: { id: true },
      });
      if (invited.length > 0) {
        for (const link of agentUsers) notifyUserIds.add(link.userId);
      }
    }
    const groupLabel = trip.groupName ?? trip.campaign.name;
    const stageLabel =
      data.validationStage === "CHECK_IN"
        ? "check-in"
        : data.validationStage === "CHECK_OUT"
          ? "check-out"
          : "pickup bank sampah";
    for (const userId of notifyUserIds) {
      void createNotification({
        userId,
        type: "TRIP_STATUS",
        title: `Trip ${stageLabel}`,
        body: `${groupLabel}: status ${stageLabel} tercatat (skor ${compliance.score}/100).`,
        data: { tripId: trip.id, stage: data.validationStage },
      });
      if (result.rewardAmount > 0 && userId === trip.userId) {
        void createNotification({
          userId,
          type: "TRASH_BAG_REWARD",
          title: "Reward trash bag masuk",
          body: `${formatRupiah(result.rewardAmount)} dari trip ${groupLabel} sudah tersedia di dompet.`,
          data: { tripId: trip.id, rewardAmount: result.rewardAmount },
        });
      }
    }

    return jsonOk(
      { validation: result.validation, rewardAmount: result.rewardAmount, compliance },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
