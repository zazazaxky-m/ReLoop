import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { displayUser } from "@/lib/display-user";

const serviceAreaSchema = z
  .object({
    regions: z.array(z.string()).optional(),
    note: z.string().max(500).optional(),
  })
  .optional();

const createSchema = z.object({
  // Admin-initiated invite (by collector email).
  collectorEmail: z.string().email().optional(),
  // Collector-initiated request (by organization id).
  organizationId: z.string().optional(),
  serviceArea: serviceAreaSchema,
  contactName: z.string().max(120).optional(),
  contactPhone: z.string().max(40).optional(),
  notes: z.string().max(500).optional(),
});

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "PENGEPUL", "SUPERADMIN"]);
    const url = new URL(req.url);
    const statusFilter = url.searchParams.get("status") ?? undefined;

    const where: Prisma.OrganizationCollectorPartnerWhereInput = {};
    if (user.role === "ADMIN") {
      where.organizationId = user.organizationId ?? "__none__";
    } else if (user.role === "PENGEPUL") {
      where.collectorUserId = user.id;
    }
    if (statusFilter) where.status = statusFilter as Prisma.EnumPartnerStatusFilter["equals"];

    const partnerships = await prisma.organizationCollectorPartner.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: {
        organization: { select: { id: true, name: true } },
        collectorUser: { select: { id: true, name: true, email: true, phone: true } },
      },
    });

    const decrypted = partnerships.map((p) => ({
      ...p,
      collectorUser: displayUser(p.collectorUser),
    }));

    return jsonOk({ partnerships: decrypted });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "PENGEPUL"]);
    const data = createSchema.parse(await req.json());

    let organizationId: string;
    let collectorUserId: string;
    let initialStatus: "INVITED" | "REQUESTED";
    let createdByAdminId: string | null = null;

    if (user.role === "ADMIN") {
      if (!user.organizationId) throw new HttpError(422, "Admin tidak terhubung ke organisasi");
      if (!data.collectorEmail) throw new HttpError(422, "Email pengepul wajib diisi");
      const collector = await prisma.user.findUnique({
        where: { email: data.collectorEmail.toLowerCase() },
      });
      if (!collector || collector.role !== "PENGEPUL") {
        throw new HttpError(404, "Pengepul dengan email tersebut tidak ditemukan");
      }
      organizationId = user.organizationId;
      collectorUserId = collector.id;
      initialStatus = "INVITED";
      createdByAdminId = user.id;
    } else {
      // PENGEPUL requesting an organization.
      if (!data.organizationId) throw new HttpError(422, "organizationId wajib diisi");
      const org = await prisma.organization.findUnique({ where: { id: data.organizationId } });
      if (!org) throw new HttpError(404, "Organisasi tidak ditemukan");
      organizationId = org.id;
      collectorUserId = user.id;
      initialStatus = "REQUESTED";
    }

    const existing = await prisma.organizationCollectorPartner.findUnique({
      where: { organizationId_collectorUserId: { organizationId, collectorUserId } },
    });

    const dataPayload = {
      status: initialStatus,
      serviceAreaJson: data.serviceArea ?? undefined,
      contactName: data.contactName ?? null,
      contactPhone: data.contactPhone ?? null,
      notes: data.notes ?? null,
      createdByAdminId,
      approvedBySuperadminId: null,
    };

    let partnership;
    if (existing) {
      if (!["REMOVED", "REJECTED"].includes(existing.status)) {
        return jsonError(409, "Kemitraan sudah ada untuk pengepul & organisasi ini");
      }
      // Re-open a previously closed partnership.
      partnership = await prisma.organizationCollectorPartner.update({
        where: { id: existing.id },
        data: dataPayload,
      });
    } else {
      partnership = await prisma.organizationCollectorPartner.create({
        data: { organizationId, collectorUserId, ...dataPayload },
      });
    }

    await logAudit({
      actorId: user.id,
      action: user.role === "ADMIN" ? "PARTNERSHIP_INVITE" : "PARTNERSHIP_REQUEST",
      entityType: "OrganizationCollectorPartner",
      entityId: partnership.id,
      metadata: { organizationId, collectorUserId, status: initialStatus },
    });

    return jsonOk({ partnership }, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
