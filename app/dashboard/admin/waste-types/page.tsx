import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { WasteTypeManager, type WasteTypeRow } from "@/components/admin/WasteTypeManager";
import { RewardRateManager, type RateRow } from "@/components/admin/RewardRateManager";

export const metadata: Metadata = { title: "Jenis Sampah & Tarif" };

export default async function AdminWasteTypesPage() {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";

  const [wasteTypes, rates, campaigns] = await Promise.all([
    prisma.wasteType.findMany({
      where: { OR: [{ organizationId: null }, { organizationId: orgId }] },
      orderBy: [{ organizationId: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { depositItems: true } },
      },
    }),
    prisma.rewardRate.findMany({
      where: {
        OR: [
          { organizationId: null, campaignId: null },
          { organizationId: orgId },
          { campaign: { organizationId: orgId } },
        ],
      },
      orderBy: [{ active: "desc" }, { effectiveFrom: "desc" }],
      include: {
        wasteType: { select: { name: true } },
        organization: { select: { name: true } },
        campaign: { select: { name: true } },
      },
    }),
    prisma.campaign.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }),
  ]);

  const wasteTypeRows: WasteTypeRow[] = wasteTypes.map((w) => ({
    id: w.id,
    name: w.name,
    unit: w.unit,
    minWeightGrams: w.minWeightGrams,
    maxWeightGrams: w.maxWeightGrams,
    defaultRewardPerItem: w.defaultRewardPerItem,
    description: w.description,
    active: w.active,
    organizationId: w.organizationId,
    organizationName: w.organizationId === orgId ? user.organizationName : null,
    depositItemCount: w._count.depositItems,
  }));

  const rateRows: RateRow[] = rates.map((r) => ({
    id: r.id,
    wasteTypeName: r.wasteType.name,
    pointsPerItem: r.pointsPerItem,
    unit: r.unit,
    minWeightGrams: r.minWeightGrams,
    maxWeightGrams: r.maxWeightGrams,
    scopeLabel: r.campaign
      ? `Campaign: ${r.campaign.name}`
      : r.organization
        ? r.organization.name
        : "Global",
    active: r.active,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
  }));

  const rateWasteTypeOptions = wasteTypeRows
    .filter((w) => w.active)
    .map((w) => ({ id: w.id, name: w.name }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Jenis Sampah & Tarif"
        description="Atur jenis sampah yang diterima, batas berat, dan nilai reward organisasi."
      />
      <WasteTypeManager wasteTypes={wasteTypeRows} canManageGlobal={false} />
      <RewardRateManager
        rates={rateRows}
        wasteTypes={rateWasteTypeOptions}
        canManageGlobal={false}
        campaigns={campaigns}
      />
    </div>
  );
}
