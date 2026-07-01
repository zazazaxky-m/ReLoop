import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { generateBagQrCode } from "@/lib/trip";
import { calculateCompliance } from "@/lib/tourism";
import { logAudit } from "@/lib/audit";

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
          },
        },
      },
    });

    if (bags.length > 0) {
      const trip = await prisma.trip.findUnique({
        where: { id: bags[0].tripId },
        include: { campaign: { select: { organizationId: true } } },
      });
      if (trip) {
        assertOrgScope(user, trip.campaign.organizationId);
      }
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

    // One unique QR per physical bag.
    const created = [];
    for (let i = 0; i < data.bagCount; i++) {
      const bag = await prisma.trashBagAssignment.create({
        data: {
          tripId: trip.id,
          assignedById: user.id,
          wasteTypeId: data.wasteTypeId ?? null,
          bagQrCode: generateBagQrCode(),
          bagCount: 1,
        },
      });
      created.push(bag);
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
            campaign: { select: { organizationId: true } },
            _count: { select: { bagAssignments: true } },
          },
        },
      },
    });
    if (!bag) throw new HttpError(404, "Trash bag tidak ditemukan");
    assertOrgScope(user, bag.trip.campaign.organizationId);

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

    const result = await prisma.$transaction(async (tx) => {
      const updatedBag = await tx.trashBagAssignment.update({
        where: { id: bag.id },
        data: { status: data.status, returnedAt: updatedAt },
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
            },
          },
        },
      });

      const validation = await tx.manualValidation.create({
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

      await tx.trip.update({
        where: { id: bag.tripId },
        data: {
          status: allBagsReviewed ? "COMPLETED" : "ACTIVE",
          complianceStatus: compliance.status,
          complianceScore: compliance.score,
          ...(allBagsReviewed ? { checkOutAt: new Date() } : {}),
        },
      });

      return { bag: updatedBag, validation };
    });

    await logAudit({
      actorId: user.id,
      action: "TRASH_BAG_SCAN_UPDATE",
      entityType: "TrashBagAssignment",
      entityId: bag.id,
      metadata: { qrCode: bag.bagQrCode, status: data.status, compliance },
    });

    return jsonOk({ ...result, compliance });
  } catch (error) {
    return handleApiError(error);
  }
}
