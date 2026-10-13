# ReLoop RVM Edge Runtime

Runtime produksi untuk Reverse Vending Machine. Berjalan lokal, tetap aktif
tanpa internet, memakai SQLite WAL sebagai durable state/outbox, dan
menyinkronkan event ke ReLoop API secara batch saat koneksi tersedia.

## Fitur

- State machine mesin dan session lease.
- Durable event outbox dengan ACK per event (protokol v2), retry exponential
  backoff ≤ 60 s + jitter, dan dead-letter yang terlihat operator (lihat bawah).
- Local kiosk/API hanya pada loopback.
- Sensor abstraction: mock/simulator dan Raspberry Pi GPIO.
- Kamera OpenCV opsional: health, occlusion, blur, motion/impact evidence.
- Fraud rules: reverse motion, retrieval/string-pull, impossible sequence,
  duplicate acceptance, abnormal weight.
- Vandalism rules: forced door/panel, high vibration, camera covered/offline.
- Safe-state mematikan actuator sebelum event dikirim.
- Interlock keselamatan lokal selalu mengalahkan lease server (lihat bawah).
- Maintenance tersembunyi dan dilindungi PIN.

## Interlock keselamatan dan safety latch

Lease server yang valid **tidak pernah** dapat membuka output selama kondisi
keselamatan lokal aktif. Kontraknya:

- **Guard per output.** Setiap pembukaan input gate, conveyor dan compactor
  (aktivasi lease, `OPEN_GATE`, `RESUME_OPERATION`, reset, gate dibuka ulang
  setelah item ditolak, conveyor/compactor saat item diterima, serta jog di
  panel maintenance) membaca sensor terbaru lalu memeriksa interlock dan
  menulis output dalam satu critical section di bawah RLock controller
  (`RvmController.try_open_input_gate(reason)`,
  `RvmController.actuation_block_reason(snapshot)`). Loop kontrol memegang
  lock yang sama untuk setiap tick, sehingga sensor tidak dapat diproses di
  antara pemeriksaan dan penulisan output.
- **Item tidak dikreditkan bila conveyor ditolak.** Jika interlock menolak
  conveyor di titik penerimaan, mesin mengirim `ITEM_REJECTED`
  (`reason: ACTUATION_BLOCKED`, `blockedBy: <alasan>`) dan tidak pernah
  mengirim `ITEM_ACCEPTED_POINT` maupun menjalankan compactor untuk item itu.
- **Kondisi yang memblokir:** gangguan output yang belum teratasi (stop
  terakhir gagal), service panel atau pintu kolektor terbuka,
  suhu ≥ `max_temperature_c`, getaran ≥ `vibration_threshold_g`, kamera
  tidak memenuhi syarat (kamera aktif harus online dan tidak tertutup; hanya
  `MockHardware` yang mensimulasikan sinyal kamera), state `SAFE_STATE`,
  `MAINTENANCE` atau `FULL`, isi bin ≥ `max_fill_percent`, dan safety latch
  aktif (`safe_reason` tersimpan atau alert `CRITICAL`). Jika diblokir, semua
  output dimatikan dan `activate_lease` mengembalikan `False` tanpa menyimpan
  lease atau mengubah state/latch.
- **Sesi dimulai dari mesin yang berhenti.** `activate_lease` memanggil
  `all_stop()` di critical section yang sama dengan pemeriksaan interlock dan
  pembukaan gate, sehingga output yang masih berjalan (jog yang tertinggal,
  relay yang menyangkut, penulis asing) berhenti sebelum gate terbuka untuk
  pengguna. Jika stop itu gagal, mesin ter-latch `OUTPUT_STOP_FAILED` (lihat
  bawah) dan lease ditolak tanpa disimpan.
- **Jog maintenance** (PIN: buka gate, jalankan conveyor, nyalakan compactor)
  hanya diterima saat state `MAINTENANCE` (masuk lewat `ENTER_MAINTENANCE`
  superadmin). Di state lain jog ditolak (`Aktuator ditolak: mesin belum dalam
  mode maintenance`) tanpa mengubah output atau sesi yang sedang berjalan. Di
  `MAINTENANCE` jog tetap ditolak (`Aktuator ditolak: …`) selama ada bahaya
  fisik (panel/pintu terbuka, suhu, getaran) atau latch aktif. Perintah
  tutup/stop tidak memerlukan `MAINTENANCE` (lihat "Menutup/menghentikan
  selalu boleh").
- **Level-triggered.** Panel/pintu yang terbuka me-latch `SAFE_STATE` pada
  setiap tick selama mesin belum ter-latch, bukan hanya saat transisi
  tertutup→terbuka. Selama `SAFE_STATE` atau selama ada bahaya fisik, setiap
  tick kembali mematikan seluruh output. Alert tidak diulang per tick.
- **Latch hanya dilepas operator.** `RESET_ALERT` (superadmin) dan
  `reset-safe-state` (maintenance) menolak reset selama kondisi belum aman.
  Akhir sesi, pembaruan lease, sesi baru, dan lease kedaluwarsa dari server
  tidak mengubah `SAFE_STATE`/`MAINTENANCE`/`FULL` menjadi `IDLE`, tidak
  menghapus alert keselamatan, dan tidak membuka output. Selama `safe_reason`
  tersimpan, `SAFE_STATE` hanya dapat ditinggalkan lewat reset operator
  (transisi lain ditolak dan dicatat sebagai `STATE_CHANGE_SUPPRESSED`; masuk
  `MAINTENANCE` tetap boleh dan latch tetap aktif), alert `CRITICAL` tidak
  pernah ditimpa alert peringatan (fraud, kamera blur), dan heartbeat
  melaporkan status `ERROR` selama latch aktif.
- **Menutup/menghentikan selalu boleh.** `CLOSE_GATE`, `STOP_ALL`, dan perintah
  maintenance yang menutup/mematikan output tidak melewati guard. Jika menutup
  atau menghentikan satu output gagal (`CLOSE_GATE`, perintah maintenance
  tutup/stop, maupun penutupan di dalam proses item), mesin ter-latch di
  `SAFE_STATE` (`OUTPUT_STOP_FAILED`), seluruh output dihentikan dan dicoba
  ulang setiap tick, lalu error dilaporkan ke pemanggil. `RESUME_OPERATION`
  hanya keluar dari maintenance setelah `all_stop()` berhasil; jika gagal,
  perintah ditolak dan mesin ter-latch.
- **Tidak menunggu jaringan.** `STOP_ALL` dan masuk safe-state langsung
  mematikan output tanpa menunggu lock, lalu sekali lagi di bawah lock.
  `SYNC_NOW`, `CAPTURE_SNAPSHOT` dan polling sesi server berjalan di luar
  lock, sehingga server lambat/hang tidak menunda loop sensor. Hasil perintah
  remote tetap di-cache per `id` dan dilaporkan ulang tanpa eksekusi ulang.
- **Latensi `STOP_ALL` remote.** Server memberikan `STOP_ALL` yang tertunda
  sebelum perintah lain, termasuk perintah yang sudah `DISPATCHED`. Mesin
  memproses perintah remote satu per satu, jadi `STOP_ALL` yang tiba saat
  `SYNC_NOW`/`CAPTURE_SNAPSHOT` sedang berjalan menunggu perintah itu selesai.
  Durasinya dibatasi timeout HTTP yang ada: `SYNC_NOW` ≤ 5 s (batch event) +
  2 × 20 s (upload bukti kamera) = 45 s, `CAPTURE_SNAPSHOT` ≤ 40 s, lalu
  laporan hasil ≤ 5 s, jeda loop 2 s dan pengambilan perintah ≤ 3 s. Kasus
  terburuk ±55 s setelah `STOP_ALL` diantrikan; tanpa perintah I/O yang
  berjalan ±5 s. Timeout `urllib` berlaku per operasi socket, sehingga server
  yang mengirim data sangat lambat dapat memperpanjangnya, dan perintah remote
  kedaluwarsa setelah 60 s. Untuk penghentian darurat gunakan E-stop fisik
  atau panel maintenance lokal.
- **Boot/crash.** Output GPIO dibuat dalam keadaan mati (`initial_value=False`),
  `start()` memanggil `all_stop()`, dan sesi yang dipulihkan setelah restart
  tidak membuka gate secara otomatis. `all_stop()` GPIO tetap mematikan output
  lain walaupun salah satu output gagal ditulis.
- **Stop yang gagal selalu me-latch.** Setiap jalur yang mematikan seluruh
  output (safe state, tick saat ter-latch, bin penuh, lease kedaluwarsa, akhir
  sesi server, penolakan guard, fraud, reset, `STOP_ALL`, `ENTER_MAINTENANCE`,
  `RESUME_OPERATION`, start dan stop runtime) memakai stop yang sama, dan
  penutupan satu output me-latch dengan cara yang sama (lihat di atas). Jika
  `all_stop()` gagal, mesin langsung ter-latch di `SAFE_STATE` dengan alasan `OUTPUT_STOP_FAILED` (event
  `ERROR`, dan `SAFE_STATE_ENTERED` melaporkan `stopFailed: true` serta
  `outputsDisabled: []`), juga bila stop gagal saat masuk safe state karena
  alasan lain. Mesin tidak pernah dibiarkan
  `FULL`/`SYNC_PENDING`/`IDLE`/`SESSION_ACTIVE` dan dapat digerakkan, dan
  status `FULL` tidak dilaporkan bila stop-nya gagal. Selama gangguan belum
  teratasi, setiap tick mencoba stop lagi sampai berhasil, semua aktuasi
  (termasuk `activate_lease`) ditolak, dan `RESET_ALERT`/`reset-safe-state`
  ditolak (`output gagal dimatikan`). Setelah stop berhasil, latch tetap ada
  sampai reset operator yang tervalidasi. `STOP_ALL`, `ENTER_MAINTENANCE` dan
  `RESUME_OPERATION` yang stop-nya gagal dilaporkan gagal ke superadmin.
- **Error tidak mematikan loop.** Loop kontrol dan loop sesi mencatat error di
  log lalu berlanjut dengan backoff (kontrol ≤ 1 s, sesi ≤ 30 s). Error pada
  tick kontrol me-latch `SAFE_STATE` (`CONTROL_LOOP_ERROR`); bila mesin sudah
  ter-latch, alasan latch awal dipertahankan dan seluruh output dihentikan
  lagi.
- Audit lokal mencatat `INPUT_GATE_OPENED` dan `ACTUATION_BLOCKED` beserta
  alasannya.

Perilaku ini diuji dengan mock hardware di `tests/test_rvm_safety.py`.
**Uji penerimaan hardware oleh teknisi belum dilaksanakan** dan wajib lulus
sebelum rollout armada; prosedurnya ada di
[`docs/kiosk-setup-guide.md`](../docs/kiosk-setup-guide.md#4-interlock-keselamatan-dan-uji-penerimaan-teknisi).

## Sinkronisasi event: protokol v2, retry dan dead-letter

Setiap event mesin masuk outbox SQLite (`outbox`) dengan `localEventId` unik
dan dikirim batch ke `POST /api/machine-events` (HMAC). Respons protokol v2
(kontrak bersama: `tests/fixtures/contracts/machine-events.v2.json`):

```json
{ "protocolVersion": 2, "received": 3, "results": [
  { "localEventId": "…", "status": "accepted", "eventId": "…" },
  { "localEventId": "…", "status": "duplicate", "eventId": "…" },
  { "localEventId": "…", "status": "error", "error": "TEMPORARY_FAILURE", "retryable": true }
] }
```

- **ACK hanya untuk yang tercatat.** Batch yang valid selalu HTTP 200; mesin
  hanya menandai `sent` event yang hasilnya `accepted`/`duplicate` dan
  `localEventId`-nya cocok dengan yang dikirim. Server baru menjawab
  `accepted` setelah event beserta reward-nya commit dalam satu transaksi.
- **Retry dengan ID yang sama.** Error tanpa `retryable: false` (termasuk
  error tanpa field `retryable`, item yang hilang/rusak, JSON rusak, HTTP
  non-2xx, timeout) tetap `pending` dengan backoff `min(60, 2^attempts)`
  detik dan jitter (50–100 % dari nilai itu, tidak pernah > 60 s). Retry
  memakai `localEventId` yang sama, sehingga respons yang hilang setelah
  commit dijawab `duplicate` tanpa reward kedua. Pengiriman bersamaan event
  yang sama juga dijawab `duplicate` (server membaca ulang event pemenang
  setelah benturan unique).
- **Dead-letter.** `retryable: false` (`INVALID_EVENT`: event tidak dikenali;
  `EVENT_REJECTED`: ditolak aturan/data) memindahkan event ke
  `delivery_status = 'dead_letter'`. Baris tidak pernah dihapus atau diubah,
  dan tidak dikirim lagi sampai teknisi mengirim ulang.
- **Respons yang tidak dipercaya ditolak utuh.** Respons tanpa
  `protocolVersion: 2` (termasuk respons backend lama v1), `results` yang
  bukan daftar, atau ID asing/ganda tidak meng-ACK apa pun; seluruh batch tetap
  `pending`.
- **Event racun tidak menahan antrean.** Backoff berlaku per event, jadi event
  yang terus gagal tidak menghalangi event lain. Bila server menolak seluruh
  batch (HTTP 400/413/422), mesin mengirim satu event per batch selama 5 menit
  agar event penyebabnya hanya menahan dirinya sendiri. Penolakan level HTTP
  tidak pernah men-dead-letter event (server bisa jadi yang salah).
- **Urutan per sesi.** Backend menentukan item sebuah event dari riwayat sesi,
  jadi event sebuah sesi ditahan selama event sebelumnya dari sesi yang sama
  masih menunggu retry (di mesin) dan dijawab `TEMPORARY_FAILURE` dalam batch
  yang sama setelah event sebelumnya gagal sementara (di server). Sesi lain dan
  event tanpa sesi tetap berjalan; event yang di-dead-letter tidak menahan sesi.
- **Batas waktu tetap.** Satu `flush_once` tetap satu request HTTP dengan
  timeout 5 s, sehingga angka latensi `STOP_ALL` di atas tidak berubah.
- **Loop sinkronisasi tidak pernah berhenti.** Body respons yang terpotong
  (`IncompleteRead`) diperlakukan seperti respons hilang, item dengan `status`
  bukan string dianggap rusak (tetap `pending`), dan setiap langkah loop
  (event, bukti kamera, media) dijaga: error tak terduga dicatat di log dan
  `lastError`, lalu dicoba lagi pada iterasi berikutnya.

**Tampilan operator.** Panel maintenance kiosk (PIN) menampilkan jumlah event
menunggu, yang ditolak permanen (jenis, alasan, jumlah percobaan) dan waktu
sinkron terakhir yang berhasil; tombol **Kirim ulang event ditolak**
(`retry-dead-letter`, wajib token maintenance; tanpa `ids` = semua, atau
`ids` berupa daftar ID outbox positif, selain itu ditolak 422) mengembalikan event ke antrean
dengan `localEventId` dan payload yang sama, menyimpan riwayat `attempts` dan
`last_error`, dan mencatat audit `OUTBOX_DEAD_LETTER_RETRY`. Heartbeat
membawa `queueDepth`, `deadLetterDepth` dan `lastSyncSuccessAt`, yang tampil di
dashboard admin/superadmin pada tab **Sinkronisasi** detail mesin.

### Upgrade outbox dan urutan rollout

1. **Deploy backend dulu.** Respons v2 bersifat aditif (`protocolVersion` dan
   `retryable` baru; `received`/`results` tetap), jadi worker lama tetap
   berjalan.
2. **Baru kemudian worker mesin.** Worker v2 menolak respons v1 tanpa
   menghapus antrean; bila backend belum v2, event menumpuk `pending` sampai
   backend di-upgrade.
3. **Upgrade database otomatis saat start, dengan backup lebih dulu.** Bila
   tabel `outbox` belum punya `delivery_status`, runtime menyalin database
   (SQLite backup API, termasuk isi WAL) ke
   `<database>.pre-outbox-v2-<UTC>.bak`, memverifikasi `integrity_check` dan
   jumlah baris outbox, lalu dalam satu transaksi menambah kolom
   `delivery_status` (`pending`/`sent`/`dead_letter`) dan `dead_lettered_at`,
   mengisi `sent` untuk baris yang sudah punya `sent_at`, dan membuat index
   baru. Kolom `attempts`, `next_attempt_at`, `last_error` dan seluruh baris
   pending dipertahankan. Bila backup gagal diverifikasi, runtime berhenti
   tanpa mengubah database. Simpan file `.bak` sampai mesin terbukti sinkron
   normal.

## Kamera, deteksi orang, dan bukti wajah

Runtime kamera memakai OpenCV sepenuhnya lokal. Haar cascade bawaan OpenCV
mendeteksi wajah untuk membuat crop, sedangkan HOG person detector memberi sinyal
kehadiran orang. Sistem tidak melakukan pengenalan atau pencocokan identitas.

Aktifkan pada mesin yang memiliki webcam:

```json
{
  "camera_enabled": true,
  "camera_index": 0,
  "camera_face_detection_enabled": true,
  "camera_person_detection_enabled": true,
  "camera_capture_session_start": true,
  "camera_capture_security_events": true,
  "camera_retention_days": 30,
  "camera_max_local_captures": 1000
}
```

Scene dan crop wajah disimpan di `camera_evidence_dir`, lalu masuk antrean
durable untuk upload HMAC ke server. Salinan server berada di storage privat dan
hanya dapat dibuka oleh SUPERADMIN melalui detail mesin. Frame startup diberi
masa pemanasan dan anomali harus muncul beberapa frame berturut-turut untuk
mencegah alarm kamera tertutup yang palsu.

## Menjalankan

```powershell
Copy-Item rvm\config.example.json rvm\config.local.json
# isi machine_secret dan maintenance_pin_hash
```

Secara default, aplikasi berjalan di environment `dev` (menggunakan konfigurasi standar):
```powershell
python -m rvm.main --config rvm/config.local.json
```

Untuk menjalankan di environment `prod`, set dahulu `RVM_SERVER_URL` dan
`RVM_MACHINE_SECRET` sebagai environment variable (jangan pernah menaruh
secret produksi di source code), lalu gunakan flag `--env prod`:

```powershell
$env:RVM_SERVER_URL="https://your-server.example.com"
$env:RVM_MACHINE_SECRET="<secret-mesin-dari-superadmin>"
python -m rvm.main --env prod
```

Atau set `RVM_ENV=prod` sekaligus kedua variabel di atas melalui secret
manager pada mesin deploy:

```powershell
$env:RVM_ENV="prod"
$env:RVM_SERVER_URL="https://your-server.example.com"
$env:RVM_MACHINE_SECRET="<secret-mesin-dari-superadmin>"
python -m rvm.main
```

Proses akan gagal start (`SystemExit`) jika `--env prod` dipakai tanpa kedua
variabel tersebut. Jika secret produksi lama pernah tercatat di source
control, rotasi melalui **Superadmin → Mesin → Detail → Rotate Secret**
sebelum melanjutkan deploy.

Kiosk: `http://127.0.0.1:8765`

Simulator trigger terpisah:

```powershell
python tools/rvm_trigger_simulator.py --scenario normal-bottle
python tools/rvm_trigger_simulator.py --scenario string-pull
python tools/rvm_trigger_simulator.py --scenario vandalism-impact
```

Simulator interaktif tersedia di panel maintenance jika
`hardware_driver` bernilai `mock`. Buka kiosk, tekan
`Ctrl+Alt+Shift+R`, masukkan PIN maintenance, lalu pilih skenario.
Kontrol simulator otomatis disembunyikan pada mesin GPIO fisik.

Lihat `deploy/` untuk service Windows/Linux dan launcher Chromium.


## Playlist iklan lokal

Superadmin dapat membuka detail mesin lalu memilih **Playlist Iklan RVM** untuk mengunggah JPG, PNG, WebP, MP4, atau WebM. Playlist terikat ke satu mesin dan dapat diaktifkan, dimatikan, atau diurutkan secara terpisah.

RVM memeriksa manifest bertanda tangan setiap `media_sync_seconds` (default 30 detik), mengunduh file ke `media_cache_dir`, lalu memverifikasi ukuran dan SHA-256 sebelum mengganti playlist aktif. Media tetap dapat diputar saat koneksi server terputus. Batas total cache diatur melalui `media_max_cache_mb`.

Iklan hanya diputar saat mesin berstatus IDLE tanpa sesi dan tanpa alert. Jika playlist kosong/nonaktif, layar kembali ke tampilan QR standar.
