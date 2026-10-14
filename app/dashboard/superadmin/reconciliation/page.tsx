import type { Metadata } from "next";
import { MetricCard, PageHeader, StatusBadge } from "@/components/ui";
import { AlertTriangle, Clock, Coins, Info, ShieldCheck, Wallet } from "@/components/ui/icons";
import { requirePageUser } from "@/lib/rbac";
import { getReconciliationReport, type PayoutMismatchProblem } from "@/lib/reconciliation-report";
import { formatRupiah, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Rekonsiliasi Keuangan" };
export const dynamic = "force-dynamic";

const PROBLEM_LABELS: Record<PayoutMismatchProblem, string> = {
  RESERVE_MISSING: "Saldo tahanan tidak ada",
  DUPLICATE_RESERVE: "Saldo tahanan ganda",
  RESERVE_STATE_MISMATCH: "Status tahanan tidak sesuai",
  AMOUNT_MISMATCH: "Nominal tidak sesuai",
  NOT_LINKED_TO_REDEMPTION: "Tidak terhubung ke pengajuan",
  MISSING_REFERENCE: "Referensi pengajuan kosong",
  REQUEST_NOT_FOUND: "Pengajuan tidak ditemukan",
  OWNER_MISMATCH: "Pemilik berbeda",
};

function signedRupiah(value: number) {
  if (value === 0) return formatRupiah(0);
  return `${value > 0 ? "+" : "−"}${formatRupiah(Math.abs(value))}`;
}

export default async function ReconciliationPage() {
  await requirePageUser(["SUPERADMIN"]);
  const report = await getReconciliationReport();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rekonsiliasi Keuangan"
        description="Kewajiban saldo pengguna dari ledger dan pencocokan setiap pengajuan pencairan dengan saldo yang ditahan atau dibayar, dibaca dari satu snapshot."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Saldo tersedia"
          value={formatRupiah(report.availableLiability)}
          hint="Dapat dicairkan pengguna sekarang"
          icon={Wallet}
          tone="teal"
        />
        <MetricCard
          label="Menunggu pemeriksaan"
          value={formatRupiah(report.pendingLiability)}
          hint="Belum dapat dicairkan"
          icon={ShieldCheck}
          tone="amber"
        />
        <MetricCard
          label="Sedang dicairkan"
          value={formatRupiah(report.reservedLiability)}
          hint="Ditahan untuk pengajuan berjalan"
          icon={Clock}
          tone="blue"
        />
        <MetricCard
          label="Sudah dibayar"
          value={formatRupiah(report.paidTotal)}
          hint="Bukan lagi kewajiban"
          icon={Coins}
          tone="slate"
        />
      </div>

      <div className="rounded-xl border border-border bg-surface-soft px-4 py-3 text-sm">
        <p className="font-semibold text-foreground">
          Total kewajiban: {formatRupiah(report.totalObligation)}
        </p>
        <p className="text-muted">
          Saldo tersedia + menunggu pemeriksaan + sedang dicairkan. Dana yang sudah dibayar tidak termasuk.
        </p>
      </div>

      {report.hasDiscrepancy ? (
        <div className="flex items-start gap-3 rounded-xl border border-status-error/40 bg-status-error/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 text-lg text-status-error" />
          <div className="text-sm">
            <p className="font-semibold text-status-error">
              Selisih rekonsiliasi terdeteksi pada {report.payoutMismatchCount} catatan
            </p>
            <p className="text-muted">
              Ledger pencairan dan status pengajuan tidak cocok. Selisih dihitung per pengajuan, sehingga selisih
              yang berlawanan tidak saling menutupi. Periksa setiap baris di tabel di bawah.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-soft px-4 py-3">
          <ShieldCheck className="mt-0.5 text-lg text-status-online" />
          <p className="text-sm text-muted">
            Setiap pengajuan pencairan cocok dengan saldo yang ditahan atau dibayar di ledger. Tidak ada selisih.
          </p>
        </div>
      )}

      {report.overdrawn.users > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900/30 dark:bg-amber-950/20">
          <AlertTriangle className="mt-0.5 text-lg text-amber-700 dark:text-amber-400" />
          <p className="text-sm text-muted">
            <span className="font-semibold text-foreground">{report.overdrawn.users} pengguna bersaldo minus</span>{" "}
            (kekurangan {formatRupiah(report.overdrawn.availableShortfall + report.overdrawn.pendingShortfall)}). Dana
            yang keluar melebihi saldonya; angka ini tidak dikurangkan dari kewajiban kepada pengguna lain dan
            ditangani sebagai kasus pemulihan.
          </p>
        </div>
      ) : null}

      {report.flaggedTransfers.count > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-soft px-4 py-3">
          <Info className="mt-0.5 text-lg text-muted" />
          <p className="text-sm text-muted">
            {report.flaggedTransfers.count} pencairan ({formatRupiah(report.flaggedTransfers.amount)}) menunggu
            kepastian transfer. Saldonya tetap ditahan dan termasuk dalam &quot;Sedang dicairkan&quot;.
          </p>
        </div>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Pencocokan pencairan (global)</h2>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-soft text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Metrik</th>
                <th className="px-4 py-2 text-right font-semibold">Ledger</th>
                <th className="px-4 py-2 text-right font-semibold">Pengajuan</th>
                <th className="px-4 py-2 text-right font-semibold">Selisih per pengajuan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-2.5 text-foreground">Sudah dibayar</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatRupiah(report.ledgerRedeemed)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatRupiah(report.redemptionSuccessTotal)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${report.redeemedDiscrepancy === 0 ? "text-muted" : "text-status-error"}`}>
                  {formatRupiah(report.redeemedDiscrepancy)}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-foreground">Sedang dicairkan</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatRupiah(report.ledgerReserved)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatRupiah(report.redemptionInFlightTotal)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${report.reservedDiscrepancy === 0 ? "text-muted" : "text-status-error"}`}>
                  {formatRupiah(report.reservedDiscrepancy)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Selisih adalah jumlah nilai mutlak selisih tiap pengajuan, bukan selisih total ledger dikurangi total
          pengajuan.
        </p>
      </section>

      {report.payoutMismatchCount > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-foreground">
            Pengajuan yang tidak cocok ({report.payoutMismatchCount})
          </h2>
          {report.payoutMismatches.length < report.payoutMismatchCount ? (
            <p className="text-sm text-muted">
              Menampilkan {report.payoutMismatches.length} dari {report.payoutMismatchCount}. Daftar lengkap tersedia
              dari inventaris ledger.
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-soft text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-2 font-semibold">Pengajuan</th>
                  <th className="px-4 py-2 font-semibold">Status pengajuan</th>
                  <th className="px-4 py-2 font-semibold">Status ledger</th>
                  <th className="px-4 py-2 text-right font-semibold">Nominal</th>
                  <th className="px-4 py-2 text-right font-semibold">Selisih dibayar</th>
                  <th className="px-4 py-2 text-right font-semibold">Selisih ditahan</th>
                  <th className="px-4 py-2 font-semibold">Masalah</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {report.payoutMismatches.map((row) => (
                  <tr key={`${row.redemptionId ?? "none"}:${row.ledgerIds.join(",")}:${row.userId}`}>
                    <td className="px-4 py-2.5 font-mono text-xs text-foreground">{row.redemptionId ?? "-"}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={row.requestStatus} /></td>
                    <td className="px-4 py-2.5">
                      {row.reserveStatuses.length === 0 ? (
                        <span className="text-muted">Tidak ada</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {row.reserveStatuses.map((status, index) => <StatusBadge key={index} status={status} />)}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {row.requestAmount === null ? "-" : formatRupiah(row.requestAmount)}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${row.paidDifference === 0 ? "text-muted" : "font-semibold text-status-error"}`}>
                      {signedRupiah(row.paidDifference)}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${row.reservedDifference === 0 ? "text-muted" : "font-semibold text-status-error"}`}>
                      {signedRupiah(row.reservedDifference)}
                    </td>
                    <td className="px-4 py-2.5 text-foreground">{PROBLEM_LABELS[row.problem]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">Saldo per organisasi</h2>
        <div className="rounded-xl border border-border bg-surface-soft px-4 py-3 text-sm text-muted">
          <p>
            <span className="font-semibold text-foreground">
              Data legacy belum teralokasi: {formatRupiah(report.unallocatedLegacyAmount)}.
            </span>{" "}
            Pencairan dan saldo yang ditahan dicatat per pengguna tanpa sumber organisasi, sehingga saldo tersedia
            belum dapat dibagi ke organisasi. Seluruh saldo tersedia dilaporkan di baris legacy ini sampai alokasi
            per sumber dana organisasi diaktifkan. Kolom reward per organisasi adalah nilai bruto yang pernah
            diterbitkan, belum dikurangi pencairan.
          </p>
        </div>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-soft text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Organisasi</th>
                <th className="px-4 py-2 text-right font-semibold">Reward diterbitkan (bruto)</th>
                <th className="px-4 py-2 text-right font-semibold">Menunggu pemeriksaan (bruto)</th>
                <th className="px-4 py-2 text-right font-semibold">Penyesuaian</th>
                <th className="px-4 py-2 text-right font-semibold">Saldo tersedia teralokasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.organizations.map((org) => (
                <tr key={org.organizationId ?? "none"}>
                  <td className="px-4 py-2.5 text-foreground">{org.organizationName}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{formatRupiah(org.earnAvailable)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{formatRupiah(org.earnPending)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{formatRupiah(org.adjustments)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{formatRupiah(org.outstanding)}</td>
                </tr>
              ))}
              <tr className="bg-surface-soft">
                <td className="px-4 py-2.5 font-semibold text-foreground" colSpan={4}>
                  Data legacy belum teralokasi
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-foreground">
                  {formatRupiah(report.unallocatedLegacyAmount)}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 font-semibold text-foreground" colSpan={4}>
                  Total (sama dengan saldo tersedia)
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-foreground">
                  {formatRupiah(report.availableLiability)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">
          Kasus rekonsiliasi reward ({report.rewardCases.open} terbuka, {formatRupiah(report.rewardCases.openAmount)})
        </h2>
        <p className="text-sm text-muted">
          Koreksi yang tidak dipaksakan ke ledger: saldo setoran yang sudah dicairkan, atau reward untuk akun yang
          sudah dihapus. Nominalnya belum termasuk dalam angka kewajiban di atas. Selesaikan bersama tim keuangan;
          ledger tidak pernah didebit paksa.
        </p>
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-soft text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Kunci</th>
                <th className="px-4 py-2 font-semibold">Alasan</th>
                <th className="px-4 py-2 text-right font-semibold">Nominal</th>
                <th className="px-4 py-2 font-semibold">Dibuka</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.rewardCases.recent.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-muted" colSpan={4}>
                    Tidak ada kasus terbuka.
                  </td>
                </tr>
              ) : (
                report.rewardCases.recent.map((rewardCase) => (
                  <tr key={rewardCase.id}>
                    <td className="px-4 py-2.5 font-mono text-xs text-foreground">{rewardCase.businessKey}</td>
                    <td className="px-4 py-2.5 text-foreground">
                      {rewardCase.reasonCode === "RECIPIENT_ERASED"
                        ? "Akun penerima sudah dihapus"
                        : rewardCase.reasonCode === "ANOMALY_ALREADY_PAID_OUT"
                          ? "Saldo sudah dicairkan"
                          : rewardCase.reasonCode}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatRupiah(rewardCase.amount)}</td>
                    <td className="px-4 py-2.5 text-muted">{formatDateTime(rewardCase.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted">
        Dihasilkan {formatDateTime(report.generatedAt)} dari satu snapshot baca-saja.
      </p>
    </div>
  );
}
