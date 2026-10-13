import { after } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { normalizeTravelAgentEmail } from "@/lib/tourism";
import { buildPaginationMeta, parsePagination } from "@/lib/pagination";
import { accountEmailSchema } from "@/lib/account-email";
import { deliverEmailOutboxSafely } from "@/lib/email-outbox";
import { INVITE_PUBLIC_SELECT, inviteSummary, issueTravelAgentInvite } from "@/lib/invitations";
import { emailLinkBase, LINK_BASE_UNAVAILABLE } from "@/lib/site";

const inviteSchema = z.object({
  name: z.string().min(2).max(160),
  email: accountEmailSchema(),
  phone: z.string().max(60).optional(),
  contactPerson: z.string().max(120).optional(),
  notes: z.string().max(500).optional(),
  organizationId: z.string().optional(),
});

export async function GET(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const url = new URL(req.url);
    const organizationId =
      user.role === "ADMIN"
        ? user.organizationId
        : url.searchParams.get("organizationId");

    if (!organizationId) throw new HttpError(422, "organizationId wajib diisi");
    assertOrgScope(user, organizationId);

    // A03: listing never links accounts to agents (it used to upsert an OWNER
    // membership for any registered account whose email matched a PENDING
    // agent). Membership comes only from an accepted invitation.
    const pagination = parsePagination(url);
    const agentWhere = {
      organizations: { some: { organizationId } },
    };

    const [agents, total] = await Promise.all([
      prisma.travelAgent.findMany({
        where: agentWhere,
        orderBy: { name: "asc" },
        skip: pagination.skip,
        take: pagination.take,
        include: {
          organizations: {
            where: { organizationId },
            include: { organization: { select: { id: true, name: true } } },
          },
          trips: {
            where: { campaign: { organizationId } },
            select: { id: true, complianceStatus: true },
          },
          users: { select: { verifiedAt: true, user: { select: { emailVerifiedAt: true } } } },
          invites: {
            where: { organizationId },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { createdAt: true, expiresAt: true, acceptedAt: true },
          },
        },
      }),
      prisma.travelAgent.count({ where: agentWhere }),
    ]);

    return jsonOk({
      agents: agents.map((agent) => {
        const trips = agent.trips;
        const compliant = trips.filter((t) => t.complianceStatus === "COMPLIANT").length;
        const nonCompliant = trips.filter((t) => t.complianceStatus === "NON_COMPLIANT").length;
        const needsReview = trips.filter((t) => t.complianceStatus === "NEEDS_REVIEW").length;
        return {
          id: agent.id,
          name: agent.name,
          email: agent.email,
          phone: agent.phone,
          contactPerson: agent.contactPerson,
          status: agent.status,
          organizationStatus: agent.organizations[0]?.status ?? "PENDING",
          tripCount: trips.length,
          compliantCount: compliant,
          nonCompliantCount: nonCompliant,
          reviewCount: needsReview,
          // A03 (additive): verification state for the admin UI.
          memberCount: agent.users.length,
          verifiedMemberCount: agent.users.filter((m) => m.verifiedAt && m.user.emailVerifiedAt).length,
          latestInvite: inviteSummary(agent.invites[0]),
        };
      }),
      pagination: buildPaginationMeta(total, pagination),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Invites `email` to manage the travel agent for the organization. A03: no
 * membership is created here, whether or not an account with that email
 * exists; the agent link stays PENDING (an INVITED link stays INVITED) until
 * the invitation is accepted with the token mailed to that address. The mail
 * is queued in the same transaction and sent after the response.
 */
export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const data = inviteSchema.parse(await req.json());
    const organizationId =
      user.role === "ADMIN" ? user.organizationId : data.organizationId;

    if (!organizationId) throw new HttpError(422, "organizationId wajib diisi");
    assertOrgScope(user, organizationId);
    if (!emailLinkBase()) {
      console.error("[travel-agents] NEXT_PUBLIC_BASE_URL is not configured; no invitation is sent");
      return jsonError(503, LINK_BASE_UNAVAILABLE);
    }

    const email = normalizeTravelAgentEmail(data.email);

    const result = await prisma.$transaction(async (tx) => {
      const agent = await tx.travelAgent.upsert({
        where: { email },
        update: {
          name: data.name.trim(),
          phone: data.phone || undefined,
          contactPerson: data.contactPerson || undefined,
          status: "ACTIVE",
        },
        create: {
          name: data.name.trim(),
          email,
          phone: data.phone || null,
          contactPerson: data.contactPerson || null,
        },
      });

      const link = await tx.travelAgentOrganization.upsert({
        where: {
          travelAgentId_organizationId: {
            travelAgentId: agent.id,
            organizationId,
          },
        },
        update: {
          invitedById: user.id,
          notes: data.notes || undefined,
        },
        create: {
          travelAgentId: agent.id,
          organizationId,
          status: "PENDING",
          invitedById: user.id,
          approvedAt: null,
          notes: data.notes || null,
        },
        select: { id: true },
      });
      // A suspended or removed agent waits for the new invitation to be
      // accepted. Conditional, so an INVITED link (verified members keep
      // access) is never set back, even by a concurrent accept.
      await tx.travelAgentOrganization.updateMany({
        where: { id: link.id, status: { in: ["SUSPENDED", "REMOVED"] } },
        data: { status: "PENDING" },
      });
      const { status: linkStatus } = await tx.travelAgentOrganization.findUniqueOrThrow({
        where: { id: link.id },
        select: { status: true },
      });

      const issued = await issueTravelAgentInvite(tx, {
        travelAgentId: agent.id,
        organizationId,
        email,
        invitedById: user.id,
      });
      const invite = await tx.travelAgentInvite.findUniqueOrThrow({
        where: { id: issued.inviteId },
        select: INVITE_PUBLIC_SELECT,
      });
      return { agent, invite, outboxId: issued.outboxId, organizationStatus: linkStatus };
    });

    // Delivered after the response; scripts/process-email-outbox.ts retries.
    after(() => deliverEmailOutboxSafely(result.outboxId));

    await logAudit({
      actorId: user.id,
      action: "TRAVEL_AGENT_INVITE",
      entityType: "TravelAgent",
      entityId: result.agent.id,
      metadata: { organizationId, inviteId: result.invite.id, organizationStatus: result.organizationStatus },
    });

    return jsonOk(
      {
        agent: result.agent,
        invite: result.invite,
        organizationStatus: result.organizationStatus,
        delivery: "QUEUED",
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
