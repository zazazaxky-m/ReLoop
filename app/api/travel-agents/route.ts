import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireApiUser, assertOrgScope, HttpError } from "@/lib/rbac";
import { handleApiError, jsonOk } from "@/lib/api";
import { logAudit } from "@/lib/audit";
import { normalizeTravelAgentEmail } from "@/lib/tourism";

const inviteSchema = z.object({
  name: z.string().min(2).max(160),
  email: z.string().email(),
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

    const pendingLinks = await prisma.travelAgentOrganization.findMany({
      where: { organizationId, status: "PENDING" },
      include: { travelAgent: { select: { id: true, email: true } } },
    });
    const pendingEmails = pendingLinks.map((link) => link.travelAgent.email);
    const existingUsers = pendingEmails.length
      ? await prisma.user.findMany({
          where: { email: { in: pendingEmails } },
          select: { id: true, email: true },
        })
      : [];
    const userByEmail = new Map(existingUsers.map((u) => [u.email, u]));

    if (existingUsers.length) {
      await prisma.$transaction(
        pendingLinks
          .map((link) => {
            const matchedUser = userByEmail.get(link.travelAgent.email);
            if (!matchedUser) return [];
            return [
              prisma.travelAgentOrganization.update({
                where: { id: link.id },
                data: { status: "INVITED", approvedAt: new Date() },
              }),
              prisma.travelAgentInvite.updateMany({
                where: {
                  organizationId,
                  travelAgentId: link.travelAgent.id,
                  email: link.travelAgent.email,
                  status: "PENDING",
                },
                data: { status: "INVITED" },
              }),
              prisma.travelAgentUser.upsert({
                where: {
                  travelAgentId_userId: {
                    travelAgentId: link.travelAgent.id,
                    userId: matchedUser.id,
                  },
                },
                update: { roleInAgent: "OWNER" },
                create: {
                  travelAgentId: link.travelAgent.id,
                  userId: matchedUser.id,
                  roleInAgent: "OWNER",
                },
              }),
            ];
          })
          .flat(),
      );
    }

    const agents = await prisma.travelAgent.findMany({
      where: {
        organizations: { some: { organizationId } },
      },
      orderBy: { name: "asc" },
      include: {
        organizations: {
          where: { organizationId },
          include: { organization: { select: { id: true, name: true } } },
        },
        trips: {
          where: { campaign: { organizationId } },
          select: { id: true, complianceStatus: true },
        },
      },
    });

    return jsonOk({
      agents: agents.map((agent) => {
        const trips = agent.trips;
        const compliant = trips.filter((t) => t.complianceStatus === "COMPLIANT").length;
        const nonCompliant = trips.filter((t) => t.complianceStatus === "NON_COMPLIANT").length;
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
        };
      }),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireApiUser(["ADMIN", "SUPERADMIN"]);
    const data = inviteSchema.parse(await req.json());
    const organizationId =
      user.role === "ADMIN" ? user.organizationId : data.organizationId;

    if (!organizationId) throw new HttpError(422, "organizationId wajib diisi");
    assertOrgScope(user, organizationId);

    const email = normalizeTravelAgentEmail(data.email);
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    const inviteStatus = existingUser ? "INVITED" : "PENDING";

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

      await tx.travelAgentOrganization.upsert({
        where: {
          travelAgentId_organizationId: {
            travelAgentId: agent.id,
            organizationId,
          },
        },
        update: {
          status: inviteStatus,
          invitedById: user.id,
          approvedAt: existingUser ? new Date() : null,
          notes: data.notes || undefined,
        },
        create: {
          travelAgentId: agent.id,
          organizationId,
          status: inviteStatus,
          invitedById: user.id,
          approvedAt: existingUser ? new Date() : null,
          notes: data.notes || null,
        },
      });

      const invite = await tx.travelAgentInvite.create({
        data: {
          travelAgentId: agent.id,
          organizationId,
          email,
          status: inviteStatus,
          invitedById: user.id,
        },
      });

      if (existingUser) {
        await tx.travelAgentUser.upsert({
          where: {
            travelAgentId_userId: {
              travelAgentId: agent.id,
              userId: existingUser.id,
            },
          },
          update: { roleInAgent: "OWNER" },
          create: {
            travelAgentId: agent.id,
            userId: existingUser.id,
            roleInAgent: "OWNER",
          },
        });
      }

      return { agent, invite };
    });

    await logAudit({
      actorId: user.id,
      action: "TRAVEL_AGENT_INVITE",
      entityType: "TravelAgent",
      entityId: result.agent.id,
      metadata: { organizationId, email, inviteId: result.invite.id, status: inviteStatus },
    });

    return jsonOk(
      {
        agent: result.agent,
        invite: result.invite,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}
