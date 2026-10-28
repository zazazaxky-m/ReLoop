import type { Metadata } from "next";
import { Info } from "@/components/ui/icons";

export const metadata: Metadata = {
  title: "Syarat & Ketentuan",
  description:
    "Syarat dan ketentuan penggunaan layanan ReLoop, platform pengelolaan sampah digital dengan reward.",
  alternates: { canonical: "/terms" },
  robots: { index: true, follow: true },
};

const LAST_UPDATED = "1 Januari 2026";

const sections = [
  {
    title: "1. Pendahuluan",
    body: "Selamat datang di ReLoop. Dengan mengakses atau menggunakan aplikasi mobile, situs web, dan layanan kami (secara bersama-sama disebut \"Layanan\"), Anda menyetujui Syarat & Ketentuan ini. Jika Anda tidak menyetujui salah satu bagian, mohon untuk tidak menggunakan Layanan. Kami dapat memperbarui Syarat & Ketentuan ini dari waktu ke waktu sesuai Bagian 8.",
  },
  {
    title: "2. Definisi",
    body: "\"ReLoop\" adalah platform pengelolaan sampah digital yang mengoperasikan aplikasi mobile, dasbor web, dan jaringan Reverse Vending Machine (RVM) untuk menerima, memvalidasi, dan menghargai material daur ulang dari pengguna. \"Pengguna\" adalah individu atau badan yang terdaftar dan menggunakan Layanan. \"Reward\" adalah bentuk apresiasi (poin, saldo dompet, atau bentuk lain) yang diberikan atas aktivitas penyetoran yang tervalidasi.",
  },
  {
    title: "3. Akun Pengguna",
    body: "Untuk menggunakan fitur setor, Anda harus membuat akun dengan memberikan informasi yang akurat dan lengkap (nama, email, nomor telepon). Anda bertanggung jawab penuh atas kerahasiaan kredensial login dan atas setiap aktivitas yang terjadi pada akun Anda. Segera hubungi kami jika Anda mencurigai adanya penggunaan akun tanpa izin. Kami dapat membekukan atau menutup akun yang terbukti melanggar Syarat & Ketentuan atau menyalahgunakan Layanan.",
  },
  {
    title: "4. Penggunaan Layanan",
    body: "Layanan hanya boleh digunakan untuk tujuan yang sah. Anda dilarang: (a) menyetorkan material yang tercemar, berbahaya, atau di luar kategori yang diterima; (b) memalsukan, menggandakan, atau memanipulasi bukti setoran; (c) melakukan tindakan yang dapat merusak, mengganggu, atau menyusupi sistem ReLoop; (d) menggunakan akun atas nama pihak lain tanpa hak; (e) melakukan aktivitas yang melanggar hukum Indonesia. Setiap pelanggaran dapat dikenai pembekuan akun, pencabutan reward, dan/atau tindakan hukum.",
  },
  {
    title: "5. Setoran, Validasi, dan Reward",
    body: "Reward diberikan berdasarkan jenis, berat, dan kualitas material yang berhasil divalidasi oleh sistem atau operator kami. Besaran reward dapat berubah sewaktu-waktu dan diumumkan melalui aplikasi atau situs web. ReLoop berhak menolak, menunda, atau membatalkan reward jika ditemukan indikasi kecurangan, kerusakan material, atau kesalahan teknis. Pencairan reward tunduk pada Syarat & Ketentuan pencairan yang tersedia di dompet aplikasi.",
  },
  {
    title: "6. Biaya",
    body: "Penggunaan dasar Layanan ReLoop adalah gratis untuk Pengguna individu. Fitur tertentu (misalnya dasbor operasional untuk agen wisata atau pengepul) dapat dikenai biaya berlangganan sesuai paket yang dipilih. Setiap perubahan biaya akan diinformasikan sebelumnya melalui aplikasi atau email.",
  },
  {
    title: "7. Privasi dan Data Pribadi",
    body: "Pengumpulan dan penggunaan data pribadi Anda diatur dalam Kebijakan Privasi ReLoop yang dapat diakses di /privacy. Dengan menggunakan Layanan, Anda juga menyetujui Kebijakan Privasi tersebut.",
  },
  {
    title: "8. Perubahan Syarat & Ketentuan",
    body: "Kami dapat mengubah atau memperbarui Syarat & Ketentuan ini sewaktu-waktu. Versi terbaru akan selalu dipublikasikan di halaman ini dengan tanggal pembaruan. Untuk perubahan material, kami akan memberi tahu Anda melalui email atau notifikasi aplikasi paling lambat 14 (empat belas) hari sebelum perubahan berlaku. Penggunaan Layanan setelah tanggal berlaku ознака menyetujui ketentuan yang baru.",
  },
  {
    title: "9. Penangguhan dan Penghentian",
    body: "Kami dapat menangguhkan atau menghentikan akses Anda ke Layanan, sebagian atau seluruhnya, jika: (a) Anda melanggar Syarat & Ketentuan atau hukum yang berlaku; (b) aktivitas Anda mencurigakan atau merugikan Pengguna lain; (c) kami diharuskan oleh otoritas yang berwenang; (d) Layanan tidak dapat dilanjutkan karena keadaan di luar kendali kami. Kami akan berusaha memberi tahu Anda terlebih dahulu kecuali hal tersebut menghambat upaya pencegahan kerugian.",
  },
  {
    title: "10. Batasan Tanggung Jawab",
    body: "Sejauh diizinkan oleh hukum yang berlaku, ReLoop disediakan sebagaimana adanya (\"as is\") tanpa jaminan apa pun. Kami tidak bertanggung jawab atas kerugian tidak langsung, insidental, konsekuensial, atau kehilangan keuntungan yang timbul dari penggunaan atau ketidakmampuan menggunakan Layanan. Tanggung jawab kami atas kerugian langsung terbatas pada jumlah reward yang Anda terima dalam 3 (tiga) bulan terakhir.",
  },
  {
    title: "11. Hukum yang Berlaku",
    body: "Syarat & Ketentuan ini diatur oleh dan ditafsirkan sesuai dengan hukum Republik Indonesia. Setiap sengketa yang timbul akan diselesaikan secara musyawarah. Apabila musyawarah tidak mencapai kesepakatan, para pihak sepakat untuk memilih domisili hukum di Pengadilan Negeri Jakarta Pusat.",
  },
  {
    title: "12. Kontak",
    body: "Untuk pertanyaan terkait Syarat & Ketentuan ini, hubungi: legal@reloop.id.",
  },
];

export default function TermsPage() {
  return (
    <article>
      <header className="mb-12">
        <p className="inline-block -rotate-[1.5deg] rounded-[3px] bg-lime px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.13em] text-ink">Ketentuan</p>
        <h1 className="mt-5 text-4xl font-bold leading-[1.02] tracking-[-0.06em] text-foreground sm:text-5xl">
          Syarat &amp; Ketentuan ReLoop
        </h1>
        <p className="mt-3 text-sm text-muted">
          Terakhir diperbarui:{" "}
          <time dateTime={LAST_UPDATED}>{LAST_UPDATED}</time>
        </p>
        <p className="mt-5 max-w-2xl text-[15px] leading-7 text-muted sm:text-base">
          Harap baca Syarat &amp; Ketentuan ini dengan saksama sebelum
          menggunakan Layanan ReLoop. Dokumen ini merupakan perjanjian yang
          mengikat antara Anda dan ReLoop.
        </p>
      </header>

      <div className="space-y-10">
        {sections.map((section) => (
          <section
            key={section.title}
            className="border-t border-rule-strong pt-8"
          >
            <h2 className="text-xl font-bold tracking-[-0.03em] text-foreground sm:text-2xl">
              {section.title}
            </h2>
            <p className="mt-3 max-w-[68ch] text-[15px] leading-7 text-muted sm:text-base">{section.body}</p>
          </section>
        ))}
      </div>

      <aside className="mt-12 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-5 text-sm leading-6 text-amber-900 dark:border-amber-900/30 dark:bg-amber-950/20 dark:text-amber-200 sm:p-6">
        <Info className="mt-0.5 shrink-0 text-lg text-amber-700 dark:text-amber-400" />
        <div>
          <p className="font-bold text-amber-900 dark:text-amber-100">
            Ringkasan ini bukan dokumen hukum
          </p>
          <p className="mt-1">
            Konten di atas adalah teks lengkap yang mengikat secara hukum. Ringkasan
            singkat yang mungkin diberikan di tempat lain hanya untuk kenyamanan
            dan tidak menggantikan versi lengkap ini.
          </p>
        </div>
      </aside>
    </article>
  );
}
