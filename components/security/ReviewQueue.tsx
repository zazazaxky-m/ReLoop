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
  Input,
  Select,
  type Column,
} from "@/components/ui";
import { REVIEW_LEGACY_ROW } from "@/lib/deposit-review-contract";
import { formatDateTime, formatRupiah } from "@/lib/format";
import { UNKNOWN_WASTE_TYPE_NAME } from "@/lib/machine-events/shared";

/** Unknown-type items (by reason, or by the fallback type itself) need a real type to approve (M04). */
const needsReclassification = (row: { validationReasonCode: string | null; wasteType: { name: string } }) =>
  row.validationReasonCode === "UNKNOWN_WASTE_TYPE" || row.wasteType.name === UNKNOWN_WASTE_TYPE_NAME;

export interface ReviewQueueRow {
  id: string;
  quantity: number;
  measuredWeightGrams: number | null;
  aiDetectedType: string | null;
  aiConfidence: number | null;
  validationReasonCode: string | null;
  createdAt: string | Date;
  wasteType: { id: string; name: string; unit: string };
  pendingLedgerAmount: number;
  session: {
    user: { name: string; email: string };
    machine: { machineCode: string; name: string; organization: { name: string } };
  };
}

const reasonLabels: Record<string, string> = {
  UNKNOWN_WASTE_TYPE: "Jenis sampah tidak dikenali",
  REVERSE_MOTION: "Percobaan menarik kembali item",
  ABNORMAL_ITEM_WEIGHT: "Berat tidak wajar",
  IMPOSSIBLE_ACCEPTANCE_SEQUENCE: "Urutan sensor tidak valid",
  ANOMALY_REVIEW: "Anomali sesi",
};

function reasonLabel(code: string | null) {
  if (!code) return "Ditandai untuk peninjauan";
  return reasonLabels[code] ?? code.replaceAll("_", " ");
}

export function ReviewQueue({
  items,
  wasteTypes,
}: {
  items: ReviewQueueRow[];
  wasteTypes: { id: string; name: string; unit: string }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionKind, setActionKind] = useState<"approve" | "reject" | null>(null);
  const [wasteTypeId, setWasteTypeId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [note, setNote] = useState("");
  // Item the server refused as a legacy row (ended session, no usable acceptance
  // record): a superadmin may approve it explicitly as "setoran lama" (M04).
  const [legacyOfferId, setLegacyOfferId] = useState<string | null>(null);

  function openAction(row: ReviewQueueRow, kind: "approve" | "reject") {
    setActionId(row.id);
    setActionKind(kind);
    setWasteTypeId(needsReclassification(row) ? "" : row.wasteType.id);
    setQuantity(String(row.quantity));
    setNote("");
    setError(null);
    setLegacyOfferId(null);
  }

  function closeAction() {
    setActionId(null);
    setActionKind(null);
    setLegacyOfferId(null);
  }

  async function run(id: string, action: "approve" | "reject", legacy = false) {
    const row = items.find((i) => i.id === id);
    const isUnknown = row ? needsReclassification(row) : false;
    if (action === "approve" && isUnknown && !wasteTypeId) {
      setError("Pilih jenis sampah sebelum menyetujui item ini.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/deposit-reviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          wasteTypeId: action === "approve" && wasteTypeId ? wasteTypeId : undefined,
          quantity: action === "approve" && quantity ? Number(quantity) : undefined,
          note: note || undefined,
          legacy: action === "approve" && legacy ? true : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Gagal memproses peninjauan");
        if (action === "approve" && !legacy && d?.error === REVIEW_LEGACY_ROW) setLegacyOfferId(id);
        return;
      }
      const result = await res.json().catch(() => null);
      const reconciliationCase = result?.reconciliationCase as { amount?: number; reasonCode?: string } | null | undefined;
      if (reconciliationCase) {
        setNotice(
          reconciliationCase.reasonCode === "RECIPIENT_ERASED"
            ? "Keputusan tersimpan. Akun penerima sudah dihapus, jadi reward tidak dikreditkan dan kasus rekonsiliasi dibuka untuk tim keuangan."
            : `Keputusan tersimpan. Saldo dari setoran ini sudah dicairkan, jadi selisih Rp${(reconciliationCase.amount ?? 0).toLocaleString("id-ID")} tidak dipotong otomatis; kasus rekonsiliasi dibuka untuk tim keuangan.`,
        );
      }
      closeAction();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const columns: Column<ReviewQueueRow>[] = [
    {
      key: "item",
      header: "Item",
      render: (r) => (
        <div>
          <p className="font-medium text-foreground">
            {r.wasteType.name} · {r.quantity} {r.wasteType.unit === "KG" ? "kg" : "pcs"}
          </p>
          <p className="text-xs text-muted">
            {r.measuredWeightGrams != null ? `${r.measuredWeightGrams} gram` : "Berat tidak tercatat"}
            {r.aiDetectedType ? ` · AI: ${r.aiDetectedType} (${Math.round((r.aiConfidence ?? 0) * 100)}%)` : ""}
          </p>
        </div>
      ),
    },
    {
      key: "reason",
      header: "Alasan",
      render: (r) => (
        <Badge tone={r.validationReasonCode === "UNKNOWN_WASTE_TYPE" ? "info" : "warning"}>
          {reasonLabel(r.validationReasonCode)}
        </Badge>
      ),
    },
    {
      key: "source",
      header: "Mesin & Pengguna",
      render: (r) => (
        <div className="text-sm">
          <p>{r.session.machine.machineCode} · {r.session.machine.organization.name}</p>
          <p className="text-xs text-muted">{r.session.user.name} ({r.session.user.email})</p>
        </div>
      ),
    },
    {
      key: "pending",
      header: "Reward tertahan",
      render: (r) => <span className="font-medium">{formatRupiah(r.pendingLedgerAmount)}</span>,
    },
    {
      key: "created",
      header: "Dilaporkan",
      render: (r) => <span className="text-xs text-muted">{formatDateTime(r.createdAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      align: "right",
      render: (r) => (
        <div className="flex justify-end gap-1.5">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => openAction(r, "approve")}>
            Setujui
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => openAction(r, "reject")}>
            Tolak
          </Button>
        </div>
      ),
    },
  ];

  const activeRow = items.find((i) => i.id === actionId) ?? null;
  const needsWasteType = activeRow ? needsReclassification(activeRow) : false;

  return (
    <div className="space-y-4">
      {notice ? (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/30 dark:bg-amber-950/20 px-3.5 py-2.5 text-sm text-foreground">
          {notice}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:border-red-900/30 dark:bg-red-950/20 px-3.5 py-2.5 text-sm text-status-error">
          {error}
        </div>
      ) : null}

      {activeRow && actionKind ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {actionKind === "approve" ? "Setujui setoran" : "Tolak setoran"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              {actionKind === "approve" ? (
                <div>
                  <label className="text-sm font-medium text-foreground">
                    Jenis sampah{needsWasteType ? " *" : " (opsional, ubah bila perlu)"}
                  </label>
                  <Select
                    className="mt-1.5"
                    value={wasteTypeId}
                    onChange={(e) => setWasteTypeId(e.target.value)}
                  >
                    <option value="">
                      {needsWasteType ? "Pilih jenis sampah…" : `Tetap: ${activeRow.wasteType.name}`}
                    </option>
                    {wasteTypes.map((wt) => (
                      <option key={wt.id} value={wt.id}>
                        {wt.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              {actionKind === "approve" ? (
                <div>
                  <label className="text-sm font-medium text-foreground">Jumlah</label>
                  <Input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    className="mt-1.5"
                  />
                </div>
              ) : null}
              <div className={actionKind === "approve" ? "" : "sm:col-span-3"}>
                <label className="text-sm font-medium text-foreground">Catatan (opsional)</label>
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Catatan peninjauan"
                  className="mt-1.5"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => run(activeRow.id, actionKind)}>
                {actionKind === "approve" ? "Konfirmasi Setujui" : "Konfirmasi Tolak"}
              </Button>
              {actionKind === "approve" && legacyOfferId === activeRow.id ? (
                <Button variant="secondary" disabled={busy} onClick={() => run(activeRow.id, "approve", true)}>
                  Setujui sebagai setoran lama
                </Button>
              ) : null}
              <Button variant="ghost" onClick={closeAction}>
                Batal
              </Button>
            </div>
            {actionKind === "approve" && legacyOfferId === activeRow.id ? (
              <p className="text-xs text-muted">
                Setoran lama dihargai dengan tarif yang berlaku pada waktu setoran tercatat, dari berat yang tampil di atas,
                dan dicatat di log audit atas nama Anda.
              </p>
            ) : null}
            <p className="text-xs text-muted">
              Menyetujui menghitung ulang reward penuh dan mencairkan saldo tertahan.
              Menolak menandai item REJECTED dan membatalkan reward yang tertahan.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <DataTable
        columns={columns}
        rows={items}
        getRowKey={(r) => r.id}
        emptyTitle="Tidak ada setoran menunggu peninjauan"
        emptyDescription="Item dengan anomali sensor atau jenis sampah tak dikenali akan muncul di sini."
      />
    </div>
  );
}
