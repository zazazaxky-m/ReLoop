import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    await requireApiUser();
    const { code } = await params;

    const machine = await prisma.machine.findUnique({
      where: { machineCode: code },
      select: {
        id: true,
        name: true,
        machineCode: true,
        status: true,
        fillLevelPercent: true,
        capacityKg: true,
        description: true,
        latitude: true,
        longitude: true,
        organization: { select: { id: true, name: true } },
        wasteTypes: {
          where: { active: true },
          select: { wasteType: { select: { id: true, name: true } } },
        },
      },
    });

    if (!machine) throw new HttpError(404, "Mesin tidak ditemukan");

    const sessions = await prisma.depositSession.findMany({
      where: { machineId: machine.id },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
      },
    });

    return jsonOk({
      machine: {
        ...machine,
        organizationName: machine.organization.name,
        organizationId: machine.organization.id,
        supportedWasteTypes: machine.wasteTypes.map((w) => w.wasteType),
      },
      recentSessions: sessions,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
