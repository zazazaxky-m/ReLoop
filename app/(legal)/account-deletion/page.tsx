import type { Metadata } from "next";
import { Info, Trash } from "@/components/ui/icons";
import { AccountDeletionForm } from "@/components/legal/AccountDeletionForm";

export const metadata: Metadata = {
  title: "Hapus Akun",
  description:
    "Ajukan permintaan penghapusan akun ReLoop dan semua data pribadi Anda. Proses selesai dalam 7 hari kerja.",
  alternates: { canonical: "/account-deletion" },
  robots: { index: true, follow: true },
};

export default function AccountDeletionPage() {
  return (
    <article className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-6">
        <header className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <div className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-status-error dark:border-red-900/40 dark:bg-red-950/30">
            <Trash className="text-sm" /> Hapus Akun
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-[-0.04em] text-foreground sm:text-4xl">
            Penghapusan Akun ReLoop
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted sm:text-[15px]">
            Kami menghormati keputusan Anda untuk berhenti menggunakan ReLoop.
            Halaman ini menjelaskan proses, jenis data yang akan dihapus, dan
            jangka waktu retensi. Permintaan biasanya diproses dalam waktu 7
            (tujuh) hari kerja.
          </p>
        </header>

        <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-bold tracking-[-0.02em] text-foreground">
            Langkah-langkah
          </h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] leading-7 text-muted">
            <li>
              Isi formulir di samping dengan email akun ReLoop yang ingin
              dihapus.
            </li>
            <li>
              Tim kami akan memverifikasi identitas Anda dengan mengirim email
              konfirmasi ke alamat tersebut.
            </li>
            <li>
              Setelah identitas terverifikasi, kami akan menonaktifkan akun
              Anda dan menjadwalkan penghapusan data pribadi.
            </li>
            <li>
              Anda akan menerima email kedua yang mengonfirmasi bahwa proses
              telah selesai.
            </li>
          </ol>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-bold tracking-[-0.02em] text-foreground">
            Data yang akan dihapus
          </h2>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-muted">
            <li>Profil akun (nama, email, nomor telepon, foto profil)</li>
            <li>Akun pencairan (DANA / OVO / GoPay / Bank) yang tersimpan</li>
            <li>
              Riwayat setoran, validasi, dan saldo reward (akan dianonimkan;
              data agregat yang tidak dapat diidentifikasi dapat dipertahankan
              untuk analitik)
            </li>
            <li>Riwayat pencairan poin (redemptions)</li>
            <li>Riwayat travel program dan partnership</li>
            <li>Notifikasi, preferensi, dan token push notification</li>
            <li>Foto dokumentasi laporan (jika ada)</li>
          </ul>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-bold tracking-[-0.02em] text-foreground">
            Periode retensi
          </h2>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-muted">
            <li>
              <span className="font-semibold text-foreground">30 hari</span>{" "}
              sejak permintaan disetujui: data pribadi dihapus atau
              dianonimkan (nama menjadi &quot;[REDACTED]&quot;, email menjadi
              redacted-&lt;id&gt;@reloop.id, token &amp; password dihapus).
            </li>
            <li>
              <span className="font-semibold text-foreground">Sampai 7 tahun</span>:
              catatan audit log (tanpa data pribadi) dan data transaksi
              keuangan yang diwajibkan oleh peraturan perpajakan dan
              anti-pencucian uang Indonesia.
            </li>
            <li>
              <span className="font-semibold text-foreground">Tanpa batas</span>:
              data agregat yang sepenuhnya anonim (misalnya statistik total
              kilogram sampah yang disetorkan per bulan) untuk keperluan
              analitik dan pelaporan dampak lingkungan.
            </li>
          </ul>
        </section>

        <aside className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-5 text-sm leading-6 text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200">
          <Info className="mt-0.5 shrink-0 text-lg text-amber-700 dark:text-amber-400" />
          <div>
            <p className="font-bold text-amber-900 dark:text-amber-100">
              Penting
            </p>
            <p className="mt-1">
              Setelah 30 hari, akun dan data tidak dapat dipulihkan. Sisa
              saldo reward yang belum dicairkan akan hangus. Untuk hanya
              menghapus sebagian data tanpa menutup akun, gunakan halaman{" "}
              <a
                href="/data-deletion"
                className="font-semibold underline-offset-2 hover:underline"
              >
                Hapus Data
              </a>
              .
            </p>
          </div>
        </aside>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-bold tracking-[-0.02em] text-foreground">
            Formulir Penghapusan Akun
          </h2>
          <p className="mt-1 text-sm text-muted">
            Kami akan menghubungi Anda melalui email untuk verifikasi
            identitas.
          </p>
          <div className="mt-5">
            <AccountDeletionForm />
          </div>
        </div>
      </aside>
    </article>
  );
}
