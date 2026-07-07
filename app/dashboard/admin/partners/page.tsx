import type { Metadata } from "next";
import { PageHeader, PagePagination } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { displayUserField } from "@/lib/display-user";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";
import { PartnershipPanel, type PartnerRow } from "@/components/pickup/PartnershipPanel";

export const metadata: Metadata = { title: "Mitra Pengepul" };

interface ServiceArea {
  regions?: string[];
  note?: string;
}

export default async function AdminPartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";
  const params = await searchParams;
  const pagination = parsePageSearchParams(params);

  const where = { organizationId: orgId };

  const [partnerships, total] = await Promise.all([
    prisma.organizationCollectorPartner.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: pagination.skip,
      take: pagination.take,
      include: {
        organization: { select: { name: true } },
        collectorUser: { select: { name: true, email: true, phone: true } },
      },
    }),
    prisma.organizationCollectorPartner.count({ where }),
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
        title="Mitra Pengepul"
        description="Kelola undangan dan status kerja sama dengan pengepul."
      />
      <PartnershipPanel viewer="admin" partnerships={rows} />
      <PagePagination
        basePath="/dashboard/admin/partners"
        page={pageMeta.page}
        totalPages={pageMeta.totalPages}
      />
    </div>
  );
}
