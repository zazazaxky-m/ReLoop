import type { Metadata } from "next";
import { MetricCard, PageHeader } from "@/components/ui";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { ShieldCheck, Clock } from "@/components/ui/icons";
import { PartnershipPanel, type PartnerRow } from "@/components/pickup/PartnershipPanel";

export const metadata: Metadata = { title: "Kemitraan" };

interface ServiceArea {
  regions?: string[];
  note?: string;
}

const ORDER: Record<string, number> = {
  PENDING_SUPERADMIN_APPROVAL: 0,
  REQUESTED: 1,
  INVITED: 2,
  ACTIVE: 3,
  SUSPENDED: 4,
  REJECTED: 5,
  REMOVED: 6,
};

export default async function SuperadminPartnershipsPage() {
  await requirePageUser(["SUPERADMIN"]);

  const partnerships = await prisma.organizationCollectorPartner.findMany({
    include: {
      organization: { select: { name: true } },
      collectorUser: { select: { name: true, email: true, phone: true } },
    },
  });

  const rows: PartnerRow[] = partnerships
    .map((p) => {
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
    })
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9));

  const pending = rows.filter((r) => r.status === "PENDING_SUPERADMIN_APPROVAL").length;
  const active = rows.filter((r) => r.status === "ACTIVE").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Kemitraan Pengepul"
        description="Setujui atau tolak kemitraan organisasi–pengepul. Hanya kemitraan ACTIVE yang bisa menerima assignment pickup."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Menunggu approval" value={pending} icon={Clock} />
        <MetricCard label="Kemitraan aktif" value={active} icon={ShieldCheck} />
        <MetricCard label="Total kemitraan" value={rows.length} />
      </div>
      <PartnershipPanel viewer="superadmin" partnerships={rows} />
    </div>
  );
}
