"use client";

import { useState } from "react";
import { Card, CardContent, StatusBadge } from "@/components/ui";
import { MachineCaptureGallery } from "./MachineCaptureGallery";
import { SecurityEventList } from "@/components/security/SecurityEventList";
import { formatDateTime } from "@/lib/format";
import type { MachineCaptureRow } from "@/lib/machine-captures";
import type { SecurityEventRow } from "@/lib/security-events";

type Tab = "security" | "camera" | "sessions";

export function MachineActivityPanel({
  securityEvents = [],
  cameraCaptures = [],
  sessions,
}: {
  securityEvents?: SecurityEventRow[];
  cameraCaptures?: MachineCaptureRow[];
  sessions: {
    id: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
  }[];
}) {
  const [tab, setTab] = useState<Tab>(
    securityEvents.length ? "security" : cameraCaptures.length ? "camera" : "sessions",
  );

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "security", label: "Keamanan", count: securityEvents.length },
    { id: "camera", label: "Kamera", count: cameraCaptures.length },
    { id: "sessions", label: "Sesi", count: sessions.length },
  ];

  return (
    <Card>
      <div className="flex flex-col gap-3 border-b border-border bg-slate-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div>
          <h3 className="font-bold text-foreground">Aktivitas Mesin</h3>
          <p className="text-xs text-muted">
            Event keamanan, bukti kamera, dan sesi dalam satu panel.
          </p>
        </div>
        <div className="flex gap-1 rounded-xl border border-border bg-white p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                tab === item.id
                  ? "bg-emerald-700 text-white shadow-sm"
                  : "text-muted hover:bg-slate-100 hover:text-foreground"
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

        {tab === "camera" ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
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
