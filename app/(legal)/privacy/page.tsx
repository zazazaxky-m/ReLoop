import type { Metadata } from "next";
import { Leaf, ShieldCheck } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Kebijakan Privasi",
  description:
    "Kebijakan privasi ReLoop: bagaimana kami mengumpulkan, menggunakan, dan melindungi data pribadi Anda saat menggunakan layanan pengelolaan sampah digital kami.",
  alternates: { canonical: "/privacy" },
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "1 Januari 2026";

const sections = [
  {
    title: "1. Data yang Kami Kumpulkan",
    body: "Kami mengumpulkan informasi yang Anda berikan secara langsung saat mendaftar dan menggunakan layanan ReLoop, antara lain: nama lengkap, alamat email, nomor telepon, serta foto profil (opsional). Kami juga secara otomatis merekam data aktivitas penyetoran sampah, lokasi mesin RVM yang Anda gunakan, jenis material, berat setoran, dan riwayat reward.",
  },
  {
    title: "2. Penggunaan Data",
    body: "Data Anda digunakan untuk: mengelola akun Anda, memproses reward dan pencairan poin, mengirim notifikasi terkait aktivitas dan transaksi, meningkatkan kualitas layanan melalui analitik internal, mencegah penipuan, serta memenuhi kewajiban hukum yang berlaku. Kami tidak menjual data pribadi Anda kepada pihak ketiga dalam bentuk apa pun.",
  },
  {
    title: "3. Keamanan Data",
    body: "Kami menerapkan langkah keamanan teknis (enkripsi in-transit dengan TLS 1.2+ dan at-rest, hashing password dengan bcrypt, audit log untuk perubahan data sensitif) dan organisasi (access control berbasis peran, prinsip least privilege, monitoring aktivitas) untuk melindungi data Anda. Akses terhadap data produksi dibatasi hanya untuk personel yang berwenang dan telah menandatangani perjanjian kerahasiaan.",
  },
  {
    title: "4. Hak Anda",
    body: "Anda berhak untuk: (a) mengakses data pribadi yang kami simpan; (b) meminta koreksi atas data yang tidak akurat; (c) menghapus akun dan data pribadi Anda; (d) menarik persetujuan atas pemrosesan data kapan saja; (e) mengajukan keluhan kepada otoritas perlindungan data yang berwenang. Anda dapat menggunakan hak-hak tersebut dengan menghubungi kami melalui email di bawah ini, melalui menu Privasi di aplikasi, atau dengan mengunjungi halaman Hapus Akun (/account-deletion) atau Hapus Data (/data-deletion).",
  },
  {
    title: "5. Cookie & Teknologi Pelacakan",
    body: "Situs web kami menggunakan cookie esensial untuk autentikasi dan keamanan sesi. Jika diaktifkan, kami juga menggunakan cookie analitik (misalnya Vercel Analytics) untuk memahami pola penggunaan secara agregat. Anda dapat mengelola preferensi cookie melalui pengaturan peramban. Aplikasi mobile dapat menggunakan teknologi analitik anonim; pengumpulan ini dapat dinonaktifkan di pengaturan perangkat Anda.",
  },
  {
    title: "6. Penyimpanan & Retensi Data",
    body: "Data pribadi disimpan selama akun Anda aktif. Setelah akun dihapus, kami akan menghapus atau menganonimkan data pribadi Anda dalam waktu 30 hari, kecuali kami diharuskan menyimpan data tertentu lebih lama untuk memenuhi kewajiban hukum, akuntansi, atau pencegahan penipuan. Data agregat yang tidak dapat diidentifikasi dapat disimpan untuk tujuan analitik dan statistik.",
  },
  {
    title: "7. Layanan Pihak Ketiga",
    body: "Untuk menjalankan layanan, kami menggunakan sub-prosesor pihak ketiga yang tepercaya, antara lain: penyedia infrastruktur cloud (Vercel, Neon/PostgreSQL), layanan analitik (Vercel Analytics), dan payment gateway untuk pencairan reward. Daftar lengkap sub-prosesor tersedia atas permintaan. Semua pihak ketiga telah melalui proses due diligence keamanan.",
  },
  {
    title: "8. Perubahan Kebijakan",
    body: "Kami dapat memperbarui kebijakan privasi ini dari waktu ke waktu untuk mencerminkan perubahan pada layanan atau hukum yang berlaku. Versi terbaru akan selalu dipublikasikan di halaman ini dengan tanggal pembaruan yang jelas. Untuk perubahan material, kami akan memberi tahu Anda melalui email atau notifikasi aplikasi sebelum perubahan berlaku.",
  },
  {
    title: "9. Kontak",
    body: "Untuk pertanyaan, permintaan akses data, atau keluhan terkait privasi, hubungi: privacy@reloop.id. Kami akan menanggapi permintaan Anda dalam waktu 7 (tujuh) hari kerja.",
  },
];

export default function PrivacyPage() {
  return (
    <article className="prose prose-slate max-w-none">
      <header className="mb-10 border-b border-border pb-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-brand-700 dark:border-brand-900/40 dark:bg-brand-950/30 dark:text-brand-400">
          <Leaf className="text-sm" /> Privasi
        </div>
        <h1 className="mt-4 text-3xl font-black tracking-[-0.04em] text-foreground sm:text-4xl">
          Kebijakan Privasi ReLoop
        </h1>
        <p className="mt-3 text-sm text-muted">
          Terakhir diperbarui:{" "}
          <time dateTime={LAST_UPDATED}>{LAST_UPDATED}</time>
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted sm:text-[15px]">
          Privasi Anda adalah prioritas kami. Dokumen ini menjelaskan bagaimana
          ReLoop mengumpulkan, menggunakan, menyimpan, dan melindungi data
          pribadi Anda saat menggunakan aplikasi mobile, situs web, dan mesin
          Reverse Vending Machine (RVM) kami.
        </p>
      </header>

      <div className="space-y-8">
        {sections.map((section) => (
          <section
            key={section.title}
            className="rounded-2xl border border-border bg-surface p-5 shadow-sm sm:p-6"
          >
            <h2 className="text-lg font-bold tracking-[-0.02em] text-foreground sm:text-xl">
              {section.title}
            </h2>
            <p className="mt-3 text-[15px] leading-7 text-muted">{section.body}</p>
          </section>
        ))}
      </div>

      <aside className="mt-10 flex items-start gap-3 rounded-2xl border border-brand-200 bg-brand-50/60 p-5 text-sm leading-6 text-brand-900 dark:border-brand-900/30 dark:bg-brand-950/20 dark:text-brand-200 sm:p-6">
        <ShieldCheck className="mt-0.5 shrink-0 text-lg text-brand-700 dark:text-brand-400" />
        <div>
          <p className="font-bold text-brand-900 dark:text-brand-100">
            Komitmen kami
          </p>
          <p className="mt-1">
            Kami memperlakukan data Anda sebagaimana kami ingin data kami
            diperlakukan: dengan hati-hati, transparan, dan hanya untuk tujuan
            yang jelas. Jika ada hal yang tidak jelas, hubungi kami.
          </p>
        </div>
      </aside>
    </article>
  );
}
