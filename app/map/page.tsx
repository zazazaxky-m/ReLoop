import type { Metadata } from "next";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, CardContent } from "@/components/ui";
import { MapView } from "@/components/map/MapView";
import { MapLegend } from "@/components/map/MapLegend";
import { type MapMachine } from "@/lib/map";
import { loadPublicMapCampaigns, MAX_MAP_MACHINES } from "@/lib/map-data";

export const metadata: Metadata = { title: "Peta" };

export default async function MapPage() {
  await requirePageUser();

  const [machines, mapCampaigns] = await Promise.all([
    prisma.machine.findMany({
      where: { latitude: { not: null }, longitude: { not: null } },
      include: {
        organization: { select: { name: true } },
        wasteTypes: { where: { active: true }, include: { wasteType: { select: { name: true } } } },
      },
      orderBy: { name: "asc" },
      take: MAX_MAP_MACHINES,
    }),
    loadPublicMapCampaigns(),
  ]);

  const mapMachines: MapMachine[] = machines.map((m) => ({
    id: m.id,
    name: m.name,
    machineCode: m.machineCode,
    status: m.status,
    fillLevelPercent: m.fillLevelPercent,
    capacityKg: m.capacityKg,
    organizationName: m.organization.name,
    latitude: m.latitude as number,
    longitude: m.longitude as number,
    supportedWasteTypes: m.wasteTypes.map((w) => w.wasteType.name),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Peta Lokasi"
        description="Temukan mesin terdekat dan lihat status operasional serta kapasitasnya."
      />
      <Card>
        <CardContent className="space-y-4 p-4">
          <MapLegend />
          <MapView machines={mapMachines} campaigns={mapCampaigns} height={520} />
          <p className="text-xs text-muted">
            {mapMachines.length} mesin · {mapCampaigns.length} program publik aktif
            {machines.length >= MAX_MAP_MACHINES ? " (tampilan dibatasi)" : ""}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
