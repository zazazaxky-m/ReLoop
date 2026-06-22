import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser, activePartnerOrgIds } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

export async function GET(req: NextRequest) {
  try {
    const user = await requireApiUser();
    const url = new URL(req.url);
    const scope = url.searchParams.get("scope");

    const where: Record<string, unknown> = {
      latitude: { not: null },
      longitude: { not: null },
    };

    if (scope === "partners" && user.role === "PENGEPUL") {
      const orgIds = await activePartnerOrgIds(user.id);
      if (orgIds.length > 0) {
        where.organizationId = { in: orgIds };
      } else {
        where.organizationId = "__none__";
      }
    }

    const machines = await prisma.machine.findMany({
      where,
      select: {
        id: true,
        name: true,
        machineCode: true,
        status: true,
        fillLevelPercent: true,
        latitude: true,
        longitude: true,
        organizationId: true,
        organization: { select: { name: true } },
        wasteTypes: {
          where: { active: true },
          select: { wasteType: { select: { id: true, name: true } } },
        },
      },
    });

    const result = machines.map((m) => ({
      ...m,
      supportedWasteTypes: m.wasteTypes.map((w) => w.wasteType),
      organizationName: m.organization.name,
    }));

    return jsonOk({ machines: result });
  } catch (error) {
    return handleApiError(error);
  }
}
