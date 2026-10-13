import type { Metadata } from "next";
import { PageHeader, PagePagination } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";
import { CampaignManager, type CampaignRow } from "@/components/admin/CampaignManager";

export const metadata: Metadata = { title: "Campaign" };

export default async function AdminCampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";
  const params = await searchParams;
  const pagination = parsePageSearchParams(params);

  const where = { organizationId: orgId };

  const [campaigns, total] = await Promise.all([
    prisma.campaign.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      include: { _count: { select: { sessions: true } } },
    }),
    prisma.campaign.count({ where }),
  ]);

  const rows: CampaignRow[] = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    campaignType: c.campaignType,
    rewardMode: c.rewardMode,
    supportsMachine: c.supportsMachine,
    visibility: c.visibility,
    allowedEmailDomains: (c.allowedEmailDomainsJson as string[] | null) ?? [],
    startAt: c.startAt,
    endAt: c.endAt,
    rewardMultiplier: c.rewardMultiplier,
    status: c.status,
    sessionCount: c._count.sessions,
    organizationName: null,
  }));

  const pageMeta = buildPaginationMeta(total, pagination);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaign"
        description="Buat dan kelola program lingkungan untuk pengguna organisasi."
      />
      <CampaignManager campaigns={rows} />
      <PagePagination
        basePath="/dashboard/admin/campaigns"
        page={pageMeta.page}
        totalPages={pageMeta.totalPages}
      />
    </div>
  );
}
