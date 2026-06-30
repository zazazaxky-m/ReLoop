import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { generateBagQrCode } from "@/lib/trip";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  tripId: z.string().min(1),
  bagCount: z.number().int().min(1).max(200),
  wasteTypeId: z.string().min(1).optional(),
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
