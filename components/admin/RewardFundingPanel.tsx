"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormField,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { formatDateTime, formatRupiah } from "@/lib/format";

/**
 * Reward funding of one organization (superadmin): confirmed cash with its
 * evidence, held obligations and capacity, campaign budgets, the holds that
 * need an operator, and the recorded entries. Reads and writes
 * /api/organizations/[id]/funding; never moves real money.
 */

interface Option {
  id: string;
  name: string;
}

interface StaleHold {
  reservationId: string;
  businessKey: string;
  userId: string;
  sourceType: "SESSION" | "TRIP";
  sourceId: string;
  sourceStatus: string | null;
  ceilingRupiah: number;
  remainingRupiah: number;
  ageMinutes: number;
  reasons: string[];
  reconciliation: string;
}

interface FundingEntryRow {
  id: string;
  kind: "CONFIRMED_TOPUP" | "PAYOUT" | "CORRECTION";
  amount: number;
  reference: string;
  note: string | null;
  verifiedById: string | null;
  createdAt: string;
}

interface CampaignBudgetRow {
  id: string;
  name: string;
  status: string;
  rewardMode: string;
  rewardBudgetRupiah: number | null;
  heldRupiah: number;
  spentRupiah: number;
  maxRewardPerSessionRupiah: number | null;
}

interface FundingDetail {
  enforced: boolean;
  confirmedRupiah: number;
  heldRupiah: number;
  capacityRupiah: number;
  activeReservations: number;
  reservedRemainingRupiah: number;
  uncoveredRupiah: number;
  staleHolds: StaleHold[];
  programsWithoutBudget: { id: string; name: string }[];
  entries: FundingEntryRow[];
  campaigns: CampaignBudgetRow[];
  commits: { active: number; heldRupiah: number; paidRupiah: number; uncoveredRupiah: number; reviewPending: number };
}

const ENTRY_KINDS: Array<[FundingEntryRow["kind"], string]> = [
  ["CONFIRMED_TOPUP", "Dana masuk terkonfirmasi"],
  ["PAYOUT", "Pencairan pengguna"],
  ["CORRECTION", "Koreksi"],
];

const REASON_LABELS: Record<string, string> = {
  SOURCE_CLOSED_AWAITING_WATERMARK: "Sumber sudah berakhir, sisa masih ditahan",
  SOURCE_OPEN_TOO_LONG: "Sumber terbuka lebih dari 24 jam",
  CEILING_NOT_CONFIGURED: "Batas reward per sesi belum diisi",
  CAPACITY_SHORTFALL: "Reservasi melebihi dana terkonfirmasi",
  ADMITTED_WITHOUT_RESERVATION: "Diterima tanpa reservasi (program berubah setelah penerimaan)",
};

const EMPTY_FORM = { kind: "CONFIRMED_TOPUP", amount: "", reference: "", note: "" };

export function RewardFundingPanel({ organizations }: { organizations: Option[] }) {
  const router = useRouter();
  const [orgId, setOrgId] = useState(organizations[0]?.id ?? "");
  const [detail, setDetail] = useState<FundingDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [releaseReasons, setReleaseReasons] = useState<Record<string, string>>({});

  const load = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/organizations/${id}/funding`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Gagal memuat pendanaan reward");
        setDetail(null);
        return;
      }
      setDetail(data.funding as FundingDetail);
    } catch {
      setError("Tidak dapat terhubung ke server");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!orgId) return;
    // Deferred: the fetch (and its state updates) runs after the effect, not inside it.
    const handle = setTimeout(() => {
      void load(orgId);
    }, 0);
    return () => clearTimeout(handle);
  }, [orgId, load]);

  async function submitEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!orgId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/funding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: form.kind,
          amount: Number(form.amount),
          reference: form.reference,
          note: form.note,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Gagal mencatat pendanaan");
        return;
      }
      setNotice(
        data.idempotent
          ? "Referensi ini sudah pernah dicatat dengan nominal yang sama; tidak ada entri baru."
          : "Pendanaan dicatat. Dana terkonfirmasi diperbarui.",
      );
      setForm({ ...EMPTY_FORM });
      await load(orgId);
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  async function releaseHold(reservationId: string) {
    if (!orgId) return;
    const reason = (releaseReasons[reservationId] ?? "").trim();
    if (reason.length < 3) {
      setError("Isi alasan pelepasan sisa dana terlebih dahulu.");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/organizations/${orgId}/funding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "release_reservation", reservationId, reason }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? "Gagal melepas sisa dana");
        return;
      }
      setNotice(`Sisa dana ${formatRupiah(data.released ?? 0)} dilepas dan dicatat di audit.`);
      await load(orgId);
      router.refresh();
    } catch {
      setError("Tidak dapat terhubung ke server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Pendanaan reward</CardTitle>
          <div className="flex items-center gap-2">
            {detail ? (
              <Badge tone={detail.enforced ? "success" : "warning"}>
                {detail.enforced ? "Penegakan dana aktif" : "Mode bayangan (tidak menolak setoran)"}
              </Badge>
            ) : null}
            <Select value={orgId} onChange={(e) => setOrgId(e.target.value)} aria-label="Organisasi">
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted">
          Dana terkonfirmasi adalah kas yang sudah dikonfirmasi operator dengan bukti; kewajiban ditahan adalah
          reward yang sudah direservasi atau diperoleh pengguna dan belum dibayar. Kapasitas = dana terkonfirmasi
          dikurangi kewajiban. Mencatat di sini tidak memindahkan uang.
        </p>
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-status-error dark:border-red-900/30 dark:bg-red-950/20">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-xl border border-border bg-surface-soft px-3.5 py-2.5 text-sm text-foreground">{notice}</div>
        ) : null}

        {loading && !detail ? <p className="text-sm text-muted">Memuat...</p> : null}

        {detail ? (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Stat label="Dana terkonfirmasi" value={formatRupiah(detail.confirmedRupiah)} />
              <Stat
                label="Kewajiban ditahan"
                value={formatRupiah(detail.heldRupiah)}
                hint={`${detail.activeReservations} reservasi aktif · sisa ${formatRupiah(detail.reservedRemainingRupiah)}`}
              />
              <Stat
                label="Kapasitas tersisa"
                value={formatRupiah(detail.capacityRupiah)}
                hint={detail.capacityRupiah < 0 ? "Kewajiban melebihi dana terkonfirmasi" : undefined}
                tone={detail.capacityRupiah < 0 ? "error" : undefined}
              />
            </div>
            {detail.uncoveredRupiah > 0 ? (
              <p className="text-sm text-status-error">
                {formatRupiah(detail.uncoveredRupiah)} kewajiban tercatat di luar reservasinya (barang sudah diterima
                mesin, reward tidak dihilangkan). Periksa batas reward per sesi program/mesin.
              </p>
            ) : null}
            {detail.programsWithoutBudget.length > 0 ? (
              <p className="text-sm text-status-error">
                Program berhadiah aktif tanpa kuota: {detail.programsWithoutBudget.map((program) => program.name).join(", ")}.
                Kuota wajib diisi (minimal Rp1); saat penegakan dana aktif program ini tidak menerima setoran.
              </p>
            ) : null}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Kuota program</h3>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-soft text-left text-xs uppercase text-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Program</th>
                      <th className="px-3 py-2 font-semibold">Status</th>
                      <th className="px-3 py-2 text-right font-semibold">Kuota</th>
                      <th className="px-3 py-2 text-right font-semibold">Ditahan</th>
                      <th className="px-3 py-2 text-right font-semibold">Terpakai</th>
                      <th className="px-3 py-2 text-right font-semibold">Batas/sesi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.campaigns.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-center text-muted" colSpan={6}>
                          Belum ada program.
                        </td>
                      </tr>
                    ) : (
                      detail.campaigns.map((campaign) => (
                        <tr key={campaign.id}>
                          <td className="px-3 py-2 text-foreground">
                            {campaign.name}
                            {campaign.rewardMode !== "MONEY_REWARD" ? (
                              <span className="ml-1 text-xs text-muted">(tanpa uang)</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-muted">{campaign.status}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {campaign.rewardBudgetRupiah == null ? "-" : formatRupiah(campaign.rewardBudgetRupiah)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(campaign.heldRupiah)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatRupiah(campaign.spentRupiah)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {campaign.maxRewardPerSessionRupiah == null ? (
                              <span className="text-status-error">belum diisi</span>
                            ) : (
                              formatRupiah(campaign.maxRewardPerSessionRupiah)
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">
                Reservasi yang perlu ditangani ({detail.staleHolds.length})
              </h3>
              {detail.staleHolds.length === 0 ? (
                <p className="text-sm text-muted">Tidak ada reservasi yang menggantung.</p>
              ) : (
                <div className="space-y-2">
                  {detail.staleHolds.map((hold) => {
                    const releasable = hold.remainingRupiah > 0 && hold.reasons.includes("SOURCE_CLOSED_AWAITING_WATERMARK");
                    return (
                      <div key={hold.reservationId} className="rounded-xl border border-border px-3.5 py-3 text-sm">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="font-medium text-foreground">
                              {hold.sourceType === "SESSION" ? "Sesi mesin" : "Trip"}{" "}
                              <span className="font-mono text-xs text-muted">{hold.sourceId}</span>
                              {hold.sourceStatus ? <span className="ml-1 text-xs text-muted">({hold.sourceStatus})</span> : null}
                            </p>
                            <p className="text-xs text-muted">
                              Pemilik <span className="font-mono">{hold.userId}</span> · batas {formatRupiah(hold.ceilingRupiah)} ·
                              sisa {formatRupiah(hold.remainingRupiah)} · {hold.ageMinutes} menit
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {hold.reasons.map((reason) => (
                              <Badge key={reason} tone="warning">
                                {REASON_LABELS[reason] ?? reason}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <p className="mt-2 text-xs text-muted">{hold.reconciliation}</p>
                        {releasable ? (
                          <div className="mt-2 flex flex-wrap items-end gap-2">
                            <FormField label="Alasan pelepasan" htmlFor={`release-${hold.reservationId}`} className="flex-1">
                              <Input
                                id={`release-${hold.reservationId}`}
                                value={releaseReasons[hold.reservationId] ?? ""}
                                onChange={(e) =>
                                  setReleaseReasons((prev) => ({ ...prev, [hold.reservationId]: e.target.value }))
                                }
                                placeholder="Seluruh event mesin sudah tersinkron, sesi selesai"
                              />
                            </FormField>
                            <Button size="sm" variant="outline" disabled={busy} onClick={() => releaseHold(hold.reservationId)}>
                              Lepas sisa dana
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Catat dana terkonfirmasi</h3>
              <form onSubmit={submitEntry} className="grid gap-3 sm:grid-cols-2">
                <FormField label="Jenis" htmlFor="funding-kind">
                  <Select id="funding-kind" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
                    <option value="CONFIRMED_TOPUP">Dana masuk terkonfirmasi</option>
                    <option value="CORRECTION">Koreksi (boleh negatif)</option>
                  </Select>
                </FormField>
                <FormField label="Nominal (Rp)" htmlFor="funding-amount" required>
                  <Input
                    id="funding-amount"
                    type="number"
                    step={1}
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="misal 5000000"
                    required
                  />
                </FormField>
                <FormField
                  label="Referensi bukti"
                  htmlFor="funding-reference"
                  hint="Nomor referensi transfer/bukti bank, minimal 6 karakter (huruf besar/kecil dianggap sama). Satu referensi mengonfirmasi kas sekali: untuk satu organisasi, satu nominal, satu jenis."
                  required
                  className="sm:col-span-2"
                >
                  <Input
                    id="funding-reference"
                    value={form.reference}
                    onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
                    placeholder="BANK-2026-10-14-001"
                    minLength={6}
                    required
                  />
                </FormField>
                <FormField
                  label="Catatan bukti"
                  htmlFor="funding-note"
                  hint="Minimal 10 karakter: sumber dana, tanggal, dan rekening. Disimpan bersama entri."
                  required
                  className="sm:col-span-2"
                >
                  <Textarea
                    id="funding-note"
                    value={form.note}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                    placeholder="Transfer BCA 14-10-2026 dari rek 1234567890 a.n. Yayasan"
                    minLength={10}
                    required
                  />
                </FormField>
                <div className="sm:col-span-2">
                  <Button type="submit" disabled={busy || !orgId}>
                    {busy ? "Menyimpan..." : "Catat pendanaan"}
                  </Button>
                </div>
              </form>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Riwayat pendanaan</h3>
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-surface-soft text-left text-xs uppercase text-muted">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Waktu</th>
                      <th className="px-3 py-2 font-semibold">Jenis</th>
                      <th className="px-3 py-2 font-semibold">Referensi</th>
                      <th className="px-3 py-2 text-right font-semibold">Nominal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.entries.length === 0 ? (
                      <tr>
                        <td className="px-3 py-4 text-center text-muted" colSpan={4}>
                          Belum ada pendanaan tercatat.
                        </td>
                      </tr>
                    ) : (
                      detail.entries.map((entry) => (
                        <tr key={entry.id}>
                          <td className="px-3 py-2 text-muted">{formatDateTime(entry.createdAt)}</td>
                          <td className="px-3 py-2 text-foreground">
                            {ENTRY_KINDS.find(([kind]) => kind === entry.kind)?.[1] ?? entry.kind}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-foreground">
                            {entry.reference}
                            {entry.note ? <span className="ml-1 font-sans text-muted">· {entry.note}</span> : null}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${entry.amount < 0 ? "text-status-error" : "text-foreground"}`}>
                            {entry.amount < 0 ? `−${formatRupiah(-entry.amount)}` : formatRupiah(entry.amount)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "error" }) {
  return (
    <div className="rounded-xl border border-border bg-surface-soft px-4 py-3">
      <p className="text-xs uppercase text-muted">{label}</p>
      <p className={`text-lg font-semibold tabular-nums ${tone === "error" ? "text-status-error" : "text-foreground"}`}>{value}</p>
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
