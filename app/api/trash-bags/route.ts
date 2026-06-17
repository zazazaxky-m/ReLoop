import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { generateBagQrCode } from "@/lib/trip";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  tripId: z.string().min(1),
  bagCount: z.number().int().min(1).max(200),
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

    // One unique QR per physical bag.
    const created = [];
    for (let i = 0; i < data.bagCount; i++) {
      const bag = await prisma.trashBagAssignment.create({
        data: {
          tripId: trip.id,
          assignedById: user.id,
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
      metadata: { bagCount: data.bagCount },
    });

    return jsonOk({ bags: created }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
