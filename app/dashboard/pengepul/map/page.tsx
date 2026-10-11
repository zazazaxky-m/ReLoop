import type { Metadata } from "next";
import { requirePageUser, activePartnerOrgIds } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { Card, CardContent, PageHeader, PagePagination, StatusBadge } from "@/components/ui";
import { MapView } from "@/components/map/MapView";
import { MapLegend } from "@/components/map/MapLegend";
import type { MapMachine } from "@/lib/map";
import { buildPaginationMeta, parsePageSearchParams } from "@/lib/page-pagination";

export const metadata: Metadata = { title: "Peta Mesin" };

const MAX_MAP_MACHINES = 500;

export default async function PengepulMapPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requirePageUser(["PENGEPUL"]);
  const orgIds = await activePartnerOrgIds(user.id);
  const params = await searchParams;
  const pagination = parsePageSearchParams(params, { defaultLimit: 25 });

  const orgFilter = { organizationId: { in: orgIds.length ? orgIds : ["__none__"] } };

  const [mapMachinesRaw, listMachines, total] = await Promise.all([
    prisma.machine.findMany({
      where: {
        ...orgFilter,
        latitude: { not: null },
        longitude: { not: null },
      },
      include: { organization: { select: { name: true } } },
      take: MAX_MAP_MACHINES,
    }),
    prisma.machine.findMany({
      where: orgFilter,
      include: { organization: { select: { name: true } } },
      orderBy: { name: "asc" },
      skip: pagination.skip,
      take: pagination.take,
    }),
    prisma.machine.count({ where: orgFilter }),
  ]);

  const mapMachines: MapMachine[] = mapMachinesRaw.map((m) => ({
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

  const pageMeta = buildPaginationMeta(total, pagination);

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
            <MapView machines={mapMachines} heightClassName="h-[420px]" />
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
            {listMachines.map((m) => (
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
          <PagePagination
            basePath="/dashboard/pengepul/map"
            page={pageMeta.page}
            totalPages={pageMeta.totalPages}
          />
        </CardContent>
      </Card>
    </div>
  );
}
