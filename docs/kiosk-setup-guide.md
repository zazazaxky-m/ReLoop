# Panduan Setup Mesin Kiosk (RVM)

Aplikasi ReLoop menyediakan antarmuka web khusus yang dirancang untuk dijalankan di layar sentuh (tablet/monitor) yang menempel pada mesin fisik RVM (Reverse Vending Machine).

## 1. Menjalankan Mode Kiosk

Antarmuka mesin diakses melalui rute web Next.js:
`https://[domain-reloop]/kiosk`

Karena mesin ini beroperasi 24/7 di tempat umum, UI kiosk dirancang agar:
- Memiliki tingkat kontras tinggi (mudah dibaca di bawah sinar matahari).
- Otomatis menolak *input* yang tidak valid untuk mencegah *vandalism* perangkat lunak.
- Selalu menampilkan kode QR yang berotasi (untuk alasan keamanan).

## 2. Alur Otentikasi Mesin (QR Token Rotation)

Untuk mencegah pengguna men-scan QR code lama dari foto, Kiosk menerapkan sistem **QR Token Rotation**:
1. Setiap sekian detik (default: 30 detik), Kiosk akan meminta token baru ke backend.
2. Backend menghasilkan `qrToken` baru dan menyimpannya di tabel `Machine`.
3. Kiosk merender QR Code yang mengarah ke `https://[domain]/scan?m=[machineCode]&t=[qrToken]`.
4. Jika User men-scan QR code tersebut menggunakan aplikasi *mobile*, backend memvalidasi apakah `t` (token) masih berlaku dan sama dengan yang ada di database.
5. Jika valid, mesin menerima lease sesi. Pintu mesin (*chamber*) hanya terbuka bila seluruh interlock keselamatan lokal aman (lihat bagian 4); lease yang valid tidak pernah mengalahkan interlock.

## 3. Realtime Gateway (WebSocket)

Kiosk tidak mengandalkan *polling* lambat ke database untuk mengetahui apakah sebuah barang telah dimasukkan ke dalam mesin.
Sistem menggunakan **Realtime Gateway** berbasis Node.js yang berjalan di port terpisah.

**Cara menjalankan (di server):**
```bash
npm run realtime
```

**Alur Kerja Realtime:**
1. RVM Hardware (sensor) mendeteksi botol, menimbangnya, dan mengenali jenisnya menggunakan AI Camera.
2. Hardware mengirim *payload* HMAC-SHA256 ke *endpoint* internal `/api/machine-events`. Event hanya dihapus dari antrean mesin setelah server menjawab `accepted`/`duplicate` per event (protokol v2); event yang ditolak permanen tersimpan sebagai dead-letter dan dapat dikirim ulang dari panel maintenance. Saat upgrade, deploy backend lebih dulu, lalu runtime mesin (yang mem-backup database outbox sebelum migrasi). Rincian: [`rvm/README.md`](../rvm/README.md#sinkronisasi-event-protokol-v2-retry-dan-dead-letter).
3. Backend memproses data tersebut (memasukkan `DepositItem` ke database), lalu meneruskan notifikasi lewat WebSocket (menggunakan koneksi `realtime`).
4. Kiosk yang terbuka di layar mesin otomatis merespons melalui WebSocket, memunculkan animasi botol masuk dan menambahkan poin di layar secara instan tanpa perlu memuat ulang (*refresh*) halaman.

## 4. Interlock Keselamatan dan Uji Penerimaan Teknisi

Runtime RVM (`rvm/`) menolak membuka input gate, conveyor dan compactor selama service panel atau pintu kolektor terbuka, suhu/getaran melewati batas, kamera aktif offline/tertutup, bin penuh, mesin dalam mode maintenance, atau safety latch (`SAFE_STATE`) masih aktif. Sesi hanya dimulai dari mesin yang berhenti: sebelum gate terbuka untuk pengguna, seluruh output dimatikan lebih dulu, dan bila stop itu gagal mesin ter-latch (`OUTPUT_STOP_FAILED`) dan lease ditolak. Jog gate/conveyor/compactor dari panel maintenance hanya diterima saat state `MAINTENANCE` (`ENTER_MAINTENANCE` dari superadmin). Latch hanya dilepas oleh `RESET_ALERT` superadmin atau `reset-safe-state` maintenance, dan keduanya ditolak selama kondisi belum aman. Kontrak lengkap ada di [`rvm/README.md`](../rvm/README.md#interlock-keselamatan-dan-safety-latch).

> **Status: uji penerimaan hardware BELUM DILAKSANAKAN.** Perilaku di atas baru dibuktikan dengan mock hardware (`tests/test_rvm_safety.py`). Perubahan perilaku mesin tidak boleh dirilis ke armada sebelum prosedur berikut lulus pada mesin fisik dan bukti tersimpan.

### Persiapan

- Mesin di fixture/bench yang aman: tidak ada pengguna, area gerak conveyor/compactor tertutup, operator di luar zona jepit, dan tombol E-stop fisik (jika ada) dapat dijangkau.
- `hardware_driver` = `gpio`, konfigurasi kamera sama dengan konfigurasi produksi; catat kode mesin, commit runtime, dan peta pin (tanpa secret).
- Pasang indikator yang dapat diamati untuk setiap output (LED/relay indicator atau multimeter) dan rekam video setiap langkah.
- Gunakan sesi uji dari server staging, bukan sesi pengguna produksi.

### Langkah uji (setiap langkah: catat waktu, aksi, hasil yang diharapkan, hasil teramati)

1. **Boot dan crash.** Nyalakan ulang mesin: gate tertutup, conveyor dan compactor mati sebelum maupun sesudah runtime start. Matikan daya saat item diproses: setelah boot mesin masuk `SAFE_STATE` (`POWER_LOSS_MID_ITEM`) dan semua output mati.
2. **Service panel.** Saat sesi aktif dan gate terbuka, buka panel: gate menutup dan conveyor/compactor berhenti dalam satu tick (≤100 ms, ukur dari video). Biarkan panel terbuka ≥10 detik: output tetap mati. Selama panel terbuka, scan QR sesi baru (harus ditolak), coba jog gate/conveyor/compactor dari panel maintenance (harus `Aktuator ditolak: mesin belum dalam mode maintenance`; setelah `ENTER_MAINTENANCE` harus `Aktuator ditolak: service panel masih terbuka`), lalu kirim `RESET_ALERT` (harus `Reset ditolak`).
3. **Pintu kolektor.** Ulangi langkah 2 dengan pintu kolektor.
4. **Suhu dan getaran.** Picu sensor suhu (dan MPU6050 bila terpasang) melewati batas: mesin ter-latch, lease ditolak, reset ditolak sampai nilai kembali normal.
5. **Kamera** (bila `camera_enabled`). Tutup lensa, lalu cabut kamera: mesin ter-latch; lease dan reset ditolak sampai kamera kembali online dan tidak tertutup.
6. **Bin penuh dan maintenance.** Isi bin melewati `max_fill_percent`: state `FULL`, lease ditolak. Saat `IDLE`, coba jog gate/conveyor/compactor dari panel maintenance: harus `Aktuator ditolak: mesin belum dalam mode maintenance` dan output tetap mati. Dari superadmin kirim `ENTER_MAINTENANCE`: lease ditolak; jog output hanya berhasil bila panel dan pintu tertutup. Biarkan conveyor dan compactor berjalan dari jog, kirim `RESUME_OPERATION` (keduanya harus berhenti), lalu scan QR sesi baru: gate terbuka dengan conveyor dan compactor tetap mati. Ulangi dengan conveyor/compactor dinyalakan langsung dari relay (bukan lewat runtime) saat `IDLE`, lalu scan QR: keduanya harus berhenti sebelum gate terbuka (ukur dari video).
7. **Sesi server saat ter-latch.** Saat `SAFE_STATE`, akhiri sesi, buat sesi baru, dan biarkan lease kedaluwarsa dari server: mesin tetap `SAFE_STATE`, alert tetap tampil, output tetap mati.
8. **Jaringan putus.** Cabut uplink jaringan saat sesi aktif: membuka panel tetap langsung mematikan output, dan menutup gate/menghentikan conveyor/compactor dari panel maintenance lokal tetap berfungsi. Sambungkan kembali, buka gate dalam sesi aktif, lalu kirim `STOP_ALL`: seluruh output berhenti. Ulangi saat `SYNC_NOW` dengan antrean bukti kamera sedang berjalan dan catat waktu sampai output berhenti. Catatan: server memberikan `STOP_ALL` lebih dulu dari perintah lain, tetapi mesin memproses perintah remote satu per satu, sehingga `STOP_ALL` yang tiba saat `SYNC_NOW`/`CAPTURE_SNAPSHOT` berjalan dapat menunggu hingga ±55 detik (rincian di `rvm/README.md`); untuk penghentian darurat gunakan E-stop fisik atau panel maintenance lokal.
9. **Reset.** Tutup semua pintu, kondisi normal, kirim `RESET_ALERT`: mesin kembali `IDLE` (atau `SESSION_ACTIVE` dengan gate terbuka bila sesi masih aktif). Pastikan reset hanya bisa dilakukan oleh superadmin atau teknisi ber-PIN.

### Bukti yang wajib disimpan

- Video per langkah dan tabel hasil (diharapkan vs teramati) untuk gate, conveyor dan compactor.
- Ekspor tabel `audit` SQLite mesin selama pengujian (`STATE_CHANGED`, `INPUT_GATE_OPENED`, `ACTUATION_BLOCKED`, `REMOTE_COMMAND_EXECUTED`, `MAINTENANCE_COMMAND`) dan event outbox `SAFE_STATE_ENTERED`.
- Tanda tangan teknisi dan reviewer. Bukti ini menjadi syarat gate rilis; temuan SEC-02 tidak boleh ditandai selesai/dirilis sebelum bukti ini lengkap.
