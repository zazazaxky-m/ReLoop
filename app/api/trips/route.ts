import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { buildPaginationMeta, parsePagination } from "@/lib/pagination";
import {
  isTrashBagCampaignType,
  requiresTravelAgent,
  getInvitedTravelAgentTripFilters,
} from "@/lib/trip";
import { userWhereEmail } from "@/lib/encryption";

const createSchema = z.object({
  campaignId: z.string().min(1),
  travelAgentId: z.string().min(1).nullable().optional(),
  groupName: z.string().max(160).nullable().optional(),
  leaderName: z.string().max(120).nullable().optional(),
  leaderContact: z.string().max(60).nullable().optional(),
  travelAgentName: z.string().max(160).nullable().optional(),
  participantCount: z.number().int().min(1).max(1000).nullable().optional(),
  userEmail: z.string().email().nullable().optional(),
});

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN", "USER"]);
    const url = new URL(req.url);
    const pagination = parsePagination(url, { defaultLimit: 50, maxLimit: 100 });
    const status = url.searchParams.get("status") ?? undefined;
    const complianceStatus = url.searchParams.get("complianceStatus") ?? undefined;
    const campaignId = url.searchParams.get("campaignId") ?? undefined;
    const q = url.searchParams.get("q")?.trim() || undefined;

    let where: Prisma.TripWhereInput = {};
    if (user.role === "ADMIN") {
      where = { campaign: { organizationId: user.organizationId ?? "__none__" } };
    } else if (user.role === "USER") {
      const invitedAgentOrgs = await getInvitedTravelAgentTripFilters(user.id);
      where = {
        OR: [
          { userId: user.id },
          ...invitedAgentOrgs.map((link) => ({
            travelAgentId: link.travelAgentId,
            campaign: { organizationId: link.organizationId },
          })),
        ],
      };
    }

    if (status) where = { AND: [where, { status: status as Prisma.EnumTripStatusFilter["equals"] }] };
    if (complianceStatus) {
      where = {
        AND: [where, { complianceStatus: complianceStatus as Prisma.EnumComplianceStatusFilter["equals"] }],
      };
    }
    if (campaignId) where = { AND: [where, { campaignId }] };
    if (q) {
      where = {
        AND: [
          where,
          {
            OR: [
              { groupName: { contains: q, mode: "insensitive" } },
              { leaderName: { contains: q, mode: "insensitive" } },
              { travelAgentName: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      };
    }

    const [total, trips] = await Promise.all([
      prisma.trip.count({ where }),
      prisma.trip.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
              organizationId: true,
              rewardMode: true,
              campaignType: true,
            },
          },
          travelAgent: { select: { id: true, name: true, email: true } },
          user: { select: { id: true, name: true, email: true } },
          _count: { select: { bagAssignments: true, validations: true } },
        },
      }),
    ]);

    return jsonOk({
      trips,
      pagination: buildPaginationMeta(total, pagination),
    });
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

    if (!isTrashBagCampaignType(campaign.campaignType)) {
      throw new HttpError(
        422,
        "Trip hanya dapat dibuat untuk campaign Trash Bag atau Program Wisata",
      );
    }
    if (campaign.status !== "ACTIVE") {
      throw new HttpError(
        422,
        "Campaign harus berstatus ACTIVE sebelum membuat trip",
      );
    }
    const now = new Date();
    if (campaign.startAt && campaign.startAt > now) {
      throw new HttpError(422, "Campaign belum dimulai");
    }
    if (campaign.endAt && campaign.endAt < now) {
      throw new HttpError(422, "Campaign sudah berakhir");
    }

    const agentRequired = requiresTravelAgent(campaign.campaignType);
    if (agentRequired && !data.travelAgentId) {
      throw new HttpError(
        422,
        "Program Wisata wajib memilih travel agent yang sudah invited",
      );
    }
    if (!data.travelAgentId && data.travelAgentName) {
      throw new HttpError(
        422,
        "Nama travel agent manual tidak diizinkan. Undang agent resmi atau biarkan kosong untuk Trash Bag",
      );
    }

    if (campaign.rewardMode === "MONEY_REWARD" && !data.userEmail) {
      throw new HttpError(
        422,
        "Campaign reward uang wajib mengisi email user penerima reward",
      );
    }

    let travelAgentName: string | null = null;
    if (data.travelAgentId) {
      const agentLink = await prisma.travelAgentOrganization.findUnique({
        where: {
          travelAgentId_organizationId: {
            travelAgentId: data.travelAgentId,
            organizationId: campaign.organizationId,
          },
        },
        include: { travelAgent: { select: { name: true, status: true } } },
      });
      if (!agentLink || agentLink.status !== "INVITED") {
        throw new HttpError(422, "Travel agent belum berstatus invited di organisasi ini");
      }
      if (agentLink.travelAgent.status !== "ACTIVE") {
        throw new HttpError(422, "Travel agent tidak aktif");
      }
      travelAgentName = agentLink.travelAgent.name;
    }

    let userId: string | null = null;
    if (data.userEmail) {
      const u = await prisma.user.findUnique({ where: userWhereEmail(data.userEmail) });
      if (!u) throw new HttpError(404, "Pengguna dengan email tersebut tidak ditemukan");
      userId = u.id;
    }

    const trip = await prisma.trip.create({
      data: {
        campaignId: campaign.id,
        userId,
        travelAgentId: data.travelAgentId ?? null,
        travelAgentName,
        groupName: data.groupName ?? null,
        leaderName: data.leaderName ?? null,
        leaderContact: data.leaderContact ?? null,
        participantCount: data.participantCount ?? 1,
        status: "PLANNED",
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        campaign: { select: { id: true, name: true, rewardMode: true, campaignType: true } },
      },
    });

    await logAudit({
      actorId: user.id,
      action: "TRIP_CREATE",
      entityType: "Trip",
      entityId: trip.id,
      metadata: { campaignId: campaign.id, campaignType: campaign.campaignType, userId },
    });

    return jsonOk({ trip }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
