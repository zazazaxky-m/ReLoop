import Link from "next/link";
import { AlertTriangle, ShieldCheck } from "@/components/ui/icons";
import { formatDateTime } from "@/lib/format";
import type { SecurityEventRow } from "@/lib/security-events";

const labels: Record<string, string> = {
  FRAUD_DETECTED: "Fraud terdeteksi",
  VANDALISM_DETECTED: "Vandalisme terdeteksi",
  SAFE_STATE_ENTERED: "Mesin masuk safe state",
};

function detail(payload: Record<string, unknown> | null) {
  if (!payload) return "Tidak ada detail tambahan";
  return String(
    payload.reason ??
      payload.reasonCode ??
      payload.description ??
      payload.sensor ??
      "Anomali sensor terdeteksi",
  );
}

export function SecurityEventList({
  events,
  compact = false,
}: {
  events: SecurityEventRow[];
  compact?: boolean;
}) {
  if (!events.length) {
    return (
      <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-6 text-center">
        <ShieldCheck className="mx-auto text-3xl text-brand-600" />
        <p className="mt-2 font-semibold text-brand-800">Tidak ada peringatan keamanan</p>
        <p className="mt-1 text-sm text-muted">Event fraud dan vandalisme akan muncul di sini.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-white">
      {events.map((event) => (
        <div key={event.id} className="flex gap-3 p-4">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
              event.eventType === "VANDALISM_DETECTED"
                ? "bg-red-50 text-red-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            <AlertTriangle />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-foreground">
                  {labels[event.eventType] ?? event.eventType}
                </p>
                <p className="text-sm text-muted">
                  {event.machine.machineCode} · {event.machine.name}
                  {!compact ? ` · ${event.machine.organization.name}` : ""}
                </p>
              </div>
              <p className="text-xs text-muted">{formatDateTime(event.occurredAt)}</p>
            </div>
            <p className="mt-2 text-sm text-slate-600">{detail(event.payload)}</p>
            {!compact ? (
              <Link
                href={`/dashboard/superadmin/machines/${event.machine.id}`}
                className="mt-2 inline-block text-xs font-semibold text-brand-700 hover:underline"
              >
                Buka detail mesin
              </Link>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
