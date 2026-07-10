import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";

const patchSchema = z.object({
  organizationStatus: z.enum(["INVITED", "SUSPENDED", "REMOVED"]),
  organizationId: z.string().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id: travelAgentId } = await params;
    const data = patchSchema.parse(await req.json());

    const organizationId =
      user.role === "ADMIN" ? user.organizationId : data.organizationId;
    if (!organizationId) throw new HttpError(422, "organizationId wajib diisi");
    assertOrgScope(user, organizationId);

    const link = await prisma.travelAgentOrganization.findUnique({
      where: {
        travelAgentId_organizationId: {
          travelAgentId,
          organizationId,
        },
      },
      include: { travelAgent: { select: { id: true, name: true, email: true } } },
    });
    if (!link) throw new HttpError(404, "Travel agent tidak terhubung ke organisasi ini");

    if (link.status === "PENDING" && data.organizationStatus !== "REMOVED") {
      throw new HttpError(
        422,
        "Agent PENDING hanya bisa dihapus dari daftar, atau menunggu akun terdaftar",
      );
    }

    const updated = await prisma.travelAgentOrganization.update({
      where: { id: link.id },
      data: {
        status: data.organizationStatus,
        approvedAt:
          data.organizationStatus === "INVITED"
            ? (link.approvedAt ?? new Date())
            : link.approvedAt,
      },
      include: { travelAgent: { select: { id: true, name: true, email: true } } },
    });

    await logAudit({
      actorId: user.id,
      action: "TRAVEL_AGENT_STATUS",
      entityType: "TravelAgentOrganization",
      entityId: updated.id,
      metadata: {
        travelAgentId,
        organizationId,
        from: link.status,
        to: data.organizationStatus,
      },
    });

    return jsonOk({
      agent: {
        id: updated.travelAgent.id,
        name: updated.travelAgent.name,
        email: updated.travelAgent.email,
        organizationStatus: updated.status,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
