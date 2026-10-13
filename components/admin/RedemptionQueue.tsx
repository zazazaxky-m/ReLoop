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
  /** REQUEST_SNAPSHOT, LEGACY_ACCOUNT_FALLBACK or LEGACY_UNAVAILABLE (lib/payout-destination.ts). */
  destinationSource?: string;
  /** False for a legacy request whose destination is shown from the current account. */
  destinationRecorded?: boolean;
  status: string;
  note: string | null;
  manualTransferProofUrl?: string | null;
  reconciliationRequired?: boolean;
  reconciliationNote?: string | null;
  createdAt: string | Date;
}

type ActionKind = "success" | "fail" | "flag_reconciliation";

const ACTION_TITLES: Record<ActionKind, string> = {
  success: "Konfirmasi Pembayaran",
  fail: "Tandai Gagal",
  flag_reconciliation: "Transfer Belum Pasti",
};

function destinationLabel(r: RedemptionAdminRow): string | null {
  if (r.destinationSource === "LEGACY_UNAVAILABLE") return "Tujuan lama tidak tersedia";
  if (r.destinationSource === "LEGACY_ACCOUNT_FALLBACK") {
    return r.destinationRecorded ? "Data lama: akun saat diproses" : "Data lama: akun saat ini";
  }
  return null;
}

export function RedemptionQueue({ redemptions }: { redemptions: RedemptionAdminRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionKind, setActionKind] = useState<ActionKind | null>(null);
  const [note, setNote] = useState("Sudah ditransfer");
  const [ref, setRef] = useState("");
  const [proofFile, setProofFile] = useState<File | null>(null);

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
      setProofFile(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function runSuccess(id: string) {
    setBusy(true);
    setError(null);
    try {
      if (proofFile) {
        const form = new FormData();
        form.append("file", proofFile);
        const uploadRes = await fetch(`/api/redemptions/${id}/proof`, {
          method: "POST",
          body: form,
        });
        if (!uploadRes.ok) {
          const d = await uploadRes.json().catch(() => ({}));
          setError(d?.error ?? "Gagal mengunggah bukti transfer");
          return;
        }
      }
      await run(id, "success", {
        note: note || undefined,
        providerReference: ref || undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  function openAction(id: string, kind: ActionKind) {
    setActionId(id);
    setActionKind(kind);
    setNote(kind === "success" ? "Sudah ditransfer" : "");
    setRef("");
    setProofFile(null);
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
          <p className="text-xs text-muted">
            {r.accountIdentifier ?? "-"}
            {r.accountName ? ` · ${r.accountName}` : ""}
          </p>
          {destinationLabel(r) ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">{destinationLabel(r)}</p>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={r.status} />
          {r.reconciliationRequired ? (
            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400" title={r.reconciliationNote ?? undefined}>
              Perlu rekonsiliasi
            </span>
          ) : null}
        </div>
      ),
    },
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
        if (!isQueue) {
          return (
            <div className="flex flex-col items-end gap-1">
              {r.note ? <span className="text-xs text-muted">{r.note}</span> : null}
              {r.manualTransferProofUrl ? (
                <a
                  href={`/api/redemptions/${r.id}/proof`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-brand-700 dark:text-brand-400 hover:underline"
                >
                  Lihat bukti
                </a>
              ) : null}
            </div>
          );
        }
        return (
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex justify-end gap-1.5">
              {r.status === "REQUESTED" ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(r.id, "approve")}>
                  Setujui
                </Button>
              ) : null}
              {r.status === "APPROVED" ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(r.id, "process")}>
                  Proses
                </Button>
              ) : null}
              {r.status === "PROCESSING" ? (
                <Button size="sm" variant="primary" disabled={busy} onClick={() => openAction(r.id, "success")}>
                  Tandai Transfer
                </Button>
              ) : null}
              {r.status === "PROCESSING" && !r.reconciliationRequired ? (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => openAction(r.id, "flag_reconciliation")}>
                  Belum Pasti
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => openAction(r.id, "fail")}>
                Gagal
              </Button>
            </div>
            {r.manualTransferProofUrl ? (
              <a
                href={`/api/redemptions/${r.id}/proof`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-semibold text-brand-700 dark:text-brand-400 hover:underline"
              >
                Lihat bukti
              </a>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </div>
      ) : null}

      {actionId && actionKind ? (
        <Card>
          <CardHeader>
            <CardTitle>{ACTION_TITLES[actionKind]}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-foreground">Catatan status</label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    actionKind === "success"
                      ? "Sudah ditransfer"
                      : actionKind === "fail"
                        ? "Alasan gagal"
                        : "Contoh: mutasi bank belum muncul"
                  }
                  className="mt-1.5"
                />
              </div>
              {actionKind === "success" ? (
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Referensi transfer{proofFile ? " (opsional)" : " (wajib jika tanpa bukti)"}
                  </label>
                  <Input
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    placeholder="No. referensi transfer"
                    className="mt-1.5"
                  />
                </div>
              ) : null}
            </div>
            {actionKind === "success" ? (
              <div>
                <label className="text-sm font-medium text-foreground">
                  Bukti transfer (JPG/PNG/WebP, maks 6MB)
                  {ref ? " (opsional jika sudah isi referensi)" : ""}
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => setProofFile(e.target.files?.[0] ?? null)}
                  className="mt-1.5 block w-full text-sm text-muted"
                />
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button
                disabled={busy}
                onClick={() =>
                  actionKind === "success"
                    ? runSuccess(actionId)
                    : run(actionId, actionKind, {
                        note: note || undefined,
                        providerReference: ref || undefined,
                      })
                }
              >
                {actionKind === "success"
                  ? "Konfirmasi Sudah Transfer"
                  : actionKind === "fail"
                    ? "Tandai Gagal"
                    : "Tahan untuk Rekonsiliasi"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setActionId(null);
                  setActionKind(null);
                  setProofFile(null);
                }}
              >
                Batal
              </Button>
            </div>
            <p className="text-xs text-muted">
              {actionKind === "flag_reconciliation"
                ? "Pengajuan tetap diproses dan saldo pengguna tetap ditahan sampai hasil transfer dipastikan."
                : "Tambahkan catatan atau referensi transaksi untuk memudahkan pelacakan."}
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
