"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "@/components/ui";
import {
  DANGEROUS_REMOTE_COMMANDS,
  remoteCommandLabels,
  type RemoteCommandView,
} from "@/lib/remote-commands";
import type { RemoteCommandType } from "@prisma/client";

type RemoteData = {
  machine: {
    machineCode: string;
    status: string;
    fillLevelPercent: number;
    lastHeartbeatAt: string | null;
  };
  commands: RemoteCommandView[];
};

const MONITORING: RemoteCommandType[] = [
  "REFRESH_STATE",
  "CAPTURE_SNAPSHOT",
  "SYNC_NOW",
];
const SAFETY: RemoteCommandType[] = [
  "STOP_ALL",
  "CLOSE_GATE",
  "OPEN_GATE",
  "RESET_ALERT",
];
const MODE: RemoteCommandType[] = [
  "ENTER_MAINTENANCE",
  "RESUME_OPERATION",
];

export function MachineRemoteConsole({
  machineId,
  initialData,
}: {
  machineId: string;
  initialData: RemoteData;
}) {
  const router = useRouter();
  const [data, setData] = useState<RemoteData | null>(initialData);
  const [sending, setSending] = useState<RemoteCommandType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/machines/${machineId}/remote-commands`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      setData(await response.json());
    } catch {
      // Abaikan error fetch jika server mati sementara
    }
  }, [machineId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [load]);

  const active = useMemo(
    () =>
      data?.commands.find((item) =>
        ["QUEUED", "DISPATCHED"].includes(item.status),
      ),
    [data],
  );
  const latestState = useMemo(
    () =>
      data?.commands.find(
        (item) => item.status === "SUCCEEDED" && item.result,
      )?.result ?? null,
    [data],
  );

  async function send(command: RemoteCommandType) {
    if (
      DANGEROUS_REMOTE_COMMANDS.has(command) &&
      !window.confirm(
        `Kirim perintah "${remoteCommandLabels[command]}" ke perangkat RVM?`,
      )
    ) {
      return;
    }
    setSending(command);
    setError(null);
    try {
      const response = await fetch(
        `/api/machines/${machineId}/remote-commands`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        setError(body?.error ?? "Gagal mengirim perintah");
        return;
      }
      await load();
      if (command === "CAPTURE_SNAPSHOT") {
        window.setTimeout(() => router.refresh(), 4000);
      }
    } finally {
      setSending(null);
    }
  }

  const runtimeState = String(latestState?.runtimeState ?? "-");
  const sensors =
    latestState?.sensors && typeof latestState.sensors === "object"
      ? (latestState.sensors as Record<string, unknown>)
      : null;
  const camera =
    latestState?.camera && typeof latestState.camera === "object"
      ? (latestState.camera as Record<string, unknown>)
      : null;

  return (
    <Card className="overflow-hidden border-emerald-200">
      <div className="border-b border-emerald-100 bg-emerald-950 px-4 py-3 text-white sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-emerald-300">
              Remote Console
            </p>
            <p className="mt-1 text-sm text-emerald-50/70">
              Kontrol aman melalui command queue HMAC.
            </p>
          </div>
          <span
            className={`rounded-full px-2 py-1 text-[10px] font-bold ${
              active
                ? "bg-amber-300 text-amber-950"
                : "bg-emerald-400/20 text-emerald-200"
            }`}
          >
            {active ? active.status : "SIAP"}
          </span>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </p>
        ) : null}

        <div className="grid grid-cols-2 gap-2 text-xs">
          <State label="Runtime" value={runtimeState} />
          <State
            label="Kamera"
            value={camera?.online === true ? "Online" : "-"}
          />
          <State
            label="Gate"
            value={latestState?.activeSession ? "Sesi aktif" : "Tidak aktif"}
          />
          <State
            label="Isi"
            value={
              sensors?.fill_percent != null
                ? `${String(sensors.fill_percent)}%`
                : `${data?.machine.fillLevelPercent ?? 0}%`
            }
          />
        </div>

        <CommandGroup
          label="Monitoring"
          commands={MONITORING}
          active={active?.command}
          sending={sending}
          onSend={send}
        />
        <CommandGroup
          label="Keselamatan & gate"
          commands={SAFETY}
          active={active?.command}
          sending={sending}
          onSend={send}
        />
        <CommandGroup
          label="Mode operasi"
          commands={MODE}
          active={active?.command}
          sending={sending}
          onSend={send}
        />

        <div className="border-t border-border pt-3">
          <p className="mb-2 text-xs font-semibold text-muted">
            Perintah terakhir
          </p>
          <div className="max-h-36 space-y-1 overflow-y-auto">
            {data?.commands.slice(0, 6).map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-soft px-2.5 py-2 text-xs"
              >
                <span className="truncate font-medium text-foreground">
                  {remoteCommandLabels[item.command]}
                </span>
                <span className="shrink-0 text-muted">{item.status}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

function State({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-soft px-3 py-2">
      <span className="block text-[10px] uppercase tracking-wide text-muted">
        {label}
      </span>
      <strong className="mt-0.5 block truncate text-foreground">{value}</strong>
    </div>
  );
}

function CommandGroup({
  label,
  commands,
  active,
  sending,
  onSend,
}: {
  label: string;
  commands: RemoteCommandType[];
  active?: RemoteCommandType;
  sending: RemoteCommandType | null;
  onSend: (command: RemoteCommandType) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold text-muted">{label}</p>
      <div className="flex flex-wrap gap-2">
        {commands.map((command) => (
          <Button
            key={command}
            size="sm"
            variant={
              command === "STOP_ALL" || command === "ENTER_MAINTENANCE"
                ? "danger"
                : "outline"
            }
            disabled={Boolean(active || sending)}
            onClick={() => onSend(command)}
          >
            {sending === command
              ? "Mengirim..."
              : remoteCommandLabels[command]}
          </Button>
        ))}
      </div>
    </div>
  );
}
