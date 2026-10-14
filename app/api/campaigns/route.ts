import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { normalizeEmailDomains } from "@/lib/campaign";
import { logAudit } from "@/lib/audit";
import { buildPaginationMeta, parsePagination } from "@/lib/pagination";
import { MAX_FUNDING_RUPIAH, assertMoneyProgramConfigured } from "@/lib/reward-funding";

/** B01: integer rupiah caps of at least Rp1; null clears (no cap / not configured). Zero is never a cap (I3). */
const rupiahCapSchema = z
  .number({ invalid_type_error: "Nilai harus berupa angka" })
  .int("Nilai harus bilangan bulat rupiah")
  .min(1, "Nilai minimal Rp1; kosongkan untuk menghapus batas")
  .max(MAX_FUNDING_RUPIAH, "Nilai melebihi batas yang diizinkan")
  .nullable()
  .optional();

const createSchema = z
  .object({
    name: z.string().min(2).max(160),
    description: z.string().max(1000).nullable().optional(),
    campaignType: z
      .enum(["MACHINE_DEPOSIT", "TRASH_BAG", "EVENT", "SCHOOL_PROGRAM", "TOURISM_PROGRAM"])
      .default("MACHINE_DEPOSIT"),
    rewardMode: z.enum(["MONEY_REWARD", "COMPLIANCE_ONLY"]).default("MONEY_REWARD"),
    // M04: lets an EVENT / SCHOOL_PROGRAM campaign run at machines.
    supportsMachine: z.boolean().optional(),
    visibility: z.enum(["PUBLIC", "PRIVATE"]).default("PUBLIC"),
    allowedEmailDomains: z.array(z.string()).optional(),
    startAt: z.string().datetime().nullable().optional(),
    endAt: z.string().datetime().nullable().optional(),
    rewardMultiplier: z.number().min(0).max(100).nullable().optional(),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ENDED"]).default("DRAFT"),
    // B01: program budget and per-session reward ceiling (integer rupiah).
    rewardBudgetRupiah: rupiahCapSchema,
    maxRewardPerSessionRupiah: rupiahCapSchema,
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

    const pagination = parsePagination(url);
    const [total, campaigns] = await Promise.all([
      prisma.campaign.count({ where }),
      prisma.campaign.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: pagination.skip,
        take: pagination.take,
        include: {
          organization: { select: { id: true, name: true } },
          _count: { select: { sessions: true } },
        },
      }),
    ]);

    return jsonOk({ campaigns, pagination: buildPaginationMeta(total, pagination) });
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
    // B01: under enforcement an ACTIVE money program needs its budget, and one at machines its ceiling.
    assertMoneyProgramConfigured({
      status: data.status,
      rewardMode: data.rewardMode,
      campaignType: data.campaignType,
      supportsMachine: data.supportsMachine ?? false,
      maxRewardPerSessionRupiah: data.maxRewardPerSessionRupiah ?? null,
      rewardBudgetRupiah: data.rewardBudgetRupiah ?? null,
    });

    const campaign = await prisma.campaign.create({
      data: {
        organizationId,
        name: data.name,
        description: data.description ?? null,
        campaignType: data.campaignType,
        rewardMode: data.rewardMode,
        supportsMachine: data.supportsMachine ?? false,
        visibility: data.visibility,
        allowedEmailDomainsJson: domains ?? undefined,
        startAt: data.startAt ? new Date(data.startAt) : null,
        endAt: data.endAt ? new Date(data.endAt) : null,
        rewardMultiplier: data.rewardMultiplier ?? null,
        status: data.status,
        rewardBudgetRupiah: data.rewardBudgetRupiah ?? null,
        maxRewardPerSessionRupiah: data.maxRewardPerSessionRupiah ?? null,
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
