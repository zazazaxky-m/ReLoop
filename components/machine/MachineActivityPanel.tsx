"use client";

import { useState } from "react";
import { Card, CardContent, StatusBadge } from "@/components/ui";
import { MachineCaptureGallery } from "./MachineCaptureGallery";
import { SecurityEventList } from "@/components/security/SecurityEventList";
import { formatDateTime } from "@/lib/format";
import type { MachineCaptureRow } from "@/lib/machine-captures";
import type { MachineSyncStatus } from "@/lib/machine-sync-status";
import type { SecurityEventRow } from "@/lib/security-events";

type Tab = "security" | "sync" | "camera" | "sessions";

export function MachineActivityPanel({
  securityEvents = [],
  cameraCaptures = [],
  syncStatus = null,
  sessions,
}: {
  securityEvents?: SecurityEventRow[];
  cameraCaptures?: MachineCaptureRow[];
  syncStatus?: MachineSyncStatus | null;
  sessions: {
    id: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
  }[];
}) {
  const deadLetter = syncStatus?.deadLetter ?? 0;
  const [tab, setTab] = useState<Tab>(
    securityEvents.length
      ? "security"
      : deadLetter
        ? "sync"
        : cameraCaptures.length
          ? "camera"
          : "sessions",
  );

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "security", label: "Keamanan", count: securityEvents.length },
    { id: "sync", label: "Sinkronisasi", count: deadLetter },
    { id: "camera", label: "Kamera", count: cameraCaptures.length },
    { id: "sessions", label: "Sesi", count: sessions.length },
  ];

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-border bg-surface-soft/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h3 className="font-bold text-foreground">Aktivitas Mesin</h3>
          <p className="text-xs text-muted">
            Event keamanan, sinkronisasi, bukti kamera, dan sesi dalam satu panel.
          </p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-border bg-background p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                tab === item.id
                  ? "bg-ink text-on-ink dark:bg-lime dark:text-ink"
                  : "text-muted hover:bg-surface hover:text-foreground"
              }`}
            >
              {item.label}
              <span className="ml-1.5 opacity-70">{item.count}</span>
            </button>
          ))}
        </div>
      </div>

      <CardContent className="max-h-[26rem] overflow-y-auto">
        {tab === "security" ? (
          <SecurityEventList events={securityEvents} compact />
        ) : null}

        {tab === "sync" ? <SyncStatusView status={syncStatus} /> : null}

        {tab === "camera" ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400 p-3 text-xs text-amber-900">
              Akses terbatas superadmin. Capture digunakan untuk audit, bukan
              mengenali identitas seseorang.
            </div>
            <MachineCaptureGallery captures={cameraCaptures} />
          </div>
        ) : null}

        {tab === "sessions" ? (
          sessions.length ? (
            <ul className="divide-y divide-border text-sm">
              {sessions.map((session) => (
                <li
                  key={session.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="font-medium text-foreground">
                      {formatDateTime(session.startedAt)}
                    </p>
                    <p className="text-xs text-muted">
                      {session.completedAt
                        ? `Selesai ${formatDateTime(session.completedAt)}`
                        : "Belum selesai"}
                    </p>
                  </div>
                  <StatusBadge status={session.status} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-sm text-muted">
              Belum ada sesi deposit.
            </p>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Edge outbox health as last reported by the machine (R02). */
function SyncStatusView({ status }: { status: MachineSyncStatus | null }) {
  if (!status) {
    return (
      <p className="py-8 text-center text-sm text-muted">
        Status sinkronisasi belum tersedia.
      </p>
    );
  }
  const events = (value: number | null) =>
    value == null ? "Belum dilaporkan" : `${value} event`;
  const rows: [string, string][] = [
    ["Menunggu dikirim mesin", events(status.pending)],
    ["Ditolak atau gagal berulang (tersimpan di mesin)", events(status.deadLetter)],
    ["Sinkron berhasil terakhir", formatDateTime(status.lastSuccessAt)],
    ["Event terakhir diterima server", formatDateTime(status.lastReceivedAt)],
    ["Dilaporkan mesin pada", formatDateTime(status.reportedAt)],
  ];
  return (
    <div className="space-y-3">
      {status.deadLetter ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-400">
          {status.deadLetter} event ditolak server atau gagal berulang dan
          disimpan di mesin tanpa diubah; event berikutnya dari sesi yang sama
          menunggu di belakangnya. Teknisi dapat meninjau dan mengirim ulang
          dari panel maintenance mesin (PIN).
        </div>
      ) : null}
      <dl className="divide-y divide-border text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-muted">{label}</dt>
            <dd className="text-right font-medium text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
