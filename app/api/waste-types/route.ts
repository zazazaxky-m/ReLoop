import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, activePartnerOrgIds, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const createSchema = z
  .object({
    name: z.string().min(2).max(120),
    unit: z.enum(["ITEM", "KG"]).default("ITEM"),
    minWeightGrams: z.number().int().min(0).max(100000).nullable().optional(),
    maxWeightGrams: z.number().int().min(0).max(100000).nullable().optional(),
    defaultRewardPerItem: z.number().int().min(0).max(10_000_000).nullable().optional(),
    description: z.string().max(500).nullable().optional(),
    // Superadmin only: null => global, otherwise org-specific.
    organizationId: z.string().nullable().optional(),
  })
  .refine(
    (d) =>
      d.minWeightGrams == null ||
      d.maxWeightGrams == null ||
      d.minWeightGrams <= d.maxWeightGrams,
    { message: "Berat minimum tidak boleh melebihi maksimum", path: ["minWeightGrams"] },
  );

export async function GET() {
  try {
    const user = await requireApiUser(["USER", "PENGEPUL", "ADMIN", "SUPERADMIN"]);

    let where: Record<string, unknown> = {};
    if (user.role === "SUPERADMIN") {
      where = {};
    } else if (user.role === "ADMIN") {
      where = {
        OR: [
          { organizationId: null },
          { organizationId: user.organizationId ?? "__none__" },
        ],
      };
    } else if (user.role === "PENGEPUL") {
      const orgIds = await activePartnerOrgIds(user.id);
      where = {
        OR: [
          { organizationId: null },
          ...(orgIds.length > 0 ? [{ organizationId: { in: orgIds } }] : []),
        ],
      };
    } else {
      where = {};
    }

    const wasteTypes = await prisma.wasteType.findMany({
      where,
      orderBy: [{ organizationId: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { depositItems: true, rewardRates: true } },
      },
    });

    // Soft-join ke Organization (WasteType.organizationId tidak punya @relation).
    const orgIds = Array.from(
      new Set(
        wasteTypes.map((w) => w.organizationId).filter((x): x is string => Boolean(x)),
      ),
    );
    const orgs = orgIds.length
      ? await prisma.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, name: true, type: true },
        })
      : [];
    const orgById = new Map(orgs.map((o) => [o.id, o]));

    const enriched = wasteTypes.map((w) => ({
      ...w,
      organization: w.organizationId ? orgById.get(w.organizationId) ?? null : null,
    }));

    return jsonOk({ wasteTypes: enriched });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    // Admin can only create org-specific types for their own org.
    let organizationId: string | null;
    if (user.role === "ADMIN") {
      if (!user.organizationId) {
        throw new HttpError(422, "Admin tidak terhubung ke organisasi");
      }
      organizationId = user.organizationId;
    } else {
      organizationId = data.organizationId ?? null;
      if (organizationId) assertOrgScope(user, organizationId);
    }

    const wasteType = await prisma.wasteType.create({
      data: {
        name: data.name,
        unit: data.unit,
        minWeightGrams: data.minWeightGrams ?? null,
        maxWeightGrams: data.maxWeightGrams ?? null,
        defaultRewardPerItem: data.defaultRewardPerItem ?? null,
        description: data.description ?? null,
        organizationId,
        active: true,
      },
    });

    await logAudit({
      actorId: user.id,
      action: "WASTE_TYPE_CREATE",
      entityType: "WasteType",
      entityId: wasteType.id,
      metadata: { name: wasteType.name, organizationId },
    });

    return jsonOk({ wasteType }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
