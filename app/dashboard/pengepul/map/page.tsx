import type { Metadata } from "next";
import { requirePageUser, activePartnerOrgIds } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, PageHeader, StatusBadge } from "@/components/ui";
import { MapView } from "@/components/map/MapView";
import { MapLegend } from "@/components/map/MapLegend";
import type { MapMachine } from "@/lib/map";

export const metadata: Metadata = { title: "Peta Mesin" };

export default async function PengepulMapPage() {
  const user = await requirePageUser(["PENGEPUL"]);
  const orgIds = await activePartnerOrgIds(user.id);

  const machines = await prisma.machine.findMany({
    where: { organizationId: { in: orgIds.length ? orgIds : ["__none__"] } },
    include: { organization: { select: { name: true } } },
  });

  const mapMachines: MapMachine[] = machines
    .filter((m) => m.latitude != null && m.longitude != null)
    .map((m) => ({
      id: m.id,
      name: m.name,
      machineCode: m.machineCode,
      status: m.status,
      fillLevelPercent: m.fillLevelPercent,
      capacityKg: m.capacityKg,
      organizationName: m.organization.name,
      latitude: m.latitude as number,
      longitude: m.longitude as number,
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Peta Mesin"
        description="Temukan mesin mitra dan lihat status serta kapasitas terkini."
      />
      <Card>
        <CardContent className="space-y-4 p-4">
          <MapLegend showCampaign={false} />
          {mapMachines.length > 0 ? (
            <MapView machines={mapMachines} height={420} />
          ) : (
            <p className="py-8 text-center text-sm text-muted">
              Belum ada mesin dengan koordinat pada organisasi mitra Anda.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <ul className="divide-y divide-border">
            {machines.map((m) => (
              <li key={m.id} className="flex justify-between py-3 text-sm">
                <div>
                  <p className="font-medium">{m.name}</p>
                  <p className="text-xs text-muted">
                    {m.organization.name} · terisi {m.fillLevelPercent}%
                  </p>
                </div>
                <StatusBadge status={m.status} />
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
