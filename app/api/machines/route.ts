import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { generateToken } from "@/lib/qr";
import { generateIngestSecret } from "@/lib/machine-auth";
import { logAudit } from "@/lib/audit";

const createSchema = z.object({
  machineCode: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[A-Za-z0-9_-]+$/, "Hanya huruf, angka, - dan _"),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  organizationId: z.string().min(1, "organizationId wajib diisi"),
  regionId: z.string().optional(),
  capacityKg: z.number().positive().optional(),
  chamberTimeoutSeconds: z.number().int().min(5).max(120).optional(),
  qrRotationSeconds: z.number().int().min(10).max(300).optional(),
  hasInputChamber: z.boolean().optional(),
  hasConveyor: z.boolean().optional(),
  hasCompactor: z.boolean().optional(),
  hasExternalCamera: z.boolean().optional(),
  status: z.enum(["ONLINE", "OFFLINE", "FULL", "MAINTENANCE", "ERROR"]).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  wasteTypeIds: z.array(z.string()).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get("status") ?? undefined;
    const orgFilter = url.searchParams.get("organizationId") ?? undefined;

    const where: Record<string, unknown> = {};
    if (user.role === "ADMIN") {
      where.organizationId = user.organizationId ?? "__none__";
    } else if (orgFilter) {
      where.organizationId = orgFilter;
    }
    if (statusFilter) where.status = statusFilter;

    const machines = await prisma.machine.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true } },
        region: { select: { id: true, name: true } },
        _count: { select: { wasteTypes: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return jsonOk({ machines });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    // Only superadmin provisions machines (hardware is owned/registered centrally).
    const user = await requireApiUser(["SUPERADMIN"]);
    const data = createSchema.parse(await req.json());

    const organizationId = data.organizationId;
    const org = await prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new HttpError(422, "Organisasi tidak ditemukan");

    const existing = await prisma.machine.findUnique({
      where: { machineCode: data.machineCode },
    });
    if (existing) return jsonError(409, "Kode mesin sudah dipakai");

    const rotation = data.qrRotationSeconds ?? 30;
    const machine = await prisma.machine.create({
      data: {
        organizationId,
        regionId: data.regionId ?? null,
        machineCode: data.machineCode,
        name: data.name,
        description: data.description ?? null,
        status: data.status ?? "OFFLINE",
        capacityKg: data.capacityKg ?? null,
        chamberTimeoutSeconds: data.chamberTimeoutSeconds ?? 20,
        qrRotationSeconds: rotation,
        hasInputChamber: data.hasInputChamber ?? true,
        hasConveyor: data.hasConveyor ?? true,
        hasCompactor: data.hasCompactor ?? false,
        hasExternalCamera: data.hasExternalCamera ?? false,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        qrToken: generateToken(),
        qrTokenExpiresAt: new Date(Date.now() + rotation * 1000),
        ingestSecret: generateIngestSecret(),
        wasteTypes: data.wasteTypeIds?.length
          ? {
              create: data.wasteTypeIds.map((wasteTypeId) => ({
                wasteTypeId,
                active: true,
              })),
            }
          : undefined,
      },
    });

    await logAudit({
      actorId: user.id,
      action: "MACHINE_CREATE",
      entityType: "Machine",
      entityId: machine.id,
      metadata: { machineCode: machine.machineCode, organizationId },
    });

    return jsonOk({ machine }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
