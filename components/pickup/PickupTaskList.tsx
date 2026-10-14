"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  FormField,
  Input,
  Select,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { MapPin, Truck } from "@/components/ui/icons";
import { formatDateTime } from "@/lib/format";
import type { PickupDispatchView } from "@/lib/pickup";

interface Option {
  id: string;
  name: string;
}

export interface TaskItem {
  id: string;
  wasteTypeName: string | null;
  itemCount: number | null;
  actualWeightKg: number | null;
  notes: string | null;
}

export interface TaskRow {
  id: string;
  machineName: string | null;
  machineCode: string | null;
  organizationName: string;
  contactName: string | null;
  contactPhone: string | null;
  address: string | null;
  status: string;
  reason: string;
  items: TaskItem[];
  /** B05: compare-and-set version every field step carries. */
  version: number;
  assignedAt: string | null;
  expectedStartAt: string | null;
  closedReason: string | null;
  dispatch: PickupDispatchView;
}

/** B05: shown while no task is assigned; tasks are dispatched by admins, never claimed. */
export const EMPTY_TASKS_TITLE = "Menunggu penugasan admin";
export const EMPTY_TASKS_DESCRIPTION =
  "Admin organisasi mitra menugaskan setiap pickup kepada satu pengepul. Tugas yang ditugaskan kepada Anda akan muncul di sini.";

const NEXT_ACTIONS: Record<string, { action: string; label: string; variant?: "primary" | "outline" }[]> = {
  ASSIGNED: [{ action: "start", label: "Berangkat" }],
  ON_THE_WAY: [{ action: "arrive", label: "Tiba di Lokasi" }],
  ARRIVED: [{ action: "collect", label: "Mulai Ambil" }],
  COLLECTED: [{ action: "complete", label: "Selesaikan", variant: "primary" }],
};

export function PickupTaskList({
  tasks,
  wasteTypes,
}: {
  tasks: TaskRow[];
  wasteTypes: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recordId, setRecordId] = useState<string | null>(null);
  const [failId, setFailId] = useState<string | null>(null);
  const [failReason, setFailReason] = useState("");
  const [item, setItem] = useState({
    wasteTypeId: "",
    itemCount: "",
    actualWeightKg: "",
    notes: "",
  });

  async function act(task: TaskRow, action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pickups/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // B05: every step carries the version this page showed.
        body: JSON.stringify({ action, expectedVersion: task.version, ...extra }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal memproses tugas");
        // The task changed (reassigned, cancelled, or another step): show the current state.
        if (res.status === 409 || res.status === 403) router.refresh();
        return;
      }
      setFailId(null);
      setFailReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function recordItem(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pickups/${id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wasteTypeId: item.wasteTypeId || null,
          itemCount: item.itemCount ? Number(item.itemCount) : null,
          actualWeightKg: item.actualWeightKg ? Number(item.actualWeightKg) : null,
          source: item.itemCount ? "MACHINE_COUNT" : "MANUAL_WEIGHING",
          notes: item.notes || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal mencatat material");
        return;
      }
      setItem({ wasteTypeId: "", itemCount: "", actualWeightKg: "", notes: "" });
      setRecordId(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (tasks.length === 0) {
    return (
      <EmptyState icon={Truck} title={EMPTY_TASKS_TITLE} description={EMPTY_TASKS_DESCRIPTION} />
    );
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </div>
      ) : null}

      {tasks.map((t) => {
        const actions = NEXT_ACTIONS[t.status] ?? [];
        const canRecord = ["ARRIVED", "COLLECTED"].includes(t.status);
        const canFail = ["ASSIGNED", "ON_THE_WAY", "ARRIVED", "COLLECTED"].includes(t.status);
        return (
          <Card key={t.id}>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t.machineName ?? t.organizationName}</CardTitle>
              <StatusBadge status={t.status} />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1 text-sm text-muted">
                <p className="flex items-center gap-2">
                  <MapPin className="text-brand-500" />
                  {t.organizationName}
                  {t.address ? ` · ${t.address}` : ""}
                </p>
                {t.machineCode ? <p>Kode mesin: {t.machineCode}</p> : null}
                {t.contactName || t.contactPhone ? (
                  <p>
                    Kontak: {t.contactName ?? "-"}
                    {t.contactPhone ? ` (${t.contactPhone})` : ""}
                  </p>
                ) : null}
                <p>Alasan: {t.reason}</p>
              </div>

              <div className="space-y-0.5 rounded-xl border border-border px-3 py-2 text-sm">
                <p className={t.dispatch.overdue ? "font-medium text-status-error" : "text-foreground"}>
                  Langkah berikutnya: {t.dispatch.nextLabel}
                </p>
                {t.assignedAt ? <p className="text-xs text-muted">Ditugaskan {formatDateTime(t.assignedAt)}</p> : null}
                <p className="text-xs text-muted">
                  Tenggat mulai:{" "}
                  {t.expectedStartAt ? formatDateTime(t.expectedStartAt) : "tidak ditentukan admin"}
                  {t.dispatch.overdue ? " (terlambat)" : ""}
                </p>
                {t.closedReason ? <p className="text-xs text-muted">Alasan penutupan: {t.closedReason}</p> : null}
              </div>

              {t.items.length > 0 ? (
                <div className="rounded-xl bg-mint/50 px-3 py-2 text-xs text-brand-800 dark:text-brand-400">
                  <p className="mb-1 font-semibold">Material tercatat</p>
                  <ul className="space-y-0.5">
                    {t.items.map((it) => (
                      <li key={it.id}>
                        {it.wasteTypeName ?? "Material"} ·{" "}
                        {it.itemCount != null ? `${it.itemCount} pcs` : ""}
                        {it.actualWeightKg != null ? ` ${it.actualWeightKg} kg` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {actions.map((a) => (
                  <Button
                    key={a.action}
                    size="sm"
                    variant={a.variant ?? "outline"}
                    disabled={busy}
                    onClick={() => act(t, a.action)}
                  >
                    {a.label}
                  </Button>
                ))}
                {canRecord ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setRecordId(recordId === t.id ? null : t.id)}
                  >
                    Catat Material
                  </Button>
                ) : null}
                {canFail ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setFailId(failId === t.id ? null : t.id);
                      setFailReason("");
                    }}
                  >
                    Gagal
                  </Button>
                ) : null}
              </div>

              {failId === t.id ? (
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <FormField
                    label="Alasan gagal"
                    htmlFor={`fail-${t.id}`}
                    hint="Wajib; dicatat dan dikirim ke admin agar tugas pengganti dibuat"
                  >
                    <Textarea
                      id={`fail-${t.id}`}
                      value={failReason}
                      onChange={(e) => setFailReason(e.target.value)}
                    />
                  </FormField>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy || failReason.trim().length < 3}
                      onClick={() => act(t, "fail", { reason: failReason })}
                    >
                      Tandai Gagal
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setFailId(null)}>
                      Batal
                    </Button>
                  </div>
                </div>
              ) : null}

              {recordId === t.id ? (
                <div className="space-y-3 rounded-xl border border-border p-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <FormField label="Jenis material" htmlFor={`wt-${t.id}`}>
                      <Select
                        id={`wt-${t.id}`}
                        value={item.wasteTypeId}
                        onChange={(e) => setItem((s) => ({ ...s, wasteTypeId: e.target.value }))}
                      >
                        <option value="">- Pilih -</option>
                        {wasteTypes.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label="Jumlah (pcs)" htmlFor={`ct-${t.id}`}>
                      <Input
                        id={`ct-${t.id}`}
                        type="number"
                        value={item.itemCount}
                        onChange={(e) => setItem((s) => ({ ...s, itemCount: e.target.value }))}
                      />
                    </FormField>
                    <FormField label="Berat aktual (kg)" htmlFor={`kg-${t.id}`}>
                      <Input
                        id={`kg-${t.id}`}
                        type="number"
                        step="0.1"
                        value={item.actualWeightKg}
                        onChange={(e) => setItem((s) => ({ ...s, actualWeightKg: e.target.value }))}
                      />
                    </FormField>
                    <FormField label="Catatan" htmlFor={`nt-${t.id}`}>
                      <Input
                        id={`nt-${t.id}`}
                        value={item.notes}
                        onChange={(e) => setItem((s) => ({ ...s, notes: e.target.value }))}
                      />
                    </FormField>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy} onClick={() => recordItem(t.id)}>
                      Simpan Material
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRecordId(null)}>
                      Batal
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
