import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import {
  resolvePartnershipTransition,
  type PartnershipAction,
} from "@/lib/partnership";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  action: z.enum([
    "accept",
    "decline",
    "approve",
    "reject",
    "suspend",
    "reactivate",
    "remove",
    "set_area",
  ]),
  serviceArea: z
    .object({
      regions: z.array(z.string()).optional(),
      note: z.string().max(500).optional(),
    })
    .optional(),
  contactName: z.string().max(120).optional(),
  contactPhone: z.string().max(40).optional(),
  notes: z.string().max(500).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "PENGEPUL", "SUPERADMIN"]);
    const { id } = await params;
    const body = patchSchema.parse(await req.json());

    const partnership = await prisma.organizationCollectorPartner.findUnique({
      where: { id },
    });
    if (!partnership) throw new HttpError(404, "Kemitraan tidak ditemukan");

    const isCollector = partnership.collectorUserId === user.id;
    const isOrgAdmin =
      user.role === "ADMIN" && user.organizationId === partnership.organizationId;

    // Coarse ownership gate before any mutation.
    if (user.role === "ADMIN" && !isOrgAdmin) {
      throw new HttpError(403, "Di luar scope organisasi Anda");
    }
    if (user.role === "PENGEPUL" && !isCollector) {
      throw new HttpError(403, "Bukan kemitraan Anda");
    }

    // Non-transition: update service area / contact / notes (owner only).
    if (body.action === "set_area") {
      if (!isCollector && !isOrgAdmin && user.role !== "SUPERADMIN") {
        throw new HttpError(403, "Tidak diizinkan mengubah area");
      }
      const updated = await prisma.organizationCollectorPartner.update({
        where: { id },
        data: {
          serviceAreaJson: body.serviceArea ?? undefined,
          contactName: body.contactName ?? undefined,
          contactPhone: body.contactPhone ?? undefined,
          notes: body.notes ?? undefined,
        },
      });
      await logAudit({
        actorId: user.id,
        action: "PARTNERSHIP_SET_AREA",
        entityType: "OrganizationCollectorPartner",
        entityId: id,
      });
      return jsonOk({ partnership: updated });
    }

    const resolution = resolvePartnershipTransition(
      body.action as PartnershipAction,
      { status: partnership.status, role: user.role, isCollector, isOrgAdmin },
    );
    if (!resolution.ok || !resolution.to) {
      throw new HttpError(409, resolution.error ?? "Transisi tidak diizinkan");
    }

    const updated = await prisma.organizationCollectorPartner.update({
      where: { id },
      data: {
        status: resolution.to,
        approvedBySuperadminId:
          body.action === "approve" ? user.id : undefined,
      },
    });

    await logAudit({
      actorId: user.id,
      action: `PARTNERSHIP_${body.action.toUpperCase()}`,
      entityType: "OrganizationCollectorPartner",
      entityId: id,
      metadata: { from: partnership.status, to: resolution.to },
    });

    return jsonOk({ partnership: updated });
  } catch (error) {
    return handleApiError(error);
  }
}
