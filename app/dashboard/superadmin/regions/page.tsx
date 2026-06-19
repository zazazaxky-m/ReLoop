import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { RegionManager, type RegionRow } from "@/components/admin/RegionManager";

export const metadata: Metadata = { title: "Wilayah" };

export default async function SuperadminRegionsPage() {
  await requirePageUser(["SUPERADMIN"]);

  const regions = await prisma.region.findMany({
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: {
      parent: { select: { name: true } },
      _count: { select: { children: true, organizations: true } },
    },
  });

  const rows: RegionRow[] = regions.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    parentName: r.parent?.name ?? null,
    childCount: r._count.children,
    orgCount: r._count.organizations,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Wilayah"
        description="Kelola struktur provinsi, kabupaten atau kota, kecamatan, dan desa atau kelurahan."
      />
      <RegionManager regions={rows} />
    </div>
  );
}
