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
import { MachineActivityPanel } from "./MachineActivityPanel";
import { MachineRemoteConsole } from "./MachineRemoteConsole";
import { MachineMediaManager } from "./MachineMediaManager";
import type { MachineCaptureRow } from "@/lib/machine-captures";
import type { SecurityEventRow } from "@/lib/security-events";
import type { RemoteCommandView } from "@/lib/remote-commands";

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
  sessionIdleTimeoutMinutes: number;
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
  securityEvents,
  cameraCaptures,
  remoteCommands,
}: {
  machine: DetailMachine;
  wasteTypes: { id: string; name: string }[];
  regions?: { id: string; name: string }[];
  listHref: string;
  // Provided only for superadmin — exposes the per-machine HMAC secret.
  ingestSecret?: string | null;
  securityEvents?: SecurityEventRow[];
  cameraCaptures?: MachineCaptureRow[];
  remoteCommands?: RemoteCommandView[];
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
        <MetricCard className="min-h-24" label="Status" value={<StatusBadge status={machine.status} />} icon={Signal} />
        <MetricCard className="min-h-24" label="Fill Level" value={`${machine.fillLevelPercent}%`} icon={Box} hint={machine.capacityKg ? `Kapasitas ${machine.capacityKg} kg` : undefined} />
        <MetricCard className="min-h-24" label="Rotasi QR" value={`${machine.qrRotationSeconds}s`} icon={QrCode} hint={`Chamber ${machine.chamberTimeoutSeconds}s · sesi idle ${machine.sessionIdleTimeoutMinutes}m`} />
        <MetricCard className="min-h-24" label="Heartbeat" value={machine.lastHeartbeatAt ? "Aktif" : "-"} icon={Wrench} hint={formatDateTime(machine.lastHeartbeatAt)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Informasi Mesin</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              <Row label="Kode" value={machine.machineCode} />
              <Row label="Organisasi" value={machine.organization?.name ?? "-"} />
              <Row label="Wilayah" value={machine.region?.name ?? "-"} />
              <Row label="Deskripsi" value={machine.description ?? "-"} />
              <div className="flex flex-wrap gap-2 pt-1 sm:col-span-2">
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
              <div className="border-t border-border pt-3 sm:col-span-2">
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.08em] text-muted">
                  Jenis sampah didukung
                </p>
                {machine.wasteTypes.length ? (
                  <div className="flex flex-wrap gap-2">
                    {machine.wasteTypes.map((w) => (
                      <span key={w.wasteTypeId} className="rounded-full bg-mint px-2.5 py-1 text-xs font-medium text-brand-700 dark:text-brand-400">
                        {w.wasteType.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted">Belum ada jenis sampah.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <MachineActivityPanel
            securityEvents={securityEvents}
            cameraCaptures={cameraCaptures}
            sessions={machine.sessions}
          />
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
                  <img src={qr} alt="QR mesin" className="mx-auto h-36 w-36 rounded-xl border border-border" />
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
                href={`/kiosk/${machine.machineCode}`}
                target="_blank"
                className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}
              >
                Buka Layar Mesin (Kios)
              </Link>
            </CardContent>
          </Card>

          {ingestSecret !== undefined ? (
            <MachineMediaManager machineId={machine.id} />
          ) : null}

          {ingestSecret !== undefined ? (
            <MachineRemoteConsole
              machineId={machine.id}
              initialData={{
                machine: {
                  machineCode: machine.machineCode,
                  status: machine.status,
                  fillLevelPercent: machine.fillLevelPercent,
                  lastHeartbeatAt: machine.lastHeartbeatAt?.toISOString() ?? null,
                },
                commands: remoteCommands ?? [],
              }}
            />
          ) : null}

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
              sessionIdleTimeoutMinutes: machine.sessionIdleTimeoutMinutes,
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
