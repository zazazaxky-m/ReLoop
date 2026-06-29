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

export interface RegionRow {
  id: string;
  type: string;
  name: string;
  parentName: string | null;
  childCount: number;
  orgCount: number;
}

const TYPES = ["PROVINCE", "REGENCY", "DISTRICT", "VILLAGE"] as const;

export function RegionManager({
  regions,
}: {
  regions: RegionRow[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ type: "VILLAGE", name: "", parentId: "" });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/regions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: form.type,
          name: form.name,
          parentId: form.parentId || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal membuat wilayah");
        return;
      }
      setForm({ type: "VILLAGE", name: "", parentId: "" });
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<RegionRow>[] = [
    {
      key: "name",
      header: "Wilayah",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">{r.name}</p>
          {r.parentName ? <p className="text-xs text-muted">↳ {r.parentName}</p> : null}
        </div>
      ),
    },
    { key: "type", header: "Tipe", render: (r) => <Badge tone="info">{r.type}</Badge> },
    { key: "children", header: "Sub-wilayah", render: (r) => r.childCount },
    { key: "orgs", header: "Organisasi", render: (r) => r.orgCount },
  ];

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Wilayah</h2>
        <Button variant={open ? "outline" : "primary"} onClick={() => setOpen((o) => !o)}>
          {open ? "Tutup" : <><Plus /> Tambah</>}
        </Button>
      </div>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Wilayah Baru</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Tipe" htmlFor="rg-type">
                  <Select id="rg-type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Nama" htmlFor="rg-name" required>
                  <Input id="rg-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                </FormField>
                <FormField label="Induk" htmlFor="rg-parent" hint="Kosong untuk provinsi">
                  <Select id="rg-parent" value={form.parentId} onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}>
                    <option value="">- Tidak ada -</option>
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.type})
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "Menyimpan..." : "Buat Wilayah"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <DataTable columns={columns} rows={regions} getRowKey={(r) => r.id} emptyTitle="Belum ada wilayah" />
    </div>
  );
}
