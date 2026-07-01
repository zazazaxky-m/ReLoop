import type { Metadata } from "next";
import { Card, CardContent, CardHeader, CardTitle, DataTable, MetricCard, PageHeader, StatusBadge, type Column } from "@/components/ui";
import { CheckCircle, AlertTriangle, Users } from "@/components/ui/icons";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export const metadata: Metadata = { title: "Compliance Wisata" };

interface Row {
  id: string;
  name: string;
  email: string;
  tripCount: number;
  compliantCount: number;
  reviewCount: number;
  nonCompliantCount: number;
  rate: number;
}

const columns: Column<Row>[] = [
  {
    key: "agent",
    header: "Travel Agent",
    render: (r) => (
      <div>
        <p className="font-medium text-foreground">{r.name}</p>
        <p className="text-xs text-muted">{r.email}</p>
      </div>
    ),
  },
  { key: "trip", header: "Trip", render: (r) => `${r.tripCount}` },
  {
    key: "rate",
    header: "Patuh",
    render: (r) => (
      <div>
        <p className="font-semibold text-foreground">{r.rate}%</p>
        <p className="text-xs text-muted">{r.compliantCount} compliant</p>
      </div>
    ),
  },
  {
    key: "risk",
    header: "Status",
    render: (r) => (
      <StatusBadge
        status={
          r.tripCount === 0
            ? "NOT_STARTED"
            : r.nonCompliantCount > 0
              ? "NON_COMPLIANT"
              : r.reviewCount > 0
                ? "NEEDS_REVIEW"
                : "COMPLIANT"
        }
      />
    ),
  },
];

export default async function AdminCompliancePage() {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";

  const [trips, agents] = await Promise.all([
    prisma.trip.findMany({
      where: { campaign: { organizationId: orgId } },
      select: { id: true, complianceStatus: true, travelAgentId: true },
    }),
    prisma.travelAgent.findMany({
      where: { organizations: { some: { organizationId: orgId } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  const rows = agents.map((agent) => {
    const agentTrips = trips.filter((t) => t.travelAgentId === agent.id);
    const compliantCount = agentTrips.filter((t) => t.complianceStatus === "COMPLIANT").length;
    const reviewCount = agentTrips.filter((t) => t.complianceStatus === "NEEDS_REVIEW").length;
    const nonCompliantCount = agentTrips.filter((t) => t.complianceStatus === "NON_COMPLIANT").length;
    return {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      tripCount: agentTrips.length,
      compliantCount,
      reviewCount,
      nonCompliantCount,
      rate: agentTrips.length ? Math.round((compliantCount / agentTrips.length) * 100) : 0,
    };
  });

  const compliantTrips = trips.filter((t) => t.complianceStatus === "COMPLIANT").length;
  const nonCompliantTrips = trips.filter((t) => t.complianceStatus === "NON_COMPLIANT").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Wisata"
        description="Pantau kepatuhan travel agent dari validasi gerbang masuk, gerbang pulang, dan pengembalian trash bag."
      />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Total trip" value={trips.length} icon={Users} tone="blue" />
        <MetricCard label="Trip patuh" value={compliantTrips} icon={CheckCircle} tone="green" />
        <MetricCard label="Tidak patuh" value={nonCompliantTrips} icon={AlertTriangle} tone="amber" />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Compliance per Travel Agent</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={rows}
            getRowKey={(r) => r.id}
            emptyTitle="Belum ada data compliance"
            emptyDescription="Invite travel agent dan buat trip untuk mulai mengumpulkan data kepatuhan."
          />
        </CardContent>
      </Card>
    </div>
  );
}
