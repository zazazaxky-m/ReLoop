import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { normalizeEmailDomains } from "@/lib/campaign";
import { logAudit } from "@/lib/audit";

const createSchema = z
  .object({
    name: z.string().min(2).max(160),
    description: z.string().max(1000).nullable().optional(),
    campaignType: z
      .enum(["MACHINE_DEPOSIT", "TRASH_BAG", "EVENT", "SCHOOL_PROGRAM", "TOURISM_PROGRAM"])
      .default("MACHINE_DEPOSIT"),
    rewardMode: z.enum(["MONEY_REWARD", "COMPLIANCE_ONLY"]).default("MONEY_REWARD"),
    visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
    allowedEmailDomains: z.array(z.string()).optional(),
    startAt: z.string().datetime().nullable().optional(),
    endAt: z.string().datetime().nullable().optional(),
    rewardMultiplier: z.number().min(0).max(100).nullable().optional(),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ENDED"]).default("DRAFT"),
    // Superadmin must specify; admin uses own org.
    organizationId: z.string().optional(),
  })
  .refine(
    (d) => !d.startAt || !d.endAt || new Date(d.startAt) <= new Date(d.endAt),
    { message: "Tanggal mulai harus sebelum tanggal selesai", path: ["startAt"] },
  );

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const url = new URL(req.url);
    const orgFilter = url.searchParams.get("organizationId") ?? undefined;

    const where: Prisma.CampaignWhereInput = {};
    if (user.role === "ADMIN") {
      where.organizationId = user.organizationId ?? "__none__";
    } else if (orgFilter) {
      where.organizationId = orgFilter;
    }

    const campaigns = await prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        organization: { select: { id: true, name: true } },
        _count: { select: { sessions: true } },
      },
    });

    return jsonOk({ campaigns });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    const organizationId =
      user.role === "ADMIN" ? user.organizationId : data.organizationId;
    if (!organizationId) {
      throw new HttpError(422, "organizationId wajib diisi");
    }
    assertOrgScope(user, organizationId);

    const domains =
      data.visibility === "PRIVATE" && data.allowedEmailDomains?.length
        ? normalizeEmailDomains(data.allowedEmailDomains)
        : null;
    if (data.visibility === "PRIVATE" && (!domains || domains.length === 0)) {
      throw new HttpError(422, "Campaign private membutuhkan minimal satu domain email valid");
    }

    const campaign = await prisma.campaign.create({
      data: {
        organizationId,
        name: data.name,
        description: data.description ?? null,
        campaignType: data.campaignType,
        rewardMode: data.rewardMode,
        visibility: data.visibility,
        allowedEmailDomainsJson: domains ?? undefined,
        startAt: data.startAt ? new Date(data.startAt) : null,
        endAt: data.endAt ? new Date(data.endAt) : null,
        rewardMultiplier: data.rewardMultiplier ?? null,
        status: data.status,
      },
    });

    await logAudit({
      actorId: user.id,
      action: "CAMPAIGN_CREATE",
      entityType: "Campaign",
      entityId: campaign.id,
      metadata: { name: campaign.name, visibility: campaign.visibility, organizationId },
    });

    return jsonOk({ campaign }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
