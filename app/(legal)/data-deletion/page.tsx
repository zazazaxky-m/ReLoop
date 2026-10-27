import type { Metadata } from "next";
import Link from "next/link";
import { Info } from "@/components/ui/icons";
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
      <div className="space-y-10">
        <header>
          <p className="inline-block -rotate-[1.5deg] rounded-[3px] bg-lime px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.13em] text-ink">Hapus Data</p>
          <h1 className="mt-5 text-4xl font-bold leading-[1.02] tracking-[-0.06em] text-foreground sm:text-5xl">
            Penghapusan Sebagian Data
          </h1>
          <p className="mt-5 text-[15px] leading-7 text-muted">
            Ingin menghapus beberapa kategori data tanpa menutup akun? Halaman
            ini memungkinkan Anda memilih data apa saja yang ingin dihapus.
            Akun Anda tetap aktif dan sisa saldo reward tidak terpengaruh.
          </p>
          <p className="mt-5 text-[15px] leading-7 text-muted">
            Untuk menghapus akun sepenuhnya, gunakan halaman{" "}
            <Link
              href="/account-deletion"
              className="font-semibold text-foreground underline decoration-1 underline-offset-2 hover:decoration-2"
            >
              Hapus Akun
            </Link>
            .
          </p>
        </header>

        <section className="border-t border-rule-strong pt-8">
          <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">
            Bagaimana prosesnya?
          </h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] leading-7 text-muted">
            <li>Pilih kategori data yang ingin Anda hapus pada formulir.</li>
            <li>
              Permintaan dicatat dan ditinjau oleh tim privasi kami. Tidak ada
              data yang dihapus otomatis dari formulir ini.
            </li>
            <li>
              Tim kami menghubungi Anda melalui email akun untuk memverifikasi
              bahwa Anda pemilik akun sebelum menghapus apa pun.
            </li>
            <li>
              Anda menerima jawaban berisi kategori yang dihapus dan kategori
              yang tetap disimpan beserta alasannya.
            </li>
          </ol>
        </section>

        <section className="border-t border-rule-strong pt-8">
          <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">
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
              &mdash; catatan transaksi keuangan (setoran, ledger reward,
              nominal pencairan) tidak dihapus karena diperlukan untuk
              pembukuan dan rekonsiliasi.
            </li>
            <li>
              <span className="font-semibold text-foreground">
                Tidak dapat dipulihkan
              </span>{" "}
              &mdash; setelah dihapus, data tidak dapat dikembalikan. Unduh
              salinan data Anda terlebih dahulu bila diperlukan.
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
              Catatan audit tanpa data pribadi dan catatan transaksi keuangan
              tetap disimpan; lama penyimpanannya mengikuti kebijakan retensi
              yang disetujui ReLoop. Untuk menghapus akun dan data profilnya,
              gunakan halaman Hapus Akun.
            </p>
          </div>
        </aside>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">
            Formulir Penghapusan Data
          </h2>
          <p className="mt-1 text-sm text-muted">
            Kami memverifikasi pemilik akun sebelum menghapus apa pun.
          </p>
          <div className="mt-5">
            <DataDeletionForm />
          </div>
        </div>
      </aside>
    </article>
  );
}
