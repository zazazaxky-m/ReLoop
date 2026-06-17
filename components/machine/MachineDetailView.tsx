import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  MetricCard,
  StatusBadge,
  buttonVariants,
} from "@/components/ui";
import { Box, QrCode, Signal, Wrench } from "@/components/ui/icons";
import { buildScanUrl, isTokenValid, qrDataUrl } from "@/lib/qr";
import { formatDateTime } from "@/lib/format";
import { MachineControls } from "./MachineControls";
import { MachineSecurity } from "./MachineSecurity";

interface DetailMachine {
  id: string;
  machineCode: string;
  name: string;
  description: string | null;
  status: string;
  fillLevelPercent: number;
  capacityKg: number | null;
  qrRotationSeconds: number;
  chamberTimeoutSeconds: number;
  hasInputChamber: boolean;
  hasConveyor: boolean;
  hasCompactor: boolean;
  hasExternalCamera: boolean;
  regionId: string | null;
  lastHeartbeatAt: Date | null;
  qrToken: string | null;
  qrTokenExpiresAt: Date | null;
  organization: { id: string; name: string } | null;
  region: { id: string; name: string } | null;
  wasteTypes: { wasteTypeId: string; active: boolean; wasteType: { id: string; name: string } }[];
  sessions: { id: string; status: string; startedAt: Date; completedAt: Date | null }[];
}

const hardwareChips = (m: DetailMachine) =>
  [
    ["Input chamber", m.hasInputChamber],
    ["Conveyor", m.hasConveyor],
    ["Compactor", m.hasCompactor],
    ["Kamera eksternal", m.hasExternalCamera],
  ] as const;

export async function MachineDetailView({
  machine,
  wasteTypes,
  regions,
  listHref,
  ingestSecret,
}: {
  machine: DetailMachine;
  wasteTypes: { id: string; name: string }[];
  regions?: { id: string; name: string }[];
  listHref: string;
  // Provided only for superadmin — exposes the per-machine HMAC secret.
  ingestSecret?: string | null;
}) {
  const tokenValid =
    machine.qrToken &&
    isTokenValid(machine, machine.qrToken);
  const scanUrl = tokenValid
    ? buildScanUrl(machine.machineCode, machine.qrToken as string)
    : null;
  const qr = scanUrl ? await qrDataUrl(scanUrl) : null;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Status" value={<StatusBadge status={machine.status} />} icon={Signal} />
        <MetricCard label="Fill Level" value={`${machine.fillLevelPercent}%`} icon={Box} hint={machine.capacityKg ? `Kapasitas ${machine.capacityKg} kg` : undefined} />
        <MetricCard label="Rotasi QR" value={`${machine.qrRotationSeconds}s`} icon={QrCode} hint={`Timeout chamber ${machine.chamberTimeoutSeconds}s`} />
        <MetricCard label="Heartbeat" value={machine.lastHeartbeatAt ? "Aktif" : "-"} icon={Wrench} hint={formatDateTime(machine.lastHeartbeatAt)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Informasi Mesin</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Row label="Kode" value={machine.machineCode} />
              <Row label="Organisasi" value={machine.organization?.name ?? "-"} />
              <Row label="Wilayah" value={machine.region?.name ?? "-"} />
              <Row label="Deskripsi" value={machine.description ?? "-"} />
              <div className="flex flex-wrap gap-2 pt-1">
                {hardwareChips(machine).map(([label, on]) => (
                  <span
                    key={label}
                    className={
                      on
                        ? "rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-700"
                        : "rounded-full border border-border bg-slate-50 px-2.5 py-0.5 text-xs text-muted line-through"
                    }
                  >
                    {label}
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Jenis Sampah Didukung</CardTitle>
            </CardHeader>
            <CardContent>
              {machine.wasteTypes.length === 0 ? (
                <p className="text-sm text-muted">Belum ada jenis sampah.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {machine.wasteTypes.map((w) => (
                    <span
                      key={w.wasteTypeId}
                      className="rounded-full bg-mint px-3 py-1 text-sm font-medium text-brand-700"
                    >
                      {w.wasteType.name}
                    </span>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sesi Terbaru</CardTitle>
            </CardHeader>
            <CardContent>
              {machine.sessions.length === 0 ? (
                <p className="text-sm text-muted">Belum ada sesi deposit.</p>
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {machine.sessions.map((s) => (
                    <li key={s.id} className="flex items-center justify-between py-2">
                      <span className="text-muted">{formatDateTime(s.startedAt)}</span>
                      <StatusBadge status={s.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>QR Dinamis</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-center">
              {qr ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="QR mesin" className="mx-auto h-48 w-48 rounded-xl border border-border" />
                  <p className="text-xs text-muted">
                    Snapshot token saat ini. QR berotasi tiap {machine.qrRotationSeconds}s di layar mesin.
                  </p>
                </>
              ) : (
                <p className="py-8 text-sm text-muted">
                  Token QR belum aktif. Buka layar mesin untuk membuat QR dinamis.
                </p>
              )}
              <Link
                href={`/machine/${machine.machineCode}/display`}
                target="_blank"
                className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}
              >
                Buka Layar Mesin (Kios)
              </Link>
            </CardContent>
          </Card>

          <MachineControls
            machine={{
              id: machine.id,
              machineCode: machine.machineCode,
              name: machine.name,
              description: machine.description,
              status: machine.status,
              capacityKg: machine.capacityKg,
              qrRotationSeconds: machine.qrRotationSeconds,
              chamberTimeoutSeconds: machine.chamberTimeoutSeconds,
              hasInputChamber: machine.hasInputChamber,
              hasConveyor: machine.hasConveyor,
              hasCompactor: machine.hasCompactor,
              hasExternalCamera: machine.hasExternalCamera,
              regionId: machine.regionId,
              wasteTypeIds: machine.wasteTypes.map((w) => w.wasteTypeId),
            }}
            wasteTypes={wasteTypes}
            regions={regions}
            listHref={listHref}
          />

          {ingestSecret !== undefined ? (
            <MachineSecurity
              machineId={machine.id}
              machineCode={machine.machineCode}
              initialSecret={ingestSecret}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted">{label}</span>
      <span className="text-right font-medium text-foreground">{value}</span>
    </div>
  );
}
