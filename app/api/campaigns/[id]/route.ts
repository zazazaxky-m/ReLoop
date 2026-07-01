import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { normalizeEmailDomains } from "@/lib/campaign";
import { logAudit } from "@/lib/audit";

const updateSchema = z
  .object({
    name: z.string().min(2).max(160).optional(),
    description: z.string().max(1000).nullable().optional(),
    campaignType: z
      .enum(["MACHINE_DEPOSIT", "TRASH_BAG", "EVENT", "SCHOOL_PROGRAM", "TOURISM_PROGRAM"])
      .optional(),
    rewardMode: z.enum(["MONEY_REWARD", "COMPLIANCE_ONLY"]).optional(),
    visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
    allowedEmailDomains: z.array(z.string()).optional(),
    startAt: z.string().datetime().nullable().optional(),
    endAt: z.string().datetime().nullable().optional(),
    rewardMultiplier: z.number().min(0).max(100).nullable().optional(),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ENDED"]).optional(),
  })
  .refine(
    (d) => !d.startAt || !d.endAt || new Date(d.startAt) <= new Date(d.endAt),
    { message: "Tanggal mulai harus sebelum tanggal selesai", path: ["startAt"] },
  );

async function loadEditable(id: string, role: string, orgId: string | null) {
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new HttpError(404, "Campaign tidak ditemukan");
  if (role !== "SUPERADMIN" && campaign.organizationId !== orgId) {
    throw new HttpError(403, "Di luar scope organisasi Anda");
  }
  return campaign;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id } = await params;
    const current = await loadEditable(id, user.role, user.organizationId);
    const data = updateSchema.parse(await req.json());

    const visibility = data.visibility ?? current.visibility;
    // undefined => leave unchanged; Prisma.DbNull => clear column.
    let domainsValue: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
    if (data.visibility === "PUBLIC") {
      domainsValue = Prisma.DbNull;
    } else if (data.allowedEmailDomains !== undefined) {
      const domains =
        visibility === "PRIVATE" ? normalizeEmailDomains(data.allowedEmailDomains) : [];
      if (visibility === "PRIVATE" && domains.length === 0) {
        throw new HttpError(422, "Campaign private membutuhkan minimal satu domain email valid");
      }
      domainsValue = domains.length ? (domains as Prisma.InputJsonValue) : Prisma.DbNull;
    }

    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        campaignType: data.campaignType,
        rewardMode: data.rewardMode,
        visibility: data.visibility,
        allowedEmailDomainsJson: domainsValue,
        startAt:
          data.startAt === undefined
            ? undefined
            : data.startAt
              ? new Date(data.startAt)
              : null,
        endAt:
          data.endAt === undefined
            ? undefined
            : data.endAt
              ? new Date(data.endAt)
              : null,
        rewardMultiplier: data.rewardMultiplier,
        status: data.status,
      },
    });

    await logAudit({
      actorId: user.id,
      action: "CAMPAIGN_UPDATE",
      entityType: "Campaign",
      entityId: id,
      metadata: { ...data, allowedEmailDomains: undefined },
    });

    return jsonOk({ campaign });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id } = await params;
    await loadEditable(id, user.role, user.organizationId);

    const sessions = await prisma.depositSession.count({ where: { campaignId: id } });
    if (sessions) {
      const campaign = await prisma.campaign.update({
        where: { id },
        data: { status: "ENDED" },
      });
      await logAudit({
        actorId: user.id,
        action: "CAMPAIGN_END",
        entityType: "Campaign",
        entityId: id,
      });
      return jsonOk({ campaign, ended: true });
    }

    await prisma.rewardRate.deleteMany({ where: { campaignId: id } });
    await prisma.campaign.delete({ where: { id } });
    await logAudit({
      actorId: user.id,
      action: "CAMPAIGN_DELETE",
      entityType: "Campaign",
      entityId: id,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
