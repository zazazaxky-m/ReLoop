import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PartnershipPanel, type PartnerRow } from "@/components/pickup/PartnershipPanel";

export const metadata: Metadata = { title: "Mitra Pengepul" };

interface ServiceArea {
  regions?: string[];
  note?: string;
}

export default async function AdminPartnersPage() {
  const user = await requirePageUser(["ADMIN"]);
  const orgId = user.organizationId ?? "__none__";

  const partnerships = await prisma.organizationCollectorPartner.findMany({
    where: { organizationId: orgId },
    orderBy: { updatedAt: "desc" },
    include: {
      organization: { select: { name: true } },
      collectorUser: { select: { name: true, email: true, phone: true } },
    },
  });

  const rows: PartnerRow[] = partnerships.map((p) => {
    const area = (p.serviceAreaJson as ServiceArea | null) ?? {};
    return {
      id: p.id,
      status: p.status,
      organizationName: p.organization.name,
      collectorName: p.collectorUser.name,
      collectorEmail: p.collectorUser.email,
      collectorPhone: p.collectorUser.phone,
      serviceRegions: area.regions ?? [],
      serviceNote: area.note ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mitra Pengepul"
        description="Kelola undangan dan status kerja sama dengan pengepul."
      />
      <PartnershipPanel viewer="admin" partnerships={rows} />
    </div>
  );
}
