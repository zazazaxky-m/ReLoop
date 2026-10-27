import type { Metadata } from "next";
import { Info } from "@/components/ui/icons";
import { AccountDeletionForm } from "@/components/legal/AccountDeletionForm";
import { ERASED_DATA, RETAINED_DATA } from "@/lib/erasure-copy";

export const metadata: Metadata = {
  title: "Hapus Akun",
  description:
    "Ajukan penghapusan akun ReLoop: data pribadi dihapus setelah Anda mengonfirmasi, catatan transaksi disimpan tanpa identitas Anda.",
  alternates: { canonical: "/account-deletion" },
  robots: { index: true, follow: true },
};

export default function AccountDeletionPage() {
  return (
    <article className="grid gap-8 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-10">
        <header>
          <p className="inline-block -rotate-[1.5deg] rounded-[3px] bg-lime px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.13em] text-ink">Hapus Akun</p>
          <h1 className="mt-5 text-4xl font-bold leading-[1.02] tracking-[-0.06em] text-foreground sm:text-5xl">
            Penghapusan Akun ReLoop
          </h1>
          <p className="mt-5 text-[15px] leading-7 text-muted">
            Kami menghormati keputusan Anda untuk berhenti menggunakan ReLoop.
            Halaman ini menjelaskan proses, data yang dihapus, dan data yang
            tetap disimpan beserta alasannya.
          </p>
        </header>

        <section className="border-t border-rule-strong pt-8">
          <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">
            Langkah-langkah
          </h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-[15px] leading-7 text-muted">
            <li>
              Dari aplikasi: buka Profil lalu Hapus Akun. Karena Anda sudah
              masuk, permintaan langsung terverifikasi.
            </li>
            <li>
              Tanpa masuk: isi formulir di samping. Kami mengirim tautan
              konfirmasi sekali pakai (berlaku 24 jam) ke email akun tersebut.
              Tidak ada data yang dihapus sebelum tautan itu dibuka dan
              dikonfirmasi.
            </li>
            <li>
              Jika masih ada saldo, pencairan, sesi setoran, atau trip yang
              belum selesai, status menjadi &quot;ditunda&quot;: belum ada data
              yang dihapus, akun tetap aktif, dan Anda mendapat daftar hal yang
              perlu diselesaikan. Penghapusan dilanjutkan otomatis setelah
              semuanya selesai. Saldo tidak dihanguskan.
            </li>
            <li>
              Setelah dijalankan, status menjadi &quot;selesai&quot; hanya bila
              semua langkah berhasil, termasuk penghapusan berkas bukti
              transfer. Jika ada langkah yang gagal, status menjadi &quot;belum
              selesai&quot; dan sistem mencobanya ulang otomatis.
            </li>
            <li>
              Tidak bisa masuk dan tidak bisa membuka email akun? Hubungi
              privacy@reloop.id; tim kami memverifikasi identitas Anda secara
              terpisah sebelum memproses permintaan.
            </li>
          </ol>
        </section>

        <section className="border-t border-rule-strong pt-8">
          <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">
            Data yang dihapus
          </h2>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-muted">
            {ERASED_DATA.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="border-t border-rule-strong pt-8">
          <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">
            Data yang tetap disimpan dan alasannya
          </h2>
          <ul className="mt-4 list-disc space-y-1.5 pl-5 text-[15px] leading-7 text-muted">
            {RETAINED_DATA.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <aside className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-5 text-sm leading-6 text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200">
          <Info className="mt-0.5 shrink-0 text-lg text-amber-700 dark:text-amber-400" />
          <div>
            <p className="font-bold text-amber-900 dark:text-amber-100">
              Penting
            </p>
            <p className="mt-1">
              Penghapusan tidak dapat dibatalkan setelah selesai. Email yang
              sama dapat dipakai untuk mendaftar akun baru, tanpa riwayat akun
              lama. Untuk hanya menghapus sebagian data tanpa menutup akun,
              gunakan halaman{" "}
              <a
                href="/data-deletion"
                className="font-semibold underline decoration-1 underline-offset-2 hover:decoration-2"
              >
                Hapus Data
              </a>
              .
            </p>
          </div>
        </aside>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-2xl border border-border bg-surface p-6">
          <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground">
            Formulir Penghapusan Akun
          </h2>
          <p className="mt-1 text-sm text-muted">
            Kami mengirim tautan konfirmasi ke email akun. Tidak ada data yang
            dihapus sebelum Anda mengonfirmasi.
          </p>
          <div className="mt-5">
            <AccountDeletionForm />
          </div>
        </div>
      </aside>
    </article>
  );
}
