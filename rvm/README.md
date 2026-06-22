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
- Maintenance tersembunyi dan dilindungi PIN.

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
python -m rvm.main --config rvm/config.local.json
```

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
