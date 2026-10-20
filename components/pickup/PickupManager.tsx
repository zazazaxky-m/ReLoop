"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  FormField,
  Input,
  Select,
  StatusBadge,
  Textarea,
  type Column,
} from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import { formatDateTime } from "@/lib/format";
import type { PickupDispatchView } from "@/lib/pickup";

interface Option {
  id: string;
  name: string;
}

export interface PickupRow {
  id: string;
  machineName: string | null;
  machineCode: string | null;
  organizationName: string;
  status: string;
  reason: string;
  priority: number;
  assignedCollectorName: string | null;
  itemCount: number;
  /** B05: compare-and-set version the operator's next decision carries. */
  version: number;
  assignedAt: string | null;
  expectedStartAt: string | null;
  closedReason: string | null;
  dispatch: PickupDispatchView;
}

/** Statuses an admin may still cancel (loaded material is completed or failed by the collector). */
const CANCELLABLE = ["REQUESTED", "ASSIGNED", "ON_THE_WAY", "ARRIVED"];

/** datetime-local value (browser time zone) -> ISO-8601, or undefined when empty. */
function deadlineIso(local: string): string | undefined {
  if (!local) return undefined;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

const REASONS = [
  ["MANUAL", "Manual"],
  ["FULL", "Penuh"],
  ["SCHEDULED", "Terjadwal"],
  ["ERROR", "Error"],
] as const;

export function PickupManager({
  pickups,
  machines,
  activePartners,
}: {
  pickups: PickupRow[];
  machines: Option[];
  activePartners: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [assignCollector, setAssignCollector] = useState(activePartners[0]?.id ?? "");
  const [assignDeadline, setAssignDeadline] = useState("");
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const rowOf = (id: string | null) => pickups.find((p) => p.id === id) ?? null;

  const [form, setForm] = useState({
    machineId: "",
    reason: "MANUAL",
    priority: "1",
    notes: "",
  });

  async function createPickup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pickups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machineId: form.machineId || undefined,
          reason: form.reason,
          priority: Number(form.priority),
          notes: form.notes || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal membuat pickup");
        return;
      }
      setForm((f) => ({ ...f, notes: "" }));
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function act(row: PickupRow, action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pickups/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // B05: every decision carries the version this page showed.
        body: JSON.stringify({ action, expectedVersion: row.version, ...extra }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal memproses pickup");
        // A newer version exists (another admin acted): show it.
        if (res.status === 409) router.refresh();
        return;
      }
      setAssignId(null);
      setCancelId(null);
      setCancelReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function createReplacement(row: PickupRow) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/pickups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replacesPickupId: row.id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal membuat tugas pengganti");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<PickupRow>[] = [
    {
      key: "machine",
      header: "Mesin / Lokasi",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">{r.machineName ?? "Pickup manual"}</p>
          <p className="text-xs text-muted">
            {r.machineCode ? `${r.machineCode} · ` : ""}
            {r.reason}
          </p>
        </div>
      ),
    },
    {
      key: "assigned",
      header: "Pengepul (PIC)",
      render: (r) =>
        r.assignedCollectorName ? (
          <div>
            <p className="font-medium text-foreground">{r.assignedCollectorName}</p>
            <p className="text-xs text-muted">Ditugaskan {formatDateTime(r.assignedAt)}</p>
          </div>
        ) : (
          <span className="text-muted-soft">Belum ditugaskan</span>
        ),
    },
    {
      key: "next",
      header: "Langkah berikutnya",
      render: (r) => (
        <div className="space-y-0.5">
          <p className={r.dispatch.overdue ? "font-medium text-status-error" : "text-foreground"}>
            {r.dispatch.nextLabel}
          </p>
          {r.dispatch.nextStatus && !r.dispatch.needsReplacement ? (
            <p className="text-xs text-muted">
              Status berikutnya: <StatusBadge status={r.dispatch.nextStatus} />
            </p>
          ) : null}
          {r.closedReason ? <p className="text-xs text-muted">Alasan: {r.closedReason}</p> : null}
        </div>
      ),
    },
    {
      key: "deadline",
      header: "Tenggat mulai",
      render: (r) =>
        r.expectedStartAt ? (
          <span className={r.dispatch.overdue ? "text-status-error" : undefined}>
            {formatDateTime(r.expectedStartAt)}
            {r.dispatch.overdue ? " (terlambat)" : ""}
          </span>
        ) : (
          <span className="text-muted-soft">Tanpa tenggat</span>
        ),
    },
    { key: "items", header: "Material", render: (r) => `${r.itemCount} catatan` },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => {
        const canAssign = ["REQUESTED", "ASSIGNED"].includes(r.status);
        const canCancel = CANCELLABLE.includes(r.status);
        const canReplace = r.dispatch.needsReplacement;
        if (!canAssign && !canCancel && !canReplace) return <span className="text-xs text-muted-soft">-</span>;
        return (
          <div className="flex justify-end gap-1.5">
            {canAssign ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || activePartners.length === 0}
                onClick={() => {
                  setAssignId(assignId === r.id ? null : r.id);
                  setCancelId(null);
                  setAssignCollector(activePartners[0]?.id ?? "");
                  setAssignDeadline("");
                }}
              >
                {r.status === "ASSIGNED" ? "Ganti" : "Tugaskan"}
              </Button>
            ) : null}
            {canCancel ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setCancelId(cancelId === r.id ? null : r.id);
                  setAssignId(null);
                  setCancelReason("");
                }}
              >
                Batal
              </Button>
            ) : null}
            {canReplace ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => createReplacement(r)}>
                Buat pengganti
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </div>
      ) : null}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Pickup Request</h2>
        <Button variant={open ? "outline" : "primary"} onClick={() => setOpen((o) => !o)}>
          {open ? "Tutup" : <><Plus /> Buat Pickup</>}
        </Button>
      </div>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Pickup Request Baru</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={createPickup} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Mesin" htmlFor="pk-machine" hint="Kosongkan untuk pickup manual">
                  <Select
                    id="pk-machine"
                    value={form.machineId}
                    onChange={(e) => setForm((f) => ({ ...f, machineId: e.target.value }))}
                  >
                    <option value="">- Pickup manual / tanpa mesin -</option>
                    {machines.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Alasan" htmlFor="pk-reason">
                  <Select
                    id="pk-reason"
                    value={form.reason}
                    onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                  >
                    {REASONS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Prioritas (0-5)" htmlFor="pk-priority">
                  <Input
                    id="pk-priority"
                    type="number"
                    min={0}
                    max={5}
                    value={form.priority}
                    onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}
                  />
                </FormField>
              </div>
              <FormField label="Catatan" htmlFor="pk-notes">
                <Textarea
                  id="pk-notes"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </FormField>
              <Button type="submit" disabled={busy}>
                {busy ? "Menyimpan..." : "Buat Pickup"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {assignId ? (
        <Card>
          <CardHeader>
            <CardTitle>Tugaskan Pengepul</CardTitle>
          </CardHeader>
          <CardContent>
            {activePartners.length === 0 ? (
              <p className="text-sm text-muted">
                Belum ada mitra pengepul aktif. Undang & tunggu approval superadmin dahulu.
              </p>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <FormField label="Pengepul mitra aktif" htmlFor="assign-collector" className="min-w-[220px]">
                  <Select
                    id="assign-collector"
                    value={assignCollector}
                    onChange={(e) => setAssignCollector(e.target.value)}
                  >
                    {activePartners.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField
                  label="Tenggat mulai (opsional)"
                  htmlFor="assign-deadline"
                  hint="Ditentukan admin; dipakai untuk peringatan terlambat"
                  className="min-w-[220px]"
                >
                  <Input
                    id="assign-deadline"
                    type="datetime-local"
                    value={assignDeadline}
                    onChange={(e) => setAssignDeadline(e.target.value)}
                  />
                </FormField>
                <Button
                  disabled={busy || !assignCollector || !rowOf(assignId)}
                  onClick={() => {
                    const target = rowOf(assignId);
                    if (target) {
                      act(target, "assign", {
                        collectorUserId: assignCollector,
                        expectedStartAt: deadlineIso(assignDeadline),
                      });
                    }
                  }}
                >
                  Tugaskan
                </Button>
                <Button variant="ghost" onClick={() => setAssignId(null)}>
                  Batal
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}

      {cancelId ? (
        <Card>
          <CardHeader>
            <CardTitle>Batalkan Pickup</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField
              label="Alasan pembatalan"
              htmlFor="cancel-reason"
              hint="Wajib; dicatat dan dikirim ke pengepul yang ditugaskan"
            >
              <Textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
              />
            </FormField>
            <div className="flex gap-2">
              <Button
                variant="danger"
                disabled={busy || cancelReason.trim().length < 3 || !rowOf(cancelId)}
                onClick={() => {
                  const target = rowOf(cancelId);
                  if (target) act(target, "cancel", { reason: cancelReason });
                }}
              >
                Batalkan Pickup
              </Button>
              <Button variant="ghost" onClick={() => setCancelId(null)}>
                Kembali
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={pickups}
        getRowKey={(r) => r.id}
        emptyTitle="Belum ada pickup"
        emptyDescription="Pickup otomatis dibuat saat mesin penuh, atau buat manual di sini."
      />
    </div>
  );
}
