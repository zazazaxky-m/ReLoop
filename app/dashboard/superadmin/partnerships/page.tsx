import type { Metadata } from "next";
import { MetricCard, PageHeader, PagePagination } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { displayUserField } from "@/lib/display-user";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";
import { ShieldCheck, Clock } from "@/components/ui/icons";
import { PartnershipPanel, type PartnerRow } from "@/components/pickup/PartnershipPanel";

export const metadata: Metadata = { title: "Kemitraan" };

interface ServiceArea {
  regions?: string[];
  note?: string;
}

export default async function SuperadminPartnershipsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requirePageUser(["SUPERADMIN"]);
  const params = await searchParams;
  const pagination = parsePageSearchParams(params);

  const [partnerships, total, pending, active] = await Promise.all([
    prisma.organizationCollectorPartner.findMany({
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      skip: pagination.skip,
      take: pagination.take,
      include: {
        organization: { select: { name: true } },
        collectorUser: { select: { name: true, email: true, phone: true } },
      },
    }),
    prisma.organizationCollectorPartner.count(),
    prisma.organizationCollectorPartner.count({
      where: { status: "PENDING_SUPERADMIN_APPROVAL" },
    }),
    prisma.organizationCollectorPartner.count({ where: { status: "ACTIVE" } }),
  ]);

  const rows: PartnerRow[] = partnerships.map((p) => {
    const area = (p.serviceAreaJson as ServiceArea | null) ?? {};
    return {
      id: p.id,
      status: p.status,
      organizationName: p.organization.name,
      collectorName: displayUserField(p.collectorUser.name) ?? "-",
      collectorEmail: displayUserField(p.collectorUser.email) ?? "-",
      collectorPhone: displayUserField(p.collectorUser.phone),
      serviceRegions: area.regions ?? [],
      serviceNote: area.note ?? null,
    };
  });

  const pageMeta = buildPaginationMeta(total, pagination);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kemitraan Pengepul"
        description="Tinjau dan kelola kerja sama antara organisasi dan pengepul."
      />
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <MetricCard label="Menunggu approval" value={pending} icon={Clock} tone="amber" />
        <MetricCard label="Kemitraan aktif" value={active} icon={ShieldCheck} tone="green" />
        <MetricCard
          label="Total kemitraan"
          value={total}
          tone="blue"
          className="col-span-2 lg:col-span-1"
        />
      </div>
      <PartnershipPanel viewer="superadmin" partnerships={rows} />
      <PagePagination
        basePath="/dashboard/superadmin/partnerships"
        page={pageMeta.page}
        totalPages={pageMeta.totalPages}
      />
    </div>
  );
}
