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

  const [tripGroups, statusGroups, agents] = await Promise.all([
    prisma.trip.groupBy({
      by: ["travelAgentId", "complianceStatus"],
      where: { campaign: { organizationId: orgId } },
      _count: { id: true },
    }),
    prisma.trip.groupBy({
      by: ["complianceStatus"],
      where: { campaign: { organizationId: orgId } },
      _count: { id: true },
    }),
    prisma.travelAgent.findMany({
      where: { organizations: { some: { organizationId: orgId } } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
      take: 200,
    }),
  ]);

  const tripsByAgent = new Map<
    string,
    { total: number; compliant: number; review: number; nonCompliant: number }
  >();

  for (const group of tripGroups) {
    if (!group.travelAgentId) continue;
    const stats = tripsByAgent.get(group.travelAgentId) ?? {
      total: 0,
      compliant: 0,
      review: 0,
      nonCompliant: 0,
    };
    const count = group._count.id;
    stats.total += count;
    if (group.complianceStatus === "COMPLIANT") stats.compliant += count;
    else if (group.complianceStatus === "NEEDS_REVIEW") stats.review += count;
    else if (group.complianceStatus === "NON_COMPLIANT") stats.nonCompliant += count;
    tripsByAgent.set(group.travelAgentId, stats);
  }

  const rows = agents.map((agent) => {
    const stats = tripsByAgent.get(agent.id) ?? {
      total: 0,
      compliant: 0,
      review: 0,
      nonCompliant: 0,
    };
    return {
      id: agent.id,
      name: agent.name,
      email: agent.email,
      tripCount: stats.total,
      compliantCount: stats.compliant,
      reviewCount: stats.review,
      nonCompliantCount: stats.nonCompliant,
      rate: stats.total ? Math.round((stats.compliant / stats.total) * 100) : 0,
    };
  });

  const countByStatus = new Map(statusGroups.map((g) => [g.complianceStatus, g._count.id]));
  const totalTrips = statusGroups.reduce((sum, g) => sum + g._count.id, 0);
  const compliantTrips = countByStatus.get("COMPLIANT") ?? 0;
  const nonCompliantTrips = countByStatus.get("NON_COMPLIANT") ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance Wisata"
        description="Pantau kepatuhan travel agent dari validasi gerbang masuk, gerbang pulang, dan pengembalian trash bag."
      />
      <div className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Total trip" value={totalTrips} icon={Users} tone="blue" />
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
