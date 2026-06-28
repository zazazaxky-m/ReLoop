# ReLoop: Panduan Alur Bisnis & Peran (Business Logic & Roles)

Dokumen ini menjelaskan bagaimana ekosistem **ReLoop (Smart Waste Bank)** bekerja di dunia nyata, model bisnis yang digunakan (khususnya untuk studi kasus pariwisata), serta peran masing-masing aktor dalam sistem. Dokumen ini ditujukan bagi *Developer*, *Agent*, dan *Stakeholder* agar memiliki pemahaman yang selaras mengenai *Supply Chain* pengelolaan sampah.

---

## 1. Aktor & Peran (Roles)

Di dalam sistem ReLoop, terdapat 4 peran (Role) utama yang saling berkesinambungan:

1.  **User (Wisatawan / Tour Guide / Masyarakat Umum)**
    *   **Peran:** Aktor yang menyetorkan sampah.
    *   **Insentif:** Mendapatkan *Reward/Poin* yang bisa dicairkan menjadi uang (e-Wallet) atau *voucher* (diskon tiket wisata, suvenir, dll).
2.  **Admin (Pengelola Tempat Wisata / Bank Sampah Unit)**
    *   **Peran:** *Agregator Pertama*. Mereka yang menyediakan lokasi (gudang/mesin IoT), memberikan poin kepada User, dan mengumpulkan sampah dari banyak User menjadi tumpukan besar (Bulk).
    *   **Insentif:** Mendapatkan keuntungan (margin) dari menjual sampah dalam skala besar ke Pengepul, dengan harga yang lebih tinggi daripada nilai poin yang mereka berikan ke User. Selain itu, kawasan mereka menjadi bersih secara gratis.
3.  **Pengepul (Mitra Kolektor / Daur Ulang)**
    *   **Peran:** *Off-taker*. Aktor logistik yang mengambil/membeli sampah *bulk* dari lokasi Admin ketika gudang Admin sudah penuh (melalui fitur *Pickup Request*). Pengepul **tidak** berinteraksi langsung dengan User eceran.
    *   **Insentif:** Mendapatkan pasokan sampah yang sudah *tersortir dan bersih* (high-quality waste) dalam jumlah besar dari satu titik (hemat biaya operasional truk). Mereka meraup untung dengan menjualnya ke Pabrik Daur Ulang industri dengan harga tinggi.
4.  **Superadmin (Pihak ReLoop / Penyedia Platform)**
    *   **Peran:** Penyedia ekosistem *Software as a Service* (SaaS) dan pembuat *Smart IoT Bin*.
    *   **Insentif:** Pendapatan dari biaya sewa platform/mesin (Subscription), persentase potongan (Transaction Fee) dari pencairan poin, serta monetisasi data analitik / ESG (Environmental, Social, & Governance) ke perusahaan FMCG (Danone, Coca-Cola, dll).

---

## 2. Alur Fisik (Supply Chain)

Secara sederhana, pergerakan sampah dan pergerakan uang bekerja berlawanan arah:

*   **Fisik Sampah:** `User` ➡️ `Admin (Tempat Wisata)` ➡️ `Pengepul` ➡️ `Pabrik Daur Ulang`
*   **Perputaran Uang:** `Pabrik Daur Ulang` ➡️ `Pengepul` ➡️ `Admin (Tempat Wisata)` ➡️ `User`

---

## 3. Fitur Utama & Alur Penggunaan (Use Cases)

Sistem ReLoop dirancang fleksibel untuk dua skenario utama di lapangan:

### Skenario A: Deposit Individu (Smart Machine / Mesin Pintar)
Ditujukan untuk **Wisatawan Individu** yang sedang berjalan-jalan di kawasan wisata.
1.  Wisatawan melihat Mesin Pintar ReLoop.
2.  Wisatawan mengunduh aplikasi ReLoop, membuka fitur **Scan**, lalu memindai QR Code di layar mesin.
3.  Pintu mesin terbuka, wisatawan memasukkan botol plastik satu per satu.
4.  Sensor IoT (Kamera AI & Timbangan) mendeteksi jenis dan berat botol.
5.  Poin langsung di-kreditkan (ditransfer) ke akun e-Wallet (Dompet ReLoop) milik wisatawan tersebut.
6.  Wisatawan dapat mencairkan (*redeem*) poin tersebut lewat menu **Wallet / Pencairan**.

### Skenario B: Deposit Kolektif / Rombongan (Trip & Trash Bag QR)
Ditujukan untuk **Rombongan Bus Pariwisata** (misal rombongan study tour atau wisata kantor) yang dikoordinasikan oleh seorang *Tour Guide*.
1.  **Registrasi Trip:** Rombongan tiba. Admin tempat wisata mendaftarkan rombongan tersebut ke dalam sistem lewat Web Dashboard, membuat satu entitas **Trip**. Sesi Trip ini ditautkan ke *email akun milik si Tour Guide*.
2.  **Assignment Kantong:** Admin mengambil kantong-kantong sampah kosong yang sudah ditempel stiker **QR Code**, lalu men-scan QR tersebut untuk menautkannya ke sesi Trip tadi. Kantong diserahkan ke rombongan.
3.  **Pengumpulan (Aktivitas Wisata):** Selama rombongan berkeliling lokasi wisata, mereka membuang sampah ke dalam kantong-kantong QR yang mereka bawa.
    *   *Tour Guide dapat membuka aplikasi mobile (fitur Trash Bag) untuk memantau: "Rombongan saya sedang membawa 5 kantong QR."*
4.  **Pengembalian (Drop-off):** Sebelum pulang, rombongan menyerahkan kembali kantong-kantong yang sudah terisi ke pos Admin.
5.  **Validasi & Reward:** Admin men-scan QR code di kantong tersebut. Sistem otomatis tahu bahwa kantong ini milik Trip A (yang dipimpin Tour Guide A). Admin menimbang berat total sampah, menyimpannya di gudang, lalu menyetujui validasinya.
6.  **Pencairan (Redeem):** Poin hasil timbangan langsung masuk ke akun si Tour Guide. Tour Guide bisa menggunakan poin ini untuk membeli suvenir, atau menjadikannya komisi pribadi. (Wisatawan mendapat keuntungan intrinsik berwisata secara ramah lingkungan).

### Skenario C: Penjemputan Sampah Massal (Pickup by Pengepul)
Melanjutkan dari Skenario A & B, sampah yang terkumpul akhirnya menumpuk di tempat wisata.
1.  Saat gudang atau Mesin Pintar sudah penuh, sistem otomatis memberi alert atau Admin menekan tombol **Request Pickup**.
2.  Notifikasi Pickup masuk ke aplikasi Mobile para **Pengepul** di wilayah tersebut.
3.  Seorang Pengepul (Self-Assign) mengambil *task* tersebut, lalu menyalakan status **"On The Way"**.
4.  Pengepul tiba dengan mobil pick-up, memuat berkarung-karung sampah (yang sudah di-scan & diverifikasi oleh sistem) ke atas mobil.
5.  Pengepul menekan tombol **Collect** di aplikasinya, mencatat total muatan, dan menyelesaikan tugasnya.
6.  Pengepul membayar Admin wisata atas sampah curah tersebut.

---

## 4. Kesimpulan untuk Developer
Memahami alur di atas **Sangat Penting** agar developer tidak salah mendesain UI/UX atau API. 
*   **Contoh Fatal Flaw yang harus dihindari:** Membuat fitur agar *User biasa bisa memfoto sampah dan memanggil Pengepul ke rumahnya*. Ini salah kaprah karena *Business Model* ReLoop untuk Pengepul adalah **Bulk Collection** (skala besar dari mitra Admin/Wisata), bukan penjemputan eceran layaknya ojek online.
*   Oleh karena itu, halaman Trash Bag di Mobile User kini bersifat **Read-Only / Tracker** (Skenario B), tempat User/Tour Guide hanya melihat kantong QR apa saja yang menjadi tanggung jawabnya. Input data hanya dilakukan oleh Admin atau Mesin IoT.
