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

type Viewer = "admin" | "pengepul" | "superadmin";

interface Option {
  id: string;
  name: string;
}

export interface PartnerRow {
  id: string;
  status: string;
  organizationName: string;
  collectorName: string;
  collectorEmail: string;
  collectorPhone: string | null;
  serviceRegions: string[];
  serviceNote: string | null;
}

const ACTION_LABELS: Record<string, string> = {
  accept: "Terima",
  decline: "Tolak",
  approve: "Setujui",
  reject: "Tolak",
  suspend: "Tangguhkan",
  reactivate: "Aktifkan",
  remove: "Hapus",
};

function actionsFor(viewer: Viewer, status: string): string[] {
  if (viewer === "admin") {
    switch (status) {
      case "REQUESTED":
        return ["accept", "decline"];
      case "INVITED":
      case "PENDING_SUPERADMIN_APPROVAL":
        return ["remove"];
      case "ACTIVE":
        return ["suspend", "remove"];
      case "SUSPENDED":
        return ["reactivate", "remove"];
      default:
        return [];
    }
  }
  if (viewer === "superadmin") {
    switch (status) {
      case "PENDING_SUPERADMIN_APPROVAL":
        return ["approve", "reject"];
      case "ACTIVE":
        return ["suspend", "remove"];
      case "SUSPENDED":
        return ["reactivate", "remove"];
      default:
        return [];
    }
  }
  // pengepul
  if (status === "INVITED") return ["accept", "decline"];
  return [];
}

export function PartnershipPanel({
  viewer,
  partnerships,
  organizations,
}: {
  viewer: Viewer;
  partnerships: PartnerRow[];
  organizations?: Option[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [areaEditId, setAreaEditId] = useState<string | null>(null);

  // Create form (admin invite by email / pengepul request org).
  const [email, setEmail] = useState("");
  const [orgId, setOrgId] = useState(organizations?.[0]?.id ?? "");
  const [notes, setNotes] = useState("");

  // Area editor.
  const [regions, setRegions] = useState("");
  const [note, setNote] = useState("");

  async function act(id: string, action: string) {
    if (action === "remove" && !window.confirm("Hapus kemitraan ini?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/partnerships/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal memproses aksi");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body =
        viewer === "admin"
          ? { collectorEmail: email, notes: notes || undefined }
          : { organizationId: orgId, notes: notes || undefined };
      const res = await fetch("/api/partnerships", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? "Gagal membuat kemitraan");
        return;
      }
      setEmail("");
      setNotes("");
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function saveArea(id: string) {
    setBusy(true);
    setError(null);
    try {
      const regionList = regions
        .split(/[\n,]/)
        .map((r) => r.trim())
        .filter(Boolean);
      const res = await fetch(`/api/partnerships/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_area",
          serviceArea: { regions: regionList, note: note || undefined },
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal menyimpan area");
        return;
      }
      setAreaEditId(null);
      setRegions("");
      setNote("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function startAreaEdit(row: PartnerRow) {
    setAreaEditId(row.id);
    setRegions(row.serviceRegions.join(", "));
    setNote(row.serviceNote ?? "");
  }

  const showCreate = viewer === "admin" || viewer === "pengepul";
  const createLabel = viewer === "admin" ? "Undang Pengepul" : "Ajukan Kemitraan";

  const columns: Column<PartnerRow>[] = [
    viewer === "pengepul"
      ? {
          key: "org",
          header: "Organisasi",
          render: (r) => <span className="font-medium">{r.organizationName}</span>,
        }
      : {
          key: "collector",
          header: "Pengepul",
          render: (r) => (
            <div>
              <p className="font-medium text-foreground">{r.collectorName}</p>
              <p className="text-xs text-muted">{r.collectorEmail}</p>
            </div>
          ),
        },
    ...(viewer === "superadmin"
      ? [
          {
            key: "org",
            header: "Organisasi",
            render: (r: PartnerRow) => r.organizationName,
          } as Column<PartnerRow>,
        ]
      : []),
    {
      key: "area",
      header: "Area layanan",
      render: (r) =>
        r.serviceRegions.length ? r.serviceRegions.join(", ") : <span className="text-muted-soft">-</span>,
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => {
        const acts = actionsFor(viewer, r.status);
        const canEditArea = viewer === "pengepul" && r.status === "ACTIVE";
        if (acts.length === 0 && !canEditArea) {
          return <span className="text-xs text-muted-soft">-</span>;
        }
        return (
          <div className="flex justify-end gap-1.5">
            {canEditArea ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => startAreaEdit(r)}>
                Atur area
              </Button>
            ) : null}
            {acts.map((a) => (
              <Button
                key={a}
                size="sm"
                variant={a === "remove" || a === "reject" || a === "decline" ? "ghost" : "outline"}
                disabled={busy}
                onClick={() => act(r.id, a)}
              >
                {ACTION_LABELS[a]}
              </Button>
            ))}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </div>
      ) : null}

      {showCreate ? (
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Kemitraan</h2>
          <Button variant={open ? "outline" : "primary"} onClick={() => setOpen((o) => !o)}>
            {open ? "Tutup" : <><Plus /> {createLabel}</>}
          </Button>
        </div>
      ) : null}

      {open && showCreate ? (
        <Card>
          <CardHeader>
            <CardTitle>{createLabel}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitCreate} className="space-y-4">
              {viewer === "admin" ? (
                <FormField label="Email pengepul" htmlFor="p-email" required hint="Pengepul harus sudah terdaftar">
                  <Input
                    id="p-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="pengepul@reloop.id"
                    required
                  />
                </FormField>
              ) : (
                <FormField label="Organisasi" htmlFor="p-org" required>
                  <Select id="p-org" value={orgId} onChange={(e) => setOrgId(e.target.value)}>
                    {organizations?.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </Select>
                </FormField>
              )}
              <FormField label="Catatan" htmlFor="p-notes">
                <Textarea
                  id="p-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Catatan kemitraan (opsional)"
                />
              </FormField>
              <Button type="submit" disabled={busy}>
                {busy ? "Mengirim..." : createLabel}
              </Button>
              <p className="text-xs text-muted">
                Kemitraan baru harus disetujui superadmin sebelum aktif.
              </p>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {areaEditId ? (
        <Card>
          <CardHeader>
            <CardTitle>Atur Area Layanan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <FormField label="Wilayah" htmlFor="a-regions" hint="Pisahkan dengan koma">
                <Input
                  id="a-regions"
                  value={regions}
                  onChange={(e) => setRegions(e.target.value)}
                  placeholder="Pangandaran, Cijulang"
                />
              </FormField>
              <FormField label="Catatan area" htmlFor="a-note">
                <Input id="a-note" value={note} onChange={(e) => setNote(e.target.value)} />
              </FormField>
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => saveArea(areaEditId)}>
                  Simpan Area
                </Button>
                <Button variant="ghost" onClick={() => setAreaEditId(null)}>
                  Batal
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={partnerships}
        getRowKey={(r) => r.id}
        emptyTitle="Belum ada kemitraan"
        emptyDescription={
          viewer === "pengepul"
            ? "Ajukan kemitraan dengan organisasi untuk menerima tugas pickup."
            : "Undang pengepul untuk menjadi mitra organisasi Anda."
        }
      />
    </div>
  );
}
