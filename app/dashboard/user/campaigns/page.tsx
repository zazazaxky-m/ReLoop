import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { isCampaignEligible } from "@/lib/campaign";
import { Card, CardContent, CardHeader, CardTitle, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";

export default async function UserCampaignsPage() {
  const user = await requirePageUser(["USER"]);
  const campaigns = await prisma.campaign.findMany({
    where: { status: "ACTIVE" },
    include: { organization: { select: { name: true } } },
    orderBy: { startAt: "desc" },
  });

  const eligible = campaigns.filter((c) => isCampaignEligible(c, user.email).eligible);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Campaign"
        description="Temukan program lingkungan aktif dan manfaat yang tersedia."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        {eligible.map((c) => (
          <Card key={c.id}>
            <CardHeader>
              <CardTitle>{c.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted">{c.description}</p>
              <p className="text-xs text-muted-soft">
                {c.organization.name} · {c.visibility}
                {c.rewardMultiplier ? ` · ${c.rewardMultiplier}x reward` : ""}
              </p>
              {c.startAt ? (
                <p className="text-xs text-muted">
                  {formatDate(c.startAt)} — {formatDate(c.endAt)}
                </p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
      {eligible.length === 0 ? (
        <p className="text-sm text-muted">Tidak ada campaign yang memenuhi syarat Anda.</p>
      ) : null}
    </div>
  );
}
