# ReLoop RVM Kiosk

Kiosk Chromium hanya merupakan UI. Semua keputusan hardware, session lease,
fraud detection, safe-state, SQLite, dan sinkronisasi dijalankan oleh
`rvm.main`.

## Persiapan

```powershell
Copy-Item rvm\config.example.json rvm\config.local.json
```

Isi minimal:

- `machine_code`
- `server_url`
- `machine_secret`
- `maintenance_pin_hash`

Hash PIN:

```powershell
python -c "from rvm.config import RvmConfig; print(RvmConfig.hash_pin('PIN_ANDA'))"
```

## Windows

```powershell
.\kiosk\launch-kiosk.ps1
```

## Linux/Raspberry Pi

```bash
chmod +x kiosk/launch-kiosk.sh
./kiosk/launch-kiosk.sh
```

UI berjalan di `http://127.0.0.1:8765` dan tetap tersedia tanpa internet.
Maintenance tidak disebutkan di layar; teknisi membuka dialog menggunakan
shortcut rahasia yang didokumentasikan hanya untuk operator.
