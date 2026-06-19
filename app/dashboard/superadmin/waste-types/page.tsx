import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { organizationOptions } from "@/lib/queries";
import { WasteTypeManager, type WasteTypeRow } from "@/components/admin/WasteTypeManager";
import { RewardRateManager, type RateRow } from "@/components/admin/RewardRateManager";

export const metadata: Metadata = { title: "Jenis Sampah & Tarif Global" };

export default async function SuperadminWasteTypesPage() {
  await requirePageUser(["SUPERADMIN"]);

  const [wasteTypes, rates, organizations] = await Promise.all([
    prisma.wasteType.findMany({
      orderBy: [{ organizationId: "asc" }, { name: "asc" }],
      include: {
        _count: { select: { depositItems: true } },
      },
    }),
    prisma.rewardRate.findMany({
      orderBy: [{ active: "desc" }, { effectiveFrom: "desc" }],
      include: {
        wasteType: { select: { name: true } },
        organization: { select: { name: true } },
        campaign: { select: { name: true } },
      },
    }),
    organizationOptions(),
  ]);

  const orgNameById = new Map(organizations.map((o) => [o.id, o.name]));

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
    organizationName: w.organizationId ? (orgNameById.get(w.organizationId) ?? null) : null,
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
        title="Jenis Sampah & Tarif Global"
        description="Kelola jenis sampah dan kebijakan reward yang digunakan sistem."
      />
      <WasteTypeManager
        wasteTypes={wasteTypeRows}
        canManageGlobal
        organizations={organizations}
      />
      <RewardRateManager
        rates={rateRows}
        wasteTypes={rateWasteTypeOptions}
        canManageGlobal
        organizations={organizations}
      />
    </div>
  );
}
