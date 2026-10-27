import { z } from "zod";
import { typeErrors } from "@/lib/zod-errors";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { normalizeEmailDomains } from "@/lib/campaign";
import { logAudit } from "@/lib/audit";
import { lockCampaign } from "@/lib/db-locks";
import { MAX_FUNDING_RUPIAH, assertMoneyProgramConfigured, guardProgramRewardChange } from "@/lib/reward-funding";
import { runWalletTransaction } from "@/lib/wallet-service";

/** B01: integer rupiah caps of at least Rp1; null clears (no cap / not configured). Zero is never a cap (I3). */
const rupiahCapSchema = z
  .number({ error: typeErrors({ invalidType: "Nilai harus berupa angka" }) })
  .int("Nilai harus bilangan bulat rupiah")
  .min(1, "Nilai minimal Rp1; kosongkan untuk menghapus batas")
  .max(MAX_FUNDING_RUPIAH, "Nilai melebihi batas yang diizinkan")
  .nullable()
  .optional();

const updateSchema = z
  .object({
    name: z.string().min(2).max(160).optional(),
    description: z.string().max(1000).nullable().optional(),
    campaignType: z
      .enum(["MACHINE_DEPOSIT", "TRASH_BAG", "EVENT", "SCHOOL_PROGRAM", "TOURISM_PROGRAM"])
      .optional(),
    rewardMode: z.enum(["MONEY_REWARD", "COMPLIANCE_ONLY"]).optional(),
    // M04: lets an EVENT / SCHOOL_PROGRAM campaign run at machines.
    supportsMachine: z.boolean().optional(),
    visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
    allowedEmailDomains: z.array(z.string()).max(100, "Maksimal 100 domain email").optional(),
    startAt: z.string().datetime().nullable().optional(),
    endAt: z.string().datetime().nullable().optional(),
    rewardMultiplier: z.number().min(0).max(100).nullable().optional(),
    status: z.enum(["DRAFT", "ACTIVE", "PAUSED", "ENDED"]).optional(),
    // B01: program budget and per-session reward ceiling (integer rupiah).
    rewardBudgetRupiah: rupiahCapSchema,
    maxRewardPerSessionRupiah: rupiahCapSchema,
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
    // B01: under the Campaign lock (admission and issuance take it too), the
    // program as it will be after this change must carry its caps if money is
    // live, and a program with open sources cannot turn to money or raise its
    // multiplier under enforcement (I2); the row is re-read under the lock.
    const campaign = await runWalletTransaction(async (tx) => {
      await lockCampaign(tx, id);
      const locked = await tx.campaign.findUniqueOrThrow({ where: { id } });
      const next = {
        status: data.status ?? locked.status,
        rewardMode: data.rewardMode ?? locked.rewardMode,
        campaignType: data.campaignType ?? locked.campaignType,
        supportsMachine: data.supportsMachine ?? locked.supportsMachine,
        rewardMultiplier: data.rewardMultiplier === undefined ? locked.rewardMultiplier : data.rewardMultiplier,
        maxRewardPerSessionRupiah:
          data.maxRewardPerSessionRupiah === undefined ? locked.maxRewardPerSessionRupiah : data.maxRewardPerSessionRupiah,
        rewardBudgetRupiah: data.rewardBudgetRupiah === undefined ? locked.rewardBudgetRupiah : data.rewardBudgetRupiah,
      };
      assertMoneyProgramConfigured(next);
      await guardProgramRewardChange(tx, { campaignId: id, current: locked, next });
      return tx.campaign.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description,
          campaignType: data.campaignType,
          rewardMode: data.rewardMode,
          supportsMachine: data.supportsMachine,
          rewardBudgetRupiah: data.rewardBudgetRupiah,
          maxRewardPerSessionRupiah: data.maxRewardPerSessionRupiah,
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
