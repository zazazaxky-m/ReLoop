import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { regionOptions } from "@/lib/queries";
import { OrganizationManager, type OrgRow } from "@/components/admin/OrganizationManager";

export const metadata: Metadata = { title: "Organisasi" };

export default async function SuperadminOrganizationsPage() {
  await requirePageUser(["SUPERADMIN"]);

  const [organizations, regions] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        region: { select: { name: true } },
        _count: { select: { machines: true, users: true } },
      },
    }),
    regionOptions(),
  ]);

  const rows: OrgRow[] = organizations.map((o) => ({
    id: o.id,
    name: o.name,
    type: o.type,
    status: o.status,
    regionName: o.region?.name ?? null,
    machineCount: o._count.machines,
    userCount: o._count.users,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisasi"
        description="Kelola organisasi, wilayah, dan status operasionalnya."
      />
      <OrganizationManager organizations={rows} regions={regions} />
    </div>
  );
}
