import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { CampaignManager, type CampaignRow } from "@/components/admin/CampaignManager";

export const metadata: Metadata = { title: "Campaign" };

export default async function AdminCampaignsPage() {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";

  const campaigns = await prisma.campaign.findMany({
    where: { organizationId: orgId },
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { sessions: true } } },
  });

  const rows: CampaignRow[] = campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    campaignType: c.campaignType,
    rewardMode: c.rewardMode,
    visibility: c.visibility,
    allowedEmailDomains: (c.allowedEmailDomainsJson as string[] | null) ?? [],
    startAt: c.startAt,
    endAt: c.endAt,
    rewardMultiplier: c.rewardMultiplier,
    status: c.status,
    sessionCount: c._count.sessions,
    organizationName: null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaign"
        description="Buat dan kelola program lingkungan untuk pengguna organisasi."
      />
      <CampaignManager campaigns={rows} />
    </div>
  );
}
