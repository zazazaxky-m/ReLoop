"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DataTable,
  FormField,
  Input,
  Select,
  type Column,
} from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import { formatDate, formatRupiah } from "@/lib/format";

interface Option {
  id: string;
  name: string;
}

export interface RateRow {
  id: string;
  wasteTypeName: string;
  pointsPerItem: number;
  unit: string;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  scopeLabel: string;
  active: boolean;
  effectiveFrom: string | Date;
  effectiveTo: string | Date | null;
}

export function RewardRateManager({
  rates,
  wasteTypes,
  canManageGlobal,
  organizations,
  campaigns,
}: {
  rates: RateRow[];
  wasteTypes: Option[];
  canManageGlobal: boolean;
  organizations?: Option[];
  campaigns?: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    wasteTypeId: wasteTypes[0]?.id ?? "",
    pointsPerItem: "",
    minWeightGrams: "",
    maxWeightGrams: "",
    organizationId: "",
    campaignId: "",
  });

  function num(v: string): number | null {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        wasteTypeId: form.wasteTypeId,
        pointsPerItem: num(form.pointsPerItem) ?? 0,
        minWeightGrams: num(form.minWeightGrams),
        maxWeightGrams: num(form.maxWeightGrams),
      };
      if (canManageGlobal) payload.organizationId = form.organizationId || null;
      if (form.campaignId) payload.campaignId = form.campaignId;

      const res = await fetch("/api/reward-rates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Gagal menyimpan tarif");
        return;
      }
      setOpen(false);
      setForm((f) => ({ ...f, pointsPerItem: "", minWeightGrams: "", maxWeightGrams: "" }));
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: RateRow) {
    setBusy(true);
    try {
      await fetch(`/api/reward-rates/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !row.active }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<RateRow>[] = [
    { key: "wasteTypeName", header: "Jenis sampah", render: (r) => r.wasteTypeName },
    {
      key: "points",
      header: "Reward / item",
      render: (r) => <span className="font-medium">{formatRupiah(r.pointsPerItem)}</span>,
    },
    {
      key: "weight",
      header: "Threshold (g)",
      render: (r) =>
        r.minWeightGrams != null || r.maxWeightGrams != null
          ? `${r.minWeightGrams ?? "-"} – ${r.maxWeightGrams ?? "-"}`
          : "-",
    },
    { key: "scope", header: "Scope", render: (r) => <Badge tone="brand">{r.scopeLabel}</Badge> },
    {
      key: "effective",
      header: "Berlaku",
      render: (r) =>
        `${formatDate(r.effectiveFrom)}${r.effectiveTo ? ` → ${formatDate(r.effectiveTo)}` : ""}`,
    },
    {
      key: "active",
      header: "Status",
      render: (r) =>
        r.active ? <Badge tone="success">Aktif</Badge> : <Badge tone="neutral">Berakhir</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) =>
        r.active ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggle(r)}>
            Nonaktifkan
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Tarif Reward</h2>
          <p className="text-xs text-muted">
            Tarif baru otomatis menggantikan versi aktif; histori transaksi tetap utuh.
          </p>
        </div>
        <Button
          variant={open ? "outline" : "primary"}
          disabled={wasteTypes.length === 0}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? "Tutup form" : <><Plus /> Tarif Baru</>}
        </Button>
      </div>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Tarif Reward Baru</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error">
                  {error}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Jenis sampah" htmlFor="rate-wt" required>
                  <Select
                    id="rate-wt"
                    value={form.wasteTypeId}
                    onChange={(e) => setForm((f) => ({ ...f, wasteTypeId: e.target.value }))}
                  >
                    {wasteTypes.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Reward per item (Rp)" htmlFor="rate-points" required>
                  <Input
                    id="rate-points"
                    type="number"
                    value={form.pointsPerItem}
                    onChange={(e) => setForm((f) => ({ ...f, pointsPerItem: e.target.value }))}
                    placeholder="200"
                    required
                  />
                </FormField>
                <FormField label="Berat min (g)" htmlFor="rate-min">
                  <Input
                    id="rate-min"
                    type="number"
                    value={form.minWeightGrams}
                    onChange={(e) => setForm((f) => ({ ...f, minWeightGrams: e.target.value }))}
                  />
                </FormField>
                <FormField label="Berat max (g)" htmlFor="rate-max">
                  <Input
                    id="rate-max"
                    type="number"
                    value={form.maxWeightGrams}
                    onChange={(e) => setForm((f) => ({ ...f, maxWeightGrams: e.target.value }))}
                  />
                </FormField>
                {canManageGlobal && organizations ? (
                  <FormField label="Scope" htmlFor="rate-scope">
                    <Select
                      id="rate-scope"
                      value={form.organizationId}
                      onChange={(e) => setForm((f) => ({ ...f, organizationId: e.target.value }))}
                    >
                      <option value="">Global (semua organisasi)</option>
                      {organizations.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                ) : null}
                {campaigns && campaigns.length > 0 ? (
                  <FormField label="Campaign (opsional)" htmlFor="rate-campaign" hint="Tarif khusus campaign">
                    <Select
                      id="rate-campaign"
                      value={form.campaignId}
                      onChange={(e) => setForm((f) => ({ ...f, campaignId: e.target.value }))}
                    >
                      <option value="">- Tidak ada -</option>
                      {campaigns.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                ) : null}
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Menyimpan..." : "Buat Tarif"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                  Batal
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={rates}
        getRowKey={(r) => r.id}
        emptyTitle="Belum ada tarif"
        emptyDescription="Buat tarif reward per item untuk jenis sampah."
      />
    </div>
  );
}
