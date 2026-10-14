import type { Metadata } from "next";
import { PageHeader, PagePagination } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { regionOptions } from "@/lib/queries";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";
import { OrganizationManager, type OrgRow } from "@/components/admin/OrganizationManager";
import { RewardFundingPanel } from "@/components/admin/RewardFundingPanel";

export const metadata: Metadata = { title: "Organisasi" };

export default async function SuperadminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePageUser(["SUPERADMIN"]);
  const params = await searchParams;
  const pagination = parsePageSearchParams(params);

  const [organizations, total, regions] = await Promise.all([
    prisma.organization.findMany({
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        region: { select: { name: true } },
        _count: { select: { machines: true, users: true } },
      },
    }),
    prisma.organization.count(),
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
    machineRewardMode: o.machineRewardMode,
  }));

  const pageMeta = buildPaginationMeta(total, pagination);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Organisasi"
        description="Kelola organisasi, wilayah, dan status operasionalnya."
      />
      <OrganizationManager organizations={rows} regions={regions} />
      <RewardFundingPanel organizations={rows.map((row) => ({ id: row.id, name: row.name }))} />
      <PagePagination
        basePath="/dashboard/superadmin/organizations"
        page={pageMeta.page}
        totalPages={pageMeta.totalPages}
      />
    </div>
  );
}
