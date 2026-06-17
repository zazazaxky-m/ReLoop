import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  campaignId: z.string().min(1),
  groupName: z.string().max(160).optional(),
  leaderName: z.string().max(120).optional(),
  leaderContact: z.string().max(60).optional(),
  travelAgentName: z.string().max(160).optional(),
  participantCount: z.number().int().min(1).max(1000).optional(),
  userEmail: z.string().email().optional(),
});

export async function GET() {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN", "USER"]);

    let where: Prisma.TripWhereInput = {};
    if (user.role === "ADMIN") {
      where = { campaign: { organizationId: user.organizationId ?? "__none__" } };
    } else if (user.role === "USER") {
      where = { userId: user.id };
    }

    const trips = await prisma.trip.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        campaign: { select: { id: true, name: true, organizationId: true } },
        _count: { select: { bagAssignments: true, validations: true } },
      },
    });
    return jsonOk({ trips });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    const campaign = await prisma.campaign.findUnique({ where: { id: data.campaignId } });
    if (!campaign) throw new HttpError(404, "Campaign tidak ditemukan");
    assertOrgScope(user, campaign.organizationId);

    let userId: string | null = null;
    if (data.userEmail) {
      const u = await prisma.user.findUnique({ where: { email: data.userEmail.toLowerCase() } });
      if (!u) throw new HttpError(404, "Pengguna dengan email tersebut tidak ditemukan");
      userId = u.id;
    }

    const trip = await prisma.trip.create({
      data: {
        campaignId: campaign.id,
        userId,
        travelAgentName: data.travelAgentName ?? null,
        groupName: data.groupName ?? null,
        leaderName: data.leaderName ?? null,
        leaderContact: data.leaderContact ?? null,
        participantCount: data.participantCount ?? 1,
        status: "PLANNED",
      },
    });

    await logAudit({
      actorId: user.id,
      action: "TRIP_CREATE",
      entityType: "Trip",
      entityId: trip.id,
      metadata: { campaignId: campaign.id },
    });

    return jsonOk({ trip }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
