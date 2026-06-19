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
