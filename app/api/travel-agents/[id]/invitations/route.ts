import { after } from "next/server";
import { z } from "zod";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { deliverEmailOutboxSafely } from "@/lib/email-outbox";
import { INVITE_PUBLIC_SELECT, issueTravelAgentInvite } from "@/lib/invitations";
import { prisma } from "@/lib/prisma";
import { assertOrgScope, HttpError, requireApiUser } from "@/lib/rbac";
import { emailLinkBase, LINK_BASE_UNAVAILABLE } from "@/lib/site";

const schema = z.object({ organizationId: z.string().optional() }).strict();

/**
 * Re-sends the invitation of the agent's email for the organization (A03):
 * for an invitation that expired or never arrived, and for members who must
 * verify again (memberships from before A03, or after an email change). The
 * next delivery mints a new token; earlier links stop working. The link
 * status is not changed, so verified members keep their access.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const { id: travelAgentId } = await params;
    const data = schema.parse(await req.json().catch(() => ({})));
    const organizationId = user.role === "ADMIN" ? user.organizationId : data.organizationId;
    if (!organizationId) throw new HttpError(422, "organizationId wajib diisi");
    assertOrgScope(user, organizationId);
    if (!emailLinkBase()) {
      console.error("[travel-agents] NEXT_PUBLIC_BASE_URL is not configured; no invitation is sent");
      return jsonError(503, LINK_BASE_UNAVAILABLE);
    }

    const result = await prisma.$transaction(async (tx) => {
      const link = await tx.travelAgentOrganization.findUnique({
        where: { travelAgentId_organizationId: { travelAgentId, organizationId } },
        include: { travelAgent: { select: { email: true, status: true } } },
      });
      if (!link) throw new HttpError(404, "Travel agent tidak terhubung ke organisasi ini");
      if (link.status !== "PENDING" && link.status !== "INVITED") {
        throw new HttpError(422, "Aktifkan travel agent ini sebelum mengirim ulang undangan");
      }
      if (link.travelAgent.status !== "ACTIVE") throw new HttpError(422, "Travel agent tidak aktif");
      const issued = await issueTravelAgentInvite(tx, {
        travelAgentId,
        organizationId,
        email: link.travelAgent.email,
        invitedById: user.id,
      });
      const invite = await tx.travelAgentInvite.findUniqueOrThrow({
        where: { id: issued.inviteId },
        select: INVITE_PUBLIC_SELECT,
      });
      return { invite, outboxId: issued.outboxId, reused: issued.reused };
    });

    after(() => deliverEmailOutboxSafely(result.outboxId));
    await logAudit({
      actorId: user.id,
      action: "TRAVEL_AGENT_INVITE_RESEND",
      entityType: "TravelAgent",
      entityId: travelAgentId,
      metadata: { organizationId, inviteId: result.invite.id, reused: result.reused },
    });
    return jsonOk({ invite: result.invite, delivery: "QUEUED" }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
