# ReLoop RVM Edge Runtime

Runtime produksi untuk Reverse Vending Machine. Berjalan lokal, tetap aktif
tanpa internet, memakai SQLite WAL sebagai durable state/outbox, dan
menyinkronkan event ke ReLoop API secara batch saat koneksi tersedia.

## Fitur

- State machine mesin dan session lease.
- Durable event outbox + retry exponential backoff.
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
- **Kondisi yang memblokir:** service panel atau pintu kolektor terbuka,
  suhu ≥ `max_temperature_c`, getaran ≥ `vibration_threshold_g`, kamera
  tidak memenuhi syarat (kamera aktif harus online dan tidak tertutup; hanya
  `MockHardware` yang mensimulasikan sinyal kamera), state `SAFE_STATE`,
  `MAINTENANCE` atau `FULL`, isi bin ≥ `max_fill_percent`, dan safety latch
  aktif (`safe_reason` tersimpan atau alert `CRITICAL`). Jika diblokir, semua
  output dimatikan dan `activate_lease` mengembalikan `False` tanpa menyimpan
  lease atau mengubah state/latch.
- **Jog maintenance** (PIN) tetap boleh di mode `MAINTENANCE`, tetapi
  ditolak (`Aktuator ditolak: …`) selama ada bahaya fisik (panel/pintu
  terbuka, suhu, getaran) atau latch aktif.
- **Level-triggered.** Panel/pintu yang terbuka me-latch `SAFE_STATE` pada
  setiap tick selama mesin belum ter-latch, bukan hanya saat transisi
  tertutup→terbuka. Selama `SAFE_STATE` atau selama ada bahaya fisik, setiap
  tick kembali mematikan seluruh output. Alert tidak diulang per tick.
- **Latch hanya dilepas operator.** `RESET_ALERT` (superadmin) dan
  `reset-safe-state` (maintenance) menolak reset selama kondisi belum aman.
  Akhir sesi, pembaruan lease, sesi baru, dan lease kedaluwarsa dari server
  tidak mengubah `SAFE_STATE`/`MAINTENANCE`/`FULL` menjadi `IDLE`, tidak
  menghapus alert keselamatan, dan tidak membuka output.
- **Menutup/menghentikan selalu boleh.** `CLOSE_GATE`, `STOP_ALL`, dan perintah
  maintenance yang menutup/mematikan output tidak melewati guard.
- **Tidak menunggu jaringan.** `STOP_ALL` dan masuk safe-state langsung
  mematikan output tanpa menunggu lock, lalu sekali lagi di bawah lock.
  `SYNC_NOW`, `CAPTURE_SNAPSHOT` dan polling sesi server berjalan di luar
  lock, sehingga server lambat/hang tidak menunda loop sensor. Hasil perintah
  remote tetap di-cache per `id` dan dilaporkan ulang tanpa eksekusi ulang.
  Batasan: server mengirim perintah remote satu per satu (FIFO), jadi
  `STOP_ALL` yang antre di belakang `SYNC_NOW`/`CAPTURE_SNAPSHOT` tetap
  menunggu perintah itu selesai; ini batasan protokol antrean server, bukan
  lock mesin.
- **Boot/crash.** Output GPIO dibuat dalam keadaan mati (`initial_value=False`),
  `start()` memanggil `all_stop()`, dan sesi yang dipulihkan setelah restart
  tidak membuka gate secara otomatis. `all_stop()` GPIO tetap mematikan output
  lain walaupun salah satu output gagal ditulis.
- Audit lokal mencatat `INPUT_GATE_OPENED` dan `ACTUATION_BLOCKED` beserta
  alasannya.

Perilaku ini diuji dengan mock hardware di `tests/test_rvm_safety.py`.
**Uji penerimaan hardware oleh teknisi belum dilaksanakan** dan wajib lulus
sebelum rollout armada; prosedurnya ada di
[`docs/kiosk-setup-guide.md`](../docs/kiosk-setup-guide.md#4-interlock-keselamatan-dan-uji-penerimaan-teknisi).

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
