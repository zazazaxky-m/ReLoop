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
  type Column,
} from "@/components/ui";
import { Plus } from "@/components/ui/icons";

interface Option {
  id: string;
  name: string;
}

export interface OrgRow {
  id: string;
  name: string;
  type: string;
  status: string;
  regionName: string | null;
  machineCount: number;
  userCount: number;
}

const TYPES = [
  "SCHOOL",
  "CAMPUS",
  "VILLAGE",
  "TOURISM_SITE",
  "OFFICE",
  "COMMUNITY",
  "WASTE_BANK",
  "OTHER",
] as const;

const STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"] as const;

export function OrganizationManager({
  organizations,
  regions,
}: {
  organizations: OrgRow[];
  regions: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: "OTHER",
    regionId: "",
    address: "",
    contactName: "",
    contactPhone: "",
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          type: form.type,
          regionId: form.regionId || undefined,
          address: form.address || undefined,
          contactName: form.contactName || undefined,
          contactPhone: form.contactPhone || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal membuat organisasi");
        return;
      }
      setForm({ name: "", type: "OTHER", regionId: "", address: "", contactName: "", contactPhone: "" });
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: string) {
    setBusy(true);
    try {
      await fetch(`/api/organizations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<OrgRow>[] = [
    {
      key: "name",
      header: "Organisasi",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">{r.name}</p>
          <p className="text-xs text-muted">
            {r.type}
            {r.regionName ? ` · ${r.regionName}` : ""}
          </p>
        </div>
      ),
    },
    { key: "machines", header: "Mesin", render: (r) => r.machineCount },
    { key: "users", header: "User", render: (r) => r.userCount },
    {
      key: "status",
      header: "Status",
      className: "w-[220px]",
      render: (r) => (
        <Select
          value={r.status}
          disabled={busy}
          onChange={(e) => setStatus(r.id, e.target.value)}
          compact
          className="min-w-[160px]"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </div>
      ) : null}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Organisasi</h2>
        <Button variant={open ? "outline" : "primary"} onClick={() => setOpen((o) => !o)}>
          {open ? "Tutup" : <><Plus /> Tambah</>}
        </Button>
      </div>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Organisasi Baru</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Nama" htmlFor="o-name" required>
                  <Input id="o-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                </FormField>
                <FormField label="Tipe" htmlFor="o-type">
                  <Select id="o-type" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
                    {TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Wilayah" htmlFor="o-region">
                  <Select id="o-region" value={form.regionId} onChange={(e) => setForm((f) => ({ ...f, regionId: e.target.value }))}>
                    <option value="">- Pilih wilayah -</option>
                    {regions.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Alamat" htmlFor="o-addr">
                  <Input id="o-addr" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                </FormField>
                <FormField label="Kontak" htmlFor="o-cname">
                  <Input id="o-cname" value={form.contactName} onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} />
                </FormField>
                <FormField label="Telepon" htmlFor="o-cphone">
                  <Input id="o-cphone" value={form.contactPhone} onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))} />
                </FormField>
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "Menyimpan..." : "Buat Organisasi"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <DataTable columns={columns} rows={organizations} getRowKey={(r) => r.id} emptyTitle="Belum ada organisasi" />
    </div>
  );
}
