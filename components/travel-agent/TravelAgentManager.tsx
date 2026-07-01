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
  StatusBadge,
  Textarea,
  type Column,
} from "@/components/ui";
import { Plus } from "@/components/ui/icons";

export interface TravelAgentRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  contactPerson: string | null;
  status: string;
  organizationStatus: string;
  tripCount: number;
  compliantCount: number;
  nonCompliantCount: number;
}

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  contactPerson: "",
  notes: "",
};

export function TravelAgentManager({ agents }: { agents: TravelAgentRow[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/travel-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          phone: form.phone || undefined,
          contactPerson: form.contactPerson || undefined,
          notes: form.notes || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Gagal mengundang travel agent");
        return;
      }
      setSuccess(
        data.invite?.status === "INVITED"
          ? "Travel agent sudah punya akun. Status otomatis menjadi INVITED."
          : "Travel agent tersimpan sebagai PENDING sampai email tersebut membuat akun.",
      );
      setForm({ ...EMPTY });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<TravelAgentRow>[] = [
    {
      key: "agent",
      header: "Travel Agent",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">{r.name}</p>
          <p className="text-xs text-muted">
            {r.email}
            {r.contactPerson ? ` - ${r.contactPerson}` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div>
          <StatusBadge status={r.organizationStatus} />
        </div>
      ),
    },
    {
      key: "compliance",
      header: "Compliance",
      render: (r) => {
        const rate = r.tripCount ? Math.round((r.compliantCount / r.tripCount) * 100) : 0;
        return (
          <div>
            <p className="font-semibold text-foreground">{rate}%</p>
            <p className="text-xs text-muted">
              {r.compliantCount} patuh / {r.nonCompliantCount} tidak patuh
            </p>
          </div>
        );
      },
    },
    { key: "trips", header: "Trip", render: (r) => `${r.tripCount}` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Travel Agent</h2>
        <Button variant={open ? "outline" : "primary"} onClick={() => setOpen((o) => !o)}>
          {open ? "Tutup" : <><Plus /> Tambah Agent</>}
        </Button>
      </div>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Tambah Travel Agent</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error">
                  {error}
                </div>
              ) : null}
              {success ? (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
                  {success}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Nama travel agent" htmlFor="ta-name" required>
                  <Input
                    id="ta-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    required
                  />
                </FormField>
                <FormField
                  label="Email travel agent"
                  htmlFor="ta-email"
                  required
                  hint="Jika email belum punya akun, status menjadi pending."
                >
                  <Input
                    id="ta-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    required
                  />
                </FormField>
                <FormField label="Kontak person" htmlFor="ta-contact">
                  <Input
                    id="ta-contact"
                    value={form.contactPerson}
                    onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))}
                  />
                </FormField>
                <FormField label="Nomor HP" htmlFor="ta-phone">
                  <Input
                    id="ta-phone"
                    value={form.phone}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  />
                </FormField>
              </div>
              <FormField label="Catatan" htmlFor="ta-notes">
                <Textarea
                  id="ta-notes"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </FormField>
              <Button type="submit" disabled={busy}>
                {busy ? "Menyimpan..." : "Simpan Travel Agent"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={agents}
        getRowKey={(r) => r.id}
        emptyTitle="Belum ada travel agent"
        emptyDescription="Invite travel agent agar bisa dipakai saat membuat trip wisata."
      />
    </div>
  );
}
