import type { Metadata } from "next";
import { requirePageUser } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { PageHeader, Card, CardContent } from "@/components/ui";
import { MapView } from "@/components/map/MapView";
import { MapLegend } from "@/components/map/MapLegend";
import { machineCentroid, type MapMachine, type MapCampaign } from "@/lib/map";

export const metadata: Metadata = { title: "Peta" };

export default async function MapPage() {
  await requirePageUser();

  const [machines, campaigns] = await Promise.all([
    prisma.machine.findMany({
      where: { latitude: { not: null }, longitude: { not: null } },
      include: {
        organization: { select: { name: true } },
        wasteTypes: { where: { active: true }, include: { wasteType: { select: { name: true } } } },
      },
    }),
    prisma.campaign.findMany({
      where: { visibility: "PUBLIC", status: "ACTIVE" },
      include: {
        organization: {
          select: {
            name: true,
            machines: { select: { latitude: true, longitude: true } },
          },
        },
      },
    }),
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

  const mapCampaigns: MapCampaign[] = campaigns
    .map((c) => {
      const centroid = machineCentroid(c.organization.machines);
      if (!centroid) return null;
      return {
        id: c.id,
        name: c.name,
        organizationName: c.organization.name,
        latitude: centroid.latitude,
        longitude: centroid.longitude,
        rewardMultiplier: c.rewardMultiplier,
      };
    })
    .filter((c): c is MapCampaign => c !== null);

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
            {mapMachines.length} mesin · {mapCampaigns.length} program publik aktif.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
