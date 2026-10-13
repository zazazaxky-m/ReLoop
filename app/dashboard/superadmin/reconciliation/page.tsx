import type { Metadata } from "next";
import { MetricCard, PageHeader } from "@/components/ui";
import { AlertTriangle, ShieldCheck, Wallet } from "@/components/ui/icons";
import { requirePageUser } from "@/lib/rbac";
import { getReconciliationReport } from "@/lib/ledger";
import { formatRupiah, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Rekonsiliasi Keuangan" };
export const dynamic = "force-dynamic";

export default async function ReconciliationPage() {
  await requirePageUser(["SUPERADMIN"]);
  const report = await getReconciliationReport();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Rekonsiliasi Keuangan"
        description="Liabilitas poin per organisasi dan pencocokan pembayaran (ledger REDEEM vs pencairan) di seluruh platform."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Total liabilitas (spendable)"
          value={formatRupiah(report.totalOutstanding)}
          icon={Wallet}
          tone="teal"
        />
        <MetricCard
          label="Menunggu review (pending)"
          value={formatRupiah(report.totalEarnPending)}
          icon={ShieldCheck}
          tone="amber"
        />
        <MetricCard
          label="Dicairkan (ledger)"
          value={formatRupiah(report.ledgerRedeemed)}
          icon={Wallet}
          tone="slate"
        />
        <MetricCard
          label="Selisih rekonsiliasi"
          value={formatRupiah(report.redeemedDiscrepancy + report.reservedDiscrepancy)}
          icon={AlertTriangle}
          tone={report.hasDiscrepancy ? "amber" : "teal"}
        />
      </div>

      {report.hasDiscrepancy ? (
        <div className="flex items-start gap-3 rounded-xl border border-status-error/40 bg-status-error/5 px-4 py-3">
          <AlertTriangle className="mt-0.5 text-lg text-status-error" />
          <div className="text-sm">
            <p className="font-semibold text-status-error">
              Selisih rekonsiliasi terdeteksi
            </p>
            <p className="text-muted">
              Ledger REDEEM dan catatan pencairan tidak cocok. Periksa entri yang
              belum tersettle atau pencairan yang belum tercatat di ledger.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-soft px-4 py-3">
          <ShieldCheck className="mt-0.5 text-lg text-status-online" />
          <p className="text-sm text-muted">
            Ledger pembayaran cocok dengan catatan pencairan. Tidak ada selisih.
          </p>
        </div>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">
          Pencocokan pembayaran (global)
        </h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-soft text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Metrik</th>
                <th className="px-4 py-2 text-right font-semibold">Ledger</th>
                <th className="px-4 py-2 text-right font-semibold">Pencairan</th>
                <th className="px-4 py-2 text-right font-semibold">Selisih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-2.5 text-foreground">Sudah dibayar (SUCCESS)</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatRupiah(report.ledgerRedeemed)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatRupiah(report.redemptionSuccessTotal)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${report.redeemedDiscrepancy === 0 ? "text-muted" : "text-status-error"}`}>
                  {formatRupiah(report.redeemedDiscrepancy)}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-foreground">Dalam proses (reserved)</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatRupiah(report.ledgerReserved)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatRupiah(report.redemptionInFlightTotal)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${report.reservedDiscrepancy === 0 ? "text-muted" : "text-status-error"}`}>
                  {formatRupiah(report.reservedDiscrepancy)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-foreground">
          Liabilitas per organisasi
        </h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-soft text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Organisasi</th>
                <th className="px-4 py-2 text-right font-semibold">Tersedia</th>
                <th className="px-4 py-2 text-right font-semibold">Pending</th>
                <th className="px-4 py-2 text-right font-semibold">Penyesuaian</th>
                <th className="px-4 py-2 text-right font-semibold">Liabilitas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {report.organizations.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-muted" colSpan={5}>
                    Belum ada data ledger.
                  </td>
                </tr>
              ) : (
                report.organizations.map((org) => (
                  <tr key={org.organizationId ?? "none"}>
                    <td className="px-4 py-2.5 text-foreground">{org.organizationName}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatRupiah(org.earnAvailable)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted">{formatRupiah(org.earnPending)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted">{formatRupiah(org.adjustments)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-foreground">{formatRupiah(org.outstanding)}</td>
                  </tr>
                ))
              )}
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
          sudah dihapus. Selesaikan bersama tim keuangan; ledger tidak pernah didebit paksa.
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
        Dihasilkan {formatDateTime(report.generatedAt)}.
      </p>
    </div>
  );
}
