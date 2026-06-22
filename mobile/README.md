# ReLoop Mobile

Aplikasi Flutter untuk platform ReLoop. Satu codebase mendukung Android,
iPhone, iPad, serta tablet Android.

## Fitur

- Login, registrasi, dan pemulihan sesi berbasis cookie yang sama dengan web.
- Dashboard adaptif untuk USER, PENGEPUL, ADMIN, dan SUPERADMIN.
- Scan QR dinamis mesin dengan kamera native dan pemantauan sesi setor.
- Dompet reward, akun payout, dan pengajuan pencairan.
- Daftar mesin, kapasitas, material yang diterima, dan navigasi lokasi.
- Pickup, kemitraan, campaign, trip/trash bag, tarif, organisasi, pengguna,
  redemption, keamanan, audit, konfigurasi, dan laporan sesuai RBAC backend.
- Navigasi bawah untuk ponsel dan navigation rail untuk tablet.

## Menjalankan

```powershell
cd mobile
flutter pub get
flutter run
```

Alamat default Android Emulator adalah `http://10.0.2.2:3000`. Tekan tombol
server di layar login untuk menggantinya dengan URL deployment HTTPS. Untuk
iOS Simulator yang menjalankan backend di Mac yang sama, gunakan
`http://localhost:3000`.

## Build

```powershell
flutter build apk --release
flutter build appbundle --release
```

Build iOS harus dijalankan di macOS:

```bash
flutter build ios --release
```

Lanjutkan signing/archive melalui Xcode dengan bundle id
`id.reloop.reloopMobile`.
