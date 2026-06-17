import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  type: z.enum(["PROVINCE", "REGENCY", "DISTRICT", "VILLAGE"]),
  name: z.string().min(2).max(160),
  parentId: z.string().nullable().optional(),
});

export async function GET() {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const regions = await prisma.region.findMany({
      orderBy: [{ type: "asc" }, { name: "asc" }],
      include: {
        parent: { select: { id: true, name: true } },
        _count: { select: { children: true, organizations: true, machines: true } },
      },
    });
    return jsonOk({ regions });
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
