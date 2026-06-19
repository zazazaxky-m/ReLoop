import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { organizationOptions } from "@/lib/queries";
import { PartnershipPanel, type PartnerRow } from "@/components/pickup/PartnershipPanel";

export const metadata: Metadata = { title: "Area & Kemitraan" };

interface ServiceArea {
  regions?: string[];
  note?: string;
}

export default async function PengepulAreaPage() {
  const user = await requirePageUser(["PENGEPUL"]);

  const [partnerships, organizations] = await Promise.all([
    prisma.organizationCollectorPartner.findMany({
      where: { collectorUserId: user.id },
      orderBy: { updatedAt: "desc" },
      include: {
        organization: { select: { name: true } },
        collectorUser: { select: { name: true, email: true, phone: true } },
      },
    }),
    organizationOptions(),
  ]);

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
        title="Area Layanan & Kemitraan"
        description="Kelola wilayah layanan serta hubungan kemitraan dengan organisasi."
      />
      <PartnershipPanel viewer="pengepul" partnerships={rows} organizations={organizations} />
    </div>
  );
}
