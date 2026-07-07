import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { buildPaginationMeta, parsePagination } from "@/lib/pagination";

const createSchema = z.object({
  type: z.enum(["PROVINCE", "REGENCY", "DISTRICT", "VILLAGE"]),
  name: z.string().min(2).max(160),
  parentId: z.string().nullable().optional(),
});

export async function GET(req: Request) {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const pagination = parsePagination(new URL(req.url), { defaultLimit: 100, maxLimit: 200 });

    const [total, regions] = await Promise.all([
      prisma.region.count(),
      prisma.region.findMany({
        orderBy: [{ type: "asc" }, { name: "asc" }],
        skip: pagination.skip,
        take: pagination.take,
        include: {
          parent: { select: { id: true, name: true } },
          _count: { select: { children: true, organizations: true, machines: true } },
        },
      }),
    ]);

    return jsonOk({ regions, pagination: buildPaginationMeta(total, pagination) });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    if (data.parentId) {
      const parent = await prisma.region.findUnique({ where: { id: data.parentId } });
      if (!parent) throw new HttpError(404, "Wilayah induk tidak ditemukan");
    }

    const region = await prisma.region.create({
      data: { type: data.type, name: data.name, parentId: data.parentId ?? null },
    });

    await logAudit({
      actorId: user.id,
      action: "REGION_CREATE",
      entityType: "Region",
      entityId: region.id,
      metadata: { type: region.type, name: region.name },
    });

    return jsonOk({ region }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
