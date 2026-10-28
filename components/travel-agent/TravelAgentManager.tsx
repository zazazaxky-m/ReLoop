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
  /** A03: members linked to the agent, and those verified from the invited mailbox. */
  memberCount: number;
  verifiedMemberCount: number;
  /** Latest invitation for this organization (null: none issued). */
  inviteState: "NOT_SENT" | "SENT" | "EXPIRED" | "ACCEPTED" | null;
}

const INVITE_STATE_LABEL: Record<NonNullable<TravelAgentRow["inviteState"]>, string> = {
  NOT_SENT: "Undangan belum terkirim",
  SENT: "Undangan terkirim, menunggu diterima",
  EXPIRED: "Undangan kedaluwarsa",
  ACCEPTED: "Undangan diterima",
};

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
        data.organizationStatus === "INVITED"
          ? "Undangan baru dikirim ke email travel agent. Anggota yang sudah terverifikasi tetap punya akses."
          : "Undangan dikirim ke email travel agent. Status PENDING sampai undangan diterima dari email tersebut.",
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
      key: "verification",
      header: "Verifikasi",
      render: (r) => (
        <div>
          <p className="font-semibold text-foreground">
            {r.verifiedMemberCount}/{r.memberCount} anggota terverifikasi
          </p>
          <p className="text-xs text-muted">
            {r.inviteState ? INVITE_STATE_LABEL[r.inviteState] : "Belum ada undangan"}
          </p>
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
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <div className="flex flex-wrap justify-end gap-2">
          {r.organizationStatus === "PENDING" || r.organizationStatus === "INVITED" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => resendInvite(r.id)}
            >
              Kirim ulang undangan
            </Button>
          ) : null}
          {r.organizationStatus === "INVITED" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => updateStatus(r.id, "SUSPENDED")}
            >
              Suspend
            </Button>
          ) : null}
          {r.organizationStatus === "SUSPENDED" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => updateStatus(r.id, "INVITED")}
            >
              Aktifkan
            </Button>
          ) : null}
          {r.organizationStatus !== "REMOVED" ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => updateStatus(r.id, "REMOVED")}
            >
              Hapus
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  async function resendInvite(travelAgentId: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/travel-agents/${travelAgentId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Gagal mengirim ulang undangan");
        return;
      }
      setSuccess("Undangan dikirim ulang. Tautan lama tidak berlaku lagi.");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(
    travelAgentId: string,
    organizationStatus: "INVITED" | "SUSPENDED" | "REMOVED",
  ) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/travel-agents/${travelAgentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "Gagal mengubah status travel agent");
        return;
      }
      setSuccess(
        organizationStatus === "SUSPENDED"
          ? "Travel agent ditangguhkan. Tidak bisa dipakai di trip baru."
          : organizationStatus === "REMOVED"
            ? "Travel agent dihapus dari organisasi."
            : "Travel agent diaktifkan kembali.",
      );
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">Travel Agent</h2>
        <Button variant={open ? "outline" : "primary"} onClick={() => setOpen((o) => !o)}>
          {open ? "Tutup" : <><Plus /> Tambah Agent</>}
        </Button>
      </div>

      {!open && (error || success) ? (
        <div
          role={error ? "alert" : "status"}
          className={
            error
              ? "rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error dark:border-red-900/30 dark:bg-red-950/20"
              : "rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-foreground"
          }
        >
          {error ?? success}
        </div>
      ) : null}

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Tambah Travel Agent</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error dark:border-red-900/30 dark:bg-red-950/20">
                  {error}
                </div>
              ) : null}
              {success ? (
                <div className="rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-2.5 text-sm text-foreground">
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
                  hint="Undangan dikirim ke email ini. Akses trip baru aktif setelah undangan diterima dari email tersebut."
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
