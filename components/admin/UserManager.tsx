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

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  organizationId: string | null;
  organizationName: string | null;
}

const ROLES = ["SUPERADMIN", "ADMIN", "PENGEPUL", "USER"] as const;
const STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"] as const;

export function UserManager({
  users,
  organizations,
}: {
  users: UserRow[];
  organizations: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "USER",
    organizationId: "",
    phone: "",
  });

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          organizationId: form.organizationId || undefined,
          phone: form.phone || undefined,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal membuat pengguna");
        return;
      }
      setForm({ name: "", email: "", password: "", role: "USER", organizationId: "", phone: "" });
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal memperbarui");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<UserRow>[] = [
    {
      key: "user",
      header: "Pengguna",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">{r.name}</p>
          <p className="text-xs text-muted">{r.email}</p>
        </div>
      ),
    },
    {
      key: "role",
      header: "Peran",
      className: "w-[220px]",
      render: (r) => (
        <Select
          value={r.role}
          disabled={busy}
          onChange={(e) => patch(r.id, { role: e.target.value })}
          compact
          className="min-w-[170px]"
        >
          {ROLES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      ),
    },
    { key: "org", header: "Organisasi", render: (r) => r.organizationName ?? "-" },
    {
      key: "status",
      header: "Status",
      className: "w-[220px]",
      render: (r) => (
        <Select
          value={r.status}
          disabled={busy}
          onChange={(e) => patch(r.id, { status: e.target.value })}
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
        <h2 className="text-lg font-semibold text-foreground">Pengguna</h2>
        <Button variant={open ? "outline" : "primary"} onClick={() => setOpen((o) => !o)}>
          {open ? "Tutup" : <><Plus /> Tambah</>}
        </Button>
      </div>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Pengguna Baru</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={create} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Nama" htmlFor="u-name" required>
                  <Input id="u-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
                </FormField>
                <FormField label="Email" htmlFor="u-email" required>
                  <Input id="u-email" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required />
                </FormField>
                <FormField label="Password" htmlFor="u-pass" required hint="Min 6 karakter">
                  <Input id="u-pass" type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required />
                </FormField>
                <FormField label="Peran" htmlFor="u-role">
                  <Select id="u-role" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
                    {ROLES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Organisasi" htmlFor="u-org" hint="Wajib untuk ADMIN">
                  <Select id="u-org" value={form.organizationId} onChange={(e) => setForm((f) => ({ ...f, organizationId: e.target.value }))}>
                    <option value="">- Tidak ada -</option>
                    {organizations.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Telepon" htmlFor="u-phone">
                  <Input id="u-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                </FormField>
              </div>
              <Button type="submit" disabled={busy}>
                {busy ? "Menyimpan..." : "Buat Pengguna"}
              </Button>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <DataTable columns={columns} rows={users} getRowKey={(r) => r.id} emptyTitle="Belum ada pengguna" />
    </div>
  );
}
