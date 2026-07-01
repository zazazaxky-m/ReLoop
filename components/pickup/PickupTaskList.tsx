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
} from "@/components/ui";
import { MapPin, Truck } from "@/components/ui/icons";

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
}

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
  const [item, setItem] = useState({
    wasteTypeId: "",
    itemCount: "",
    actualWeightKg: "",
    notes: "",
  });

  async function act(id: string, action: string) {
    if (action === "fail" && !window.confirm("Tandai pickup ini gagal?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/pickups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal memproses tugas");
        return;
      }
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
      <EmptyState
        icon={Truck}
        title="Tidak ada tugas pickup"
        description="Tugas akan muncul saat admin organisasi mitra menugaskan Anda."
      />
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
                    onClick={() => act(t.id, a.action)}
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
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(t.id, "fail")}>
                    Gagal
                  </Button>
                ) : null}
              </div>

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
