import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { TravelAgentManager, type TravelAgentRow } from "@/components/travel-agent/TravelAgentManager";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Travel Agent" };

export default async function AdminTravelAgentsPage() {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";

  const agents = await prisma.travelAgent.findMany({
    where: { organizations: { some: { organizationId: orgId } } },
    orderBy: { name: "asc" },
    include: {
      organizations: { where: { organizationId: orgId } },
      invites: {
        where: { organizationId: orgId },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      trips: {
        where: { campaign: { organizationId: orgId } },
        select: { id: true, complianceStatus: true },
      },
    },
  });

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
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Travel Agent"
        description="Invite agent, kelola relasi tempat wisata, dan pantau kepatuhan rombongan."
      />
      <TravelAgentManager agents={rows} />
    </div>
  );
}
