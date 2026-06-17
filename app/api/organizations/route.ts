import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const ORG_TYPES = [
  "SCHOOL",
  "CAMPUS",
  "VILLAGE",
  "TOURISM_SITE",
  "OFFICE",
  "COMMUNITY",
  "WASTE_BANK",
  "OTHER",
] as const;

const createSchema = z.object({
  name: z.string().min(2).max(160),
  type: z.enum(ORG_TYPES).default("OTHER"),
  regionId: z.string().nullable().optional(),
  address: z.string().max(300).optional(),
  contactName: z.string().max(120).optional(),
  contactPhone: z.string().max(40).optional(),
});

export async function GET() {
  try {
    await requireApiUser(["SUPERADMIN"]);
    const organizations = await prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        region: { select: { name: true } },
        _count: { select: { machines: true, users: true } },
      },
    });
    return jsonOk({ organizations });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    const org = await prisma.organization.create({
      data: {
        name: data.name,
        type: data.type,
        regionId: data.regionId ?? null,
        address: data.address ?? null,
        contactName: data.contactName ?? null,
        contactPhone: data.contactPhone ?? null,
        status: "ACTIVE",
      },
    });

    await logAudit({
      actorId: user.id,
      action: "ORGANIZATION_CREATE",
      entityType: "Organization",
      entityId: org.id,
      metadata: { name: org.name, type: org.type },
    });

    return jsonOk({ organization: org }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
