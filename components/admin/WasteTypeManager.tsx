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
  Textarea,
  type Column,
} from "@/components/ui";
import { Plus } from "@/components/ui/icons";

interface Option {
  id: string;
  name: string;
}

export interface WasteTypeRow {
  id: string;
  name: string;
  unit: string;
  minWeightGrams: number | null;
  maxWeightGrams: number | null;
  defaultRewardPerItem: number | null;
  description: string | null;
  active: boolean;
  organizationId: string | null;
  organizationName: string | null;
  depositItemCount: number;
}

const EMPTY = {
  name: "",
  unit: "ITEM",
  minWeightGrams: "",
  maxWeightGrams: "",
  defaultRewardPerItem: "",
  description: "",
  organizationId: "",
};

export function WasteTypeManager({
  wasteTypes,
  canManageGlobal,
  organizations,
}: {
  wasteTypes: WasteTypeRow[];
  canManageGlobal: boolean;
  organizations?: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setForm({ ...EMPTY });
    setEditId(null);
    setOpen(false);
    setError(null);
  }

  function startCreate() {
    setForm({ ...EMPTY });
    setEditId(null);
    setError(null);
    setOpen(true);
  }

  function startEdit(row: WasteTypeRow) {
    setForm({
      name: row.name,
      unit: row.unit,
      minWeightGrams: row.minWeightGrams?.toString() ?? "",
      maxWeightGrams: row.maxWeightGrams?.toString() ?? "",
      defaultRewardPerItem: row.defaultRewardPerItem?.toString() ?? "",
      description: row.description ?? "",
      organizationId: row.organizationId ?? "",
    });
    setEditId(row.id);
    setError(null);
    setOpen(true);
  }

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
        name: form.name,
        unit: form.unit,
        minWeightGrams: num(form.minWeightGrams),
        maxWeightGrams: num(form.maxWeightGrams),
        defaultRewardPerItem: num(form.defaultRewardPerItem),
        description: form.description || null,
      };
      if (!editId && canManageGlobal) {
        payload.organizationId = form.organizationId || null;
      }
      const url = editId ? `/api/waste-types/${editId}` : "/api/waste-types";
      const res = await fetch(url, {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Gagal menyimpan jenis sampah");
        return;
      }
      resetForm();
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(row: WasteTypeRow) {
    setBusy(true);
    try {
      await fetch(`/api/waste-types/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !row.active }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: WasteTypeRow) {
    if (!window.confirm(`Hapus / nonaktifkan jenis sampah "${row.name}"?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/waste-types/${row.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const canEditRow = (row: WasteTypeRow) =>
    canManageGlobal || row.organizationId != null;

  const columns: Column<WasteTypeRow>[] = [
    {
      key: "name",
      header: "Nama",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">{r.name}</p>
          {r.description ? (
            <p className="max-w-xs truncate text-xs text-muted">{r.description}</p>
          ) : null}
        </div>
      ),
    },
    { key: "unit", header: "Unit" },
    {
      key: "weight",
      header: "Threshold berat (g)",
      render: (r) =>
        r.minWeightGrams != null || r.maxWeightGrams != null
          ? `${r.minWeightGrams ?? "-"} – ${r.maxWeightGrams ?? "-"}`
          : "-",
    },
    {
      key: "reward",
      header: "Default reward",
      render: (r) => (r.defaultRewardPerItem != null ? `Rp${r.defaultRewardPerItem}` : "-"),
    },
    {
      key: "scope",
      header: "Scope",
      render: (r) =>
        r.organizationId ? (
          <Badge tone="brand">{r.organizationName ?? "Organisasi"}</Badge>
        ) : (
          <Badge tone="info">Global</Badge>
        ),
    },
    {
      key: "active",
      header: "Status",
      render: (r) =>
        r.active ? <Badge tone="success">Aktif</Badge> : <Badge tone="neutral">Nonaktif</Badge>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) =>
        canEditRow(r) ? (
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => startEdit(r)}>
              Edit
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => toggleActive(r)}>
              {r.active ? "Nonaktif" : "Aktif"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(r)}>
              Hapus
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted-soft">Kelola superadmin</span>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Jenis Sampah</h2>
        <Button variant={open ? "outline" : "primary"} onClick={() => (open ? resetForm() : startCreate())}>
          {open ? "Tutup form" : <><Plus /> Tambah Jenis</>}
        </Button>
      </div>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>{editId ? "Edit Jenis Sampah" : "Jenis Sampah Baru"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-3.5 py-2.5 text-sm text-status-error">
                  {error}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Nama" htmlFor="wt-name" required>
                  <Input
                    id="wt-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Botol Kaca"
                    required
                  />
                </FormField>
                <FormField label="Unit" htmlFor="wt-unit">
                  <Select
                    id="wt-unit"
                    value={form.unit}
                    onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                  >
                    <option value="ITEM">ITEM (per pcs)</option>
                    <option value="KG">KG (timbang)</option>
                  </Select>
                </FormField>
                <FormField label="Berat min (gram)" htmlFor="wt-min" hint="Kosong = tanpa batas">
                  <Input
                    id="wt-min"
                    type="number"
                    value={form.minWeightGrams}
                    onChange={(e) => setForm((f) => ({ ...f, minWeightGrams: e.target.value }))}
                    placeholder="5"
                  />
                </FormField>
                <FormField label="Berat max (gram)" htmlFor="wt-max" hint="Tolak botol berisi air">
                  <Input
                    id="wt-max"
                    type="number"
                    value={form.maxWeightGrams}
                    onChange={(e) => setForm((f) => ({ ...f, maxWeightGrams: e.target.value }))}
                    placeholder="80"
                  />
                </FormField>
                <FormField label="Default reward / item (Rp)" htmlFor="wt-reward">
                  <Input
                    id="wt-reward"
                    type="number"
                    value={form.defaultRewardPerItem}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, defaultRewardPerItem: e.target.value }))
                    }
                    placeholder="200"
                  />
                </FormField>
                {!editId && canManageGlobal && organizations ? (
                  <FormField label="Scope" htmlFor="wt-scope">
                    <Select
                      id="wt-scope"
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
              </div>
              <FormField label="Deskripsi" htmlFor="wt-desc">
                <Textarea
                  id="wt-desc"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Catatan jenis sampah"
                />
              </FormField>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Menyimpan..." : editId ? "Simpan Perubahan" : "Buat Jenis Sampah"}
                </Button>
                <Button type="button" variant="ghost" onClick={resetForm}>
                  Batal
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={wasteTypes}
        getRowKey={(r) => r.id}
        emptyTitle="Belum ada jenis sampah"
        emptyDescription="Tambahkan botol, kaleng, atau jenis lain dengan threshold berat."
      />
    </div>
  );
}
