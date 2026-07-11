import type { Metadata } from "next";
import Link from "next/link";
import { Info, ShieldCheck } from "@/components/ui/icons";
import { DataDeletionForm } from "@/components/legal/DataDeletionForm";

export const metadata: Metadata = {
  title: "Hapus Data",
  description:
    "Ajukan permintaan penghapusan sebagian data pribadi Anda dari ReLoop tanpa harus menghapus akun.",
  alternates: { canonical: "/data-deletion" },
  robots: { index: true, follow: true },
};

export default function DataDeletionPage() {
  return (
    <article className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-6">
        <header className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-brand-700 dark:border-brand-900/40 dark:bg-brand-950/30 dark:text-brand-400">
            <ShieldCheck className="text-sm" /> Hapus Data
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-[-0.04em] text-foreground sm:text-4xl">
            Penghapusan Sebagian Data
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted sm:text-[15px]">
            Ingin menghapus beberapa kategori data tanpa menutup akun? Halaman
            ini memungkinkan Anda memilih data apa saja yang ingin dihapus.
            Akun Anda tetap aktif dan sisa saldo reward tidak terpengaruh.
          </p>
          <p className="mt-3 text-sm leading-6 text-muted sm:text-[15px]">
            Untuk menghapus akun sepenuhnya, gunakan halaman{" "}
            <Link
              href="/account-deletion"
              className="font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
            >
              Hapus Akun
            </Link>
            .
          </p>
        </header>

        <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-bold tracking-[-0.02em] text-foreground">
            Bagaimana prosesnya?
          </h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] leading-7 text-muted">
            <li>Pilih kategori data yang ingin Anda hapus pada formulir.</li>
            <li>
              Kami akan mengirim email verifikasi ke akun Anda. Klik tautan di
              email tersebut untuk mengonfirmasi permintaan.
            </li>
            <li>
              Setelah dikonfirmasi, kategori data yang dipilih akan dihapus
              dalam waktu paling lambat 7 (tujuh) hari kerja.
            </li>
            <li>
              Anda akan menerima email konfirmasi setelah setiap kategori
              berhasil dihapus.
            </li>
          </ol>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-bold tracking-[-0.02em] text-foreground">
            Apa yang terjadi setelah data dihapus?
          </h2>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-muted">
            <li>
              <span className="font-semibold text-foreground">
                Akun tetap aktif
              </span>{" "}
              &mdash; Anda dapat login dan menggunakan fitur lain secara
              normal.
            </li>
            <li>
              <span className="font-semibold text-foreground">
                Saldo reward tidak berubah
              </span>{" "}
              &mdash; hanya data historis (riwayat) yang dihapus.
            </li>
            <li>
              <span className="font-semibold text-foreground">
                Tidak dapat dipulihkan
              </span>{" "}
              &mdash; setelah dihapus, data tidak dapat dikembalikan. Pastikan
              Anda telah mengunduh riwayat setoran / reward terlebih dahulu
              melalui menu Profil &rarr; Ekspor Data jika diperlukan.
            </li>
          </ul>
        </section>

        <aside className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-5 text-sm leading-6 text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200">
          <Info className="mt-0.5 shrink-0 text-lg text-amber-700 dark:text-amber-400" />
          <div>
            <p className="font-bold text-amber-900 dark:text-amber-100">
              Catatan
            </p>
            <p className="mt-1">
              Catatan audit log yang tidak memuat data pribadi dan data
              transaksi keuangan yang diwajibkan peraturan akan tetap
              dipertahankan sesuai periode retensi masing-masing.
            </p>
          </div>
        </aside>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
          <h2 className="text-lg font-bold tracking-[-0.02em] text-foreground">
            Formulir Penghapusan Data
          </h2>
          <p className="mt-1 text-sm text-muted">
            Kami akan menghubungi Anda untuk verifikasi sebelum menghapus.
          </p>
          <div className="mt-5">
            <DataDeletionForm />
          </div>
        </div>
      </aside>
    </article>
  );
}
