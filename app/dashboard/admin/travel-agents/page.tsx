import type { Metadata } from "next";
import { PageHeader, PagePagination } from "@/components/ui";
import { TravelAgentManager, type TravelAgentRow } from "@/components/travel-agent/TravelAgentManager";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";
import { inviteSummary } from "@/lib/invitations";

export const metadata: Metadata = { title: "Travel Agent" };

export default async function AdminTravelAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";
  const params = await searchParams;
  const pagination = parsePageSearchParams(params);

  const where = { organizations: { some: { organizationId: orgId } } };

  const [agents, total] = await Promise.all([
    prisma.travelAgent.findMany({
      where,
      orderBy: { name: "asc" },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        organizations: { where: { organizationId: orgId } },
        invites: {
          where: { organizationId: orgId },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true, expiresAt: true, acceptedAt: true },
        },
        users: { select: { verifiedAt: true, user: { select: { emailVerifiedAt: true } } } },
        trips: {
          where: { campaign: { organizationId: orgId } },
          select: { id: true, complianceStatus: true },
        },
      },
    }),
    prisma.travelAgent.count({ where }),
  ]);

  const rows: TravelAgentRow[] = agents.map((agent) => {
    const trips = agent.trips;
    return {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      phone: agent.phone,
      contactPerson: agent.contactPerson,
      status: agent.status,
      organizationStatus: agent.organizations[0]?.status ?? "PENDING",
      tripCount: trips.length,
      compliantCount: trips.filter((t) => t.complianceStatus === "COMPLIANT").length,
      nonCompliantCount: trips.filter((t) => t.complianceStatus === "NON_COMPLIANT").length,
      memberCount: agent.users.length,
      verifiedMemberCount: agent.users.filter((m) => m.verifiedAt && m.user.emailVerifiedAt).length,
      inviteState: inviteSummary(agent.invites[0])?.state ?? null,
    };
  });

  const pageMeta = buildPaginationMeta(total, pagination);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Travel Agent"
        description="Invite agent, kelola relasi tempat wisata, dan pantau kepatuhan rombongan."
      />
      <TravelAgentManager agents={rows} />
      <PagePagination
        basePath="/dashboard/admin/travel-agents"
        page={pageMeta.page}
        totalPages={pageMeta.totalPages}
      />
    </div>
  );
}
