import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const createSchema = z
  .object({
    wasteTypeId: z.string().min(1),
    pointsPerItem: z.number().int().min(0).max(10_000_000),
    unit: z.enum(["ITEM", "KG"]).default("ITEM"),
    minWeightGrams: z.number().int().min(0).max(100000).nullable().optional(),
    maxWeightGrams: z.number().int().min(0).max(100000).nullable().optional(),
    // Superadmin: null => global. Admin: forced to own org.
    organizationId: z.string().nullable().optional(),
    campaignId: z.string().nullable().optional(),
  })
  .refine(
    (d) =>
      d.minWeightGrams == null ||
      d.maxWeightGrams == null ||
      d.minWeightGrams <= d.maxWeightGrams,
    { message: "Berat minimum tidak boleh melebihi maksimum", path: ["minWeightGrams"] },
  );

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const url = new URL(req.url);
    const activeOnly = url.searchParams.get("active") === "1";

    const where: Prisma.RewardRateWhereInput =
      user.role === "SUPERADMIN"
        ? {}
        : {
            OR: [
              { organizationId: null, campaignId: null },
              { organizationId: user.organizationId ?? "__none__" },
              { campaign: { organizationId: user.organizationId ?? "__none__" } },
            ],
          };
    if (activeOnly) where.active = true;

    const rates = await prisma.rewardRate.findMany({
      where,
      orderBy: [{ active: "desc" }, { effectiveFrom: "desc" }],
      include: {
        wasteType: { select: { id: true, name: true } },
        organization: { select: { id: true, name: true } },
        campaign: { select: { id: true, name: true } },
      },
    });

    return jsonOk({ rates });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    let organizationId: string | null;
    const campaignId: string | null = data.campaignId ?? null;

    if (user.role === "ADMIN") {
      if (!user.organizationId) {
        throw new HttpError(422, "Admin tidak terhubung ke organisasi");
      }
      organizationId = user.organizationId;
    } else {
      organizationId = data.organizationId ?? null;
      if (organizationId) assertOrgScope(user, organizationId);
    }

    // Validate the campaign belongs to the resolved scope.
    if (campaignId) {
      const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
      if (!campaign) throw new HttpError(422, "Campaign tidak ditemukan");
      if (user.role === "ADMIN" && campaign.organizationId !== user.organizationId) {
        throw new HttpError(403, "Campaign di luar organisasi Anda");
      }
      organizationId = organizationId ?? campaign.organizationId;
    }

    // Versioning: expire any currently-active rate for the same scope + waste type,
    // then create a fresh active version. Historical deposits keep their frozen rate.
    const rate = await prisma.$transaction(async (tx) => {
      await tx.rewardRate.updateMany({
        where: {
          wasteTypeId: data.wasteTypeId,
          organizationId,
          campaignId,
          active: true,
        },
        data: { active: false, effectiveTo: new Date() },
      });

      return tx.rewardRate.create({
        data: {
          wasteTypeId: data.wasteTypeId,
          pointsPerItem: data.pointsPerItem,
          unit: data.unit,
          minWeightGrams: data.minWeightGrams ?? null,
          maxWeightGrams: data.maxWeightGrams ?? null,
          organizationId,
          campaignId,
          effectiveFrom: new Date(),
          active: true,
        },
      });
    });

    await logAudit({
      actorId: user.id,
      action: "REWARD_RATE_CREATE",
      entityType: "RewardRate",
      entityId: rate.id,
      metadata: {
        wasteTypeId: data.wasteTypeId,
        pointsPerItem: data.pointsPerItem,
        organizationId,
        campaignId,
      },
    });

    return jsonOk({ rate }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
