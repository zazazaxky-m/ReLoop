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
  Input,
  StatusBadge,
  type Column,
} from "@/components/ui";
import { formatDateTime, formatRupiah } from "@/lib/format";

export interface RedemptionAdminRow {
  id: string;
  userName: string;
  userEmail: string;
  amount: number;
  provider: string;
  accountIdentifier: string | null;
  accountName: string | null;
  status: string;
  note: string | null;
  createdAt: string | Date;
}

export function RedemptionQueue({ redemptions }: { redemptions: RedemptionAdminRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionKind, setActionKind] = useState<"success" | "fail" | null>(null);
  const [note, setNote] = useState("Sudah ditransfer");
  const [ref, setRef] = useState("");

  async function run(id: string, action: string, extra?: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/redemptions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal memproses redemption");
        return;
      }
      setActionId(null);
      setActionKind(null);
      setNote("Sudah ditransfer");
      setRef("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function openAction(id: string, kind: "success" | "fail") {
    setActionId(id);
    setActionKind(kind);
    setNote(kind === "success" ? "Sudah ditransfer" : "");
    setRef("");
  }

  const columns: Column<RedemptionAdminRow>[] = [
    {
      key: "user",
      header: "Pengguna",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">{r.userName}</p>
          <p className="text-xs text-muted">{r.userEmail}</p>
        </div>
      ),
    },
    {
      key: "amount",
      header: "Jumlah",
      render: (r) => <span className="font-medium">{formatRupiah(r.amount)}</span>,
    },
    {
      key: "dest",
      header: "Tujuan",
      render: (r) => (
        <div className="text-sm">
          <p>{r.provider}</p>
          <p className="text-xs text-muted">{r.accountIdentifier ?? "-"}</p>
        </div>
      ),
    },
    { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
    {
      key: "created",
      header: "Diajukan",
      render: (r) => <span className="text-xs text-muted">{formatDateTime(r.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => {
        const isQueue = ["REQUESTED", "APPROVED", "PROCESSING"].includes(r.status);
        if (!isQueue) return r.note ? <span className="text-xs text-muted">{r.note}</span> : null;
        return (
          <div className="flex justify-end gap-1.5">
            {r.status === "REQUESTED" ? (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(r.id, "approve")}>
                Setujui
              </Button>
            ) : null}
            <Button size="sm" variant="primary" disabled={busy} onClick={() => openAction(r.id, "success")}>
              Tandai Transfer
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => openAction(r.id, "fail")}>
              Gagal
            </Button>
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

      {actionId && actionKind ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {actionKind === "success" ? "Konfirmasi Pembayaran" : "Tandai Gagal"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-foreground">Catatan status</label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={actionKind === "success" ? "Sudah ditransfer" : "Alasan gagal"}
                  className="mt-1.5"
                />
              </div>
              {actionKind === "success" ? (
                <div>
                  <label className="text-sm font-medium text-foreground">Referensi (opsional)</label>
                  <Input
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    placeholder="No. referensi transfer"
                    className="mt-1.5"
                  />
                </div>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                disabled={busy}
                onClick={() =>
                  run(actionId, actionKind, {
                    note: note || undefined,
                    providerReference: ref || undefined,
                  })
                }
              >
                {actionKind === "success" ? "Konfirmasi Sudah Transfer" : "Tandai Gagal"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setActionId(null);
                  setActionKind(null);
                }}
              >
                Batal
              </Button>
            </div>
            <p className="text-xs text-muted">
              Tambahkan catatan atau referensi transaksi untuk memudahkan pelacakan.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={redemptions}
        getRowKey={(r) => r.id}
        emptyTitle="Tidak ada redemption"
        emptyDescription="Pengajuan pencairan pengguna akan muncul di sini."
      />
    </div>
  );
}
