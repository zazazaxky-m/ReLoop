import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import {
  generateBagQrCode,
  canIssueBagsForTripStatus,
  TRASH_BAG_REWARD_PER_BAG,
  isRewardableCondition,
  computeTrashBagRewardAmount,
  getTripTravelAgentGateBlockReason,
} from "@/lib/trip";
import { calculateCompliance } from "@/lib/tourism";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications";
import { formatRupiah } from "@/lib/format";

const createSchema = z.object({
  tripId: z.string().min(1),
  bagCount: z.number().int().min(1).max(200),
  wasteTypeId: z.string().min(1).optional(),
});

const updateSchema = z.object({
  id: z.string().min(1).optional(),
  qrCode: z.string().min(1).max(60).optional(),
  status: z.enum(["GOOD", "PARTIAL", "POOR", "NOT_RETURNED"]),
  appCompleted: z.boolean().default(true),
  actualWeightKg: z.number().min(0).max(100000).nullable().optional(),
  notes: z.string().max(500).optional(),
});

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { searchParams } = new URL(req.url);
    const tripId = searchParams.get("tripId");
    const qrCode = searchParams.get("qrCode");

    if (!tripId && !qrCode) {
      throw new HttpError(400, "tripId atau qrCode harus diisi");
    }

    const where: any = {};
    if (tripId) where.tripId = tripId;
    if (qrCode) where.bagQrCode = qrCode;

    const bags = await prisma.trashBagAssignment.findMany({
      where,
      orderBy: { assignedAt: "asc" },
      include: {
        wasteType: { select: { name: true } },
        trip: {
          select: {
            id: true,
            groupName: true,
            leaderName: true,
            participantCount: true,
            complianceStatus: true,
            campaign: { select: { organizationId: true, name: true } },
            travelAgent: { select: { name: true } },
            status: true,
          },
        },
      },
    });

    if (bags.length > 0) {
      const orgId = bags[0].trip.campaign.organizationId;
      assertOrgScope(user, orgId);
    }

    return jsonOk({ bags });
  } catch (error) {
    return handleApiError(error);
  }
}

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
    if (!canIssueBagsForTripStatus(trip.status)) {
      throw new HttpError(
        422,
        "Kantong hanya dapat diterbitkan untuk trip PLANNED atau ACTIVE",
      );
    }
    const agentBlock = await getTripTravelAgentGateBlockReason({
      travelAgentId: trip.travelAgentId,
      organizationId: trip.campaign.organizationId,
    });
    if (agentBlock) throw new HttpError(422, agentBlock);

    if (data.wasteTypeId) {
      const wasteType = await prisma.wasteType.findFirst({
        where: {
          id: data.wasteTypeId,
          active: true,
          OR: [
            { organizationId: null },
            { organizationId: trip.campaign.organizationId },
          ],
        },
        select: { id: true },
      });
      if (!wasteType) {
        throw new HttpError(422, "Jenis sampah tidak aktif atau di luar organisasi trip");
      }
    }

    // One unique QR per physical bag — bulk insert with retry on rare unique collisions.
    const maxAttempts = 5;
    let qrCodes: string[] = [];
    let created: Awaited<ReturnType<typeof prisma.trashBagAssignment.findMany>> = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      qrCodes = Array.from({ length: data.bagCount }, () => generateBagQrCode());
      try {
        await prisma.trashBagAssignment.createMany({
          data: qrCodes.map((bagQrCode) => ({
            tripId: trip.id,
            assignedById: user.id,
            wasteTypeId: data.wasteTypeId ?? null,
            bagQrCode,
            bagCount: 1,
          })),
        });
        created = await prisma.trashBagAssignment.findMany({
          where: { tripId: trip.id, bagQrCode: { in: qrCodes } },
          orderBy: { assignedAt: "asc" },
        });
        break;
      } catch (err: unknown) {
        const code =
          err && typeof err === "object" && "code" in err
            ? String((err as { code: unknown }).code)
            : "";
        if (code !== "P2002" || attempt === maxAttempts) throw err;
      }
    }

    await logAudit({
      actorId: user.id,
      action: "TRASH_BAG_ASSIGN",
      entityType: "Trip",
      entityId: trip.id,
      metadata: { bagCount: data.bagCount, wasteTypeId: data.wasteTypeId ?? null },
    });

    return jsonOk({ bags: created }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const data = updateSchema.parse(await req.json());
    if (!data.id && !data.qrCode) {
      throw new HttpError(422, "id atau qrCode wajib diisi");
    }

    const bag = await prisma.trashBagAssignment.findFirst({
      where: data.id ? { id: data.id } : { bagQrCode: data.qrCode },
      include: {
        trip: {
          include: {
            campaign: {
              select: {
                organizationId: true,
                rewardMode: true,
                rewardMultiplier: true,
                name: true,
              },
            },
            _count: { select: { bagAssignments: true } },
          },
        },
      },
    });
    if (!bag) throw new HttpError(404, "Trash bag tidak ditemukan");
    assertOrgScope(user, bag.trip.campaign.organizationId);

    if (bag.trip.status === "CANCELLED") {
      throw new HttpError(422, "Trip sudah dibatalkan");
    }
    if (bag.trip.status === "COMPLETED") {
      throw new HttpError(422, "Trip sudah selesai; scan kantong tidak dapat diulang");
    }
    if (bag.trip.status !== "ACTIVE" && bag.trip.status !== "PLANNED") {
      throw new HttpError(422, "Scan kantong hanya untuk trip PLANNED atau ACTIVE");
    }
    // Progressive per-bag checkout requires check-in first (ACTIVE).
    if (bag.trip.status === "PLANNED") {
      throw new HttpError(422, "Lakukan check-in terlebih dahulu sebelum scan kondisi kantong");
    }
    const agentBlock = await getTripTravelAgentGateBlockReason({
      travelAgentId: bag.trip.travelAgentId,
      organizationId: bag.trip.campaign.organizationId,
    });
    if (agentBlock) throw new HttpError(422, agentBlock);

    const updatedAt = data.status === "NOT_RETURNED" ? null : new Date();
    const siblingBags = await prisma.trashBagAssignment.findMany({
      where: { tripId: bag.tripId },
      select: { id: true, status: true },
    });
    const statuses = siblingBags.map((item) =>
      item.id === bag.id ? data.status : item.status,
    );
    const allBagsReviewed = statuses.every(Boolean);
    const returnedBagCount = statuses.filter((status) => status && status !== "NOT_RETURNED").length;
    const knownStatuses = statuses.filter(Boolean) as Array<"GOOD" | "PARTIAL" | "POOR" | "NOT_RETURNED">;
    const conditionStatus =
      knownStatuses.length === 0
        ? data.status
        : knownStatuses.every((status) => status === "NOT_RETURNED")
          ? "NOT_RETURNED"
          : knownStatuses.every((status) => status === "GOOD")
            ? "GOOD"
            : knownStatuses.some((status) => status === "POOR")
              ? "POOR"
              : "PARTIAL";

    const compliance = calculateCompliance({
      stage: "CHECK_OUT",
      appCompleted: data.appCompleted,
      assignedBagCount: bag.trip._count.bagAssignments,
      returnedBagCount,
      conditionStatus,
    });

    let rewardAmount = 0;
    if (
      allBagsReviewed &&
      bag.trip.campaign.rewardMode === "MONEY_REWARD" &&
      bag.trip.userId
    ) {
      const rewardableBagCount = knownStatuses.filter((s) => isRewardableCondition(s)).length;
      rewardAmount = computeTrashBagRewardAmount({
        rewardableBagCount,
        complianceScore: compliance.score,
        rewardMultiplier: bag.trip.campaign.rewardMultiplier,
        rewardPerBag: TRASH_BAG_REWARD_PER_BAG,
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedBag = await tx.trashBagAssignment.update({
        where: { id: bag.id },
        data: { status: data.status, returnedAt: updatedAt },
        include: {
          wasteType: { select: { name: true } },
          trip: {
            select: {
              id: true,
              status: true,
              groupName: true,
              leaderName: true,
              participantCount: true,
              complianceStatus: true,
              campaign: { select: { organizationId: true, name: true } },
              travelAgent: { select: { name: true } },
            },
          },
        },
      });

      // Avoid noisy per-bag CHECK_OUT rows — only record gate validation when trip completes.
      let validation = null;
      if (allBagsReviewed) {
        validation = await tx.manualValidation.create({
          data: {
            tripId: bag.tripId,
            validatedById: user.id,
            validationStage: "CHECK_OUT",
            gateType: "EXIT",
            bagQrCode: bag.bagQrCode,
            returnedBagCount,
            actualWeightKg: data.actualWeightKg ?? null,
            conditionStatus,
            appCompleted: data.appCompleted,
            complianceScore: compliance.score,
            complianceStatus: compliance.status,
            notes: data.notes ?? null,
          },
        });
      }

      await tx.trip.update({
        where: { id: bag.tripId },
        data: {
          status: allBagsReviewed ? "COMPLETED" : "ACTIVE",
          complianceStatus: compliance.status,
          complianceScore: compliance.score,
          ...(allBagsReviewed ? { checkOutAt: new Date() } : {}),
        },
      });

      if (rewardAmount > 0 && bag.trip.userId && allBagsReviewed) {
        const existingReward = await tx.rewardLedger.findFirst({
          where: {
            userId: bag.trip.userId,
            campaignId: bag.trip.campaignId,
            reasonCode: "TRASH_BAG_RETURN",
            referenceType: "Trip",
            referenceId: bag.tripId,
          },
          select: { id: true },
        });
        if (!existingReward) {
          await tx.rewardLedger.create({
            data: {
              userId: bag.trip.userId,
              organizationId: bag.trip.campaign.organizationId,
              campaignId: bag.trip.campaignId,
              entryType: "EARN",
              amount: rewardAmount,
              status: "AVAILABLE",
              reasonCode: "TRASH_BAG_RETURN",
              referenceType: "Trip",
              referenceId: bag.tripId,
            },
          });
          return { bag: updatedBag, validation, rewardAmount };
        }
      }

      return { bag: updatedBag, validation, rewardAmount: 0 };
    });

    await logAudit({
      actorId: user.id,
      action: "TRASH_BAG_SCAN_UPDATE",
      entityType: "TrashBagAssignment",
      entityId: bag.id,
      metadata: {
        qrCode: bag.bagQrCode,
        status: data.status,
        compliance,
        rewardAmount: result.rewardAmount,
      },
    });

    if (allBagsReviewed) {
      const notifyUserIds = new Set<string>();
      if (bag.trip.userId) notifyUserIds.add(bag.trip.userId);
      if (bag.trip.travelAgentId) {
        const agentUsers = await prisma.travelAgentUser.findMany({
          where: { travelAgentId: bag.trip.travelAgentId },
          select: { userId: true },
        });
        const invited = await prisma.travelAgentOrganization.findMany({
          where: {
            travelAgentId: bag.trip.travelAgentId,
            organizationId: bag.trip.campaign.organizationId,
            status: "INVITED",
          },
          select: { id: true },
        });
        if (invited.length > 0) {
          for (const link of agentUsers) notifyUserIds.add(link.userId);
        }
      }
      const groupLabel = bag.trip.groupName ?? bag.trip.campaign.name ?? "Trip";
      for (const userId of notifyUserIds) {
        void createNotification({
          userId,
          type: "TRIP_STATUS",
          title: "Trip check-out",
          body: `${groupLabel}: check-out selesai (skor ${compliance.score}/100).`,
          data: { tripId: bag.tripId, stage: "CHECK_OUT" },
        });
        if (result.rewardAmount > 0 && userId === bag.trip.userId) {
          void createNotification({
            userId,
            type: "TRASH_BAG_REWARD",
            title: "Reward trash bag masuk",
            body: `${formatRupiah(result.rewardAmount)} dari trip ${groupLabel} sudah tersedia di dompet.`,
            data: { tripId: bag.tripId, rewardAmount: result.rewardAmount },
          });
        }
      }
    }

    return jsonOk({
      bag: result.bag,
      validation: result.validation,
      compliance,
      rewardAmount: result.rewardAmount,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
