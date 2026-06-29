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
  StatusBadge,
  Textarea,
  type Column,
} from "@/components/ui";
import { Plus } from "@/components/ui/icons";
import { formatDate } from "@/lib/format";

const TYPES = [
  ["MACHINE_DEPOSIT", "Setor Mesin"],
  ["TRASH_BAG", "Trash Bag / Trip"],
  ["EVENT", "Event"],
  ["SCHOOL_PROGRAM", "Program Sekolah"],
  ["TOURISM_PROGRAM", "Program Wisata"],
] as const;

const STATUSES = ["DRAFT", "ACTIVE", "PAUSED", "ENDED"] as const;

export interface CampaignRow {
  id: string;
  name: string;
  description: string | null;
  campaignType: string;
  visibility: string;
  allowedEmailDomains: string[];
  startAt: string | Date | null;
  endAt: string | Date | null;
  rewardMultiplier: number | null;
  status: string;
  sessionCount: number;
  organizationName: string | null;
}

function toDateInput(v: string | Date | null): string {
  if (!v) return "";
  const d = typeof v === "string" ? new Date(v) : v;
  return d.toISOString().slice(0, 10);
}

const EMPTY = {
  name: "",
  description: "",
  campaignType: "MACHINE_DEPOSIT",
  visibility: "PUBLIC",
  domains: "",
  startAt: "",
  endAt: "",
  rewardMultiplier: "",
  status: "DRAFT",
};

export function CampaignManager({
  campaigns,
  showOrganization,
}: {
  campaigns: CampaignRow[];
  showOrganization?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
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

  function startEdit(row: CampaignRow) {
    setForm({
      name: row.name,
      description: row.description ?? "",
      campaignType: row.campaignType,
      visibility: row.visibility,
      domains: row.allowedEmailDomains.join("\n"),
      startAt: toDateInput(row.startAt),
      endAt: toDateInput(row.endAt),
      rewardMultiplier: row.rewardMultiplier?.toString() ?? "",
      status: row.status,
    });
    setEditId(row.id);
    setError(null);
    setOpen(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const domains = form.domains
        .split(/[\n,]/)
        .map((d) => d.trim())
        .filter(Boolean);
      const payload: Record<string, unknown> = {
        name: form.name,
        description: form.description || null,
        campaignType: form.campaignType,
        visibility: form.visibility,
        allowedEmailDomains: form.visibility === "PRIVATE" ? domains : [],
        startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
        endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
        rewardMultiplier: form.rewardMultiplier ? Number(form.rewardMultiplier) : null,
        status: form.status,
      };
      const url = editId ? `/api/campaigns/${editId}` : "/api/campaigns";
      const res = await fetch(url, {
        method: editId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Gagal menyimpan campaign");
        return;
      }
      reset();
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: CampaignRow) {
    if (!window.confirm(`Hapus / akhiri campaign "${row.name}"?`)) return;
    setBusy(true);
    try {
      await fetch(`/api/campaigns/${row.id}`, { method: "DELETE" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<CampaignRow>[] = [
    {
      key: "name",
      header: "Campaign",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">{r.name}</p>
          <p className="text-xs text-muted">
            {TYPES.find(([v]) => v === r.campaignType)?.[1] ?? r.campaignType}
            {showOrganization && r.organizationName ? ` · ${r.organizationName}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "visibility",
      header: "Visibilitas",
      render: (r) =>
        r.visibility === "PRIVATE" ? (
          <div className="space-y-1">
            <Badge tone="warning">Private</Badge>
            {r.allowedEmailDomains.length ? (
              <p className="text-xs text-muted">{r.allowedEmailDomains.join(", ")}</p>
            ) : null}
          </div>
        ) : (
          <Badge tone="info">Public</Badge>
        ),
    },
    {
      key: "period",
      header: "Periode",
      render: (r) =>
        r.startAt || r.endAt ? `${formatDate(r.startAt)} → ${formatDate(r.endAt)}` : "-",
    },
    {
      key: "multiplier",
      header: "Multiplier",
      render: (r) => (r.rewardMultiplier ? `${r.rewardMultiplier}x` : "1x"),
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => startEdit(r)}>
            Edit
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(r)}>
            Hapus
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Daftar Campaign</h2>
        <Button variant={open ? "outline" : "primary"} onClick={() => (open ? reset() : startCreate())}>
          {open ? "Tutup form" : <><Plus /> Buat Campaign</>}
        </Button>
      </div>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>{editId ? "Edit Campaign" : "Campaign Baru"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-3.5 py-2.5 text-sm text-status-error">
                  {error}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Nama" htmlFor="c-name" required className="sm:col-span-2">
                  <Input
                    id="c-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Gerakan Bersih Pantai"
                    required
                  />
                </FormField>
                <FormField label="Tipe" htmlFor="c-type">
                  <Select
                    id="c-type"
                    value={form.campaignType}
                    onChange={(e) => setForm((f) => ({ ...f, campaignType: e.target.value }))}
                  >
                    {TYPES.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Visibilitas" htmlFor="c-vis">
                  <Select
                    id="c-vis"
                    value={form.visibility}
                    onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value }))}
                  >
                    <option value="PUBLIC">Public</option>
                    <option value="PRIVATE">Private (domain email)</option>
                  </Select>
                </FormField>
                {form.visibility === "PRIVATE" ? (
                  <FormField
                    label="Domain email diizinkan"
                    htmlFor="c-domains"
                    hint="Satu per baris, contoh @telkomuniversity.ac.id"
                    className="sm:col-span-2"
                  >
                    <Textarea
                      id="c-domains"
                      value={form.domains}
                      onChange={(e) => setForm((f) => ({ ...f, domains: e.target.value }))}
                      placeholder="@sekolah.sch.id"
                    />
                  </FormField>
                ) : null}
                <FormField label="Mulai" htmlFor="c-start">
                  <Input
                    id="c-start"
                    type="date"
                    value={form.startAt}
                    onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
                  />
                </FormField>
                <FormField label="Selesai" htmlFor="c-end">
                  <Input
                    id="c-end"
                    type="date"
                    value={form.endAt}
                    onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
                  />
                </FormField>
                <FormField label="Reward multiplier" htmlFor="c-mult" hint="1.2 = +20% reward">
                  <Input
                    id="c-mult"
                    type="number"
                    step="0.1"
                    value={form.rewardMultiplier}
                    onChange={(e) => setForm((f) => ({ ...f, rewardMultiplier: e.target.value }))}
                    placeholder="1.0"
                  />
                </FormField>
                <FormField label="Status" htmlFor="c-status">
                  <Select
                    id="c-status"
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <FormField label="Deskripsi" htmlFor="c-desc">
                <Textarea
                  id="c-desc"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Detail program campaign"
                />
              </FormField>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy}>
                  {busy ? "Menyimpan..." : editId ? "Simpan Perubahan" : "Buat Campaign"}
                </Button>
                <Button type="button" variant="ghost" onClick={reset}>
                  Batal
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={campaigns}
        getRowKey={(r) => r.id}
        emptyTitle="Belum ada campaign"
        emptyDescription="Buat campaign yang sesuai dengan kebutuhan organisasi Anda."
      />
    </div>
  );
}
