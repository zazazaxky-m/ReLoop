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

## Arsitektur

- **State Management**: Menggunakan `Provider` untuk state global (seperti `AuthProvider`, `ConnectivityProvider`).
- **Routing**: Menggunakan `go_router` untuk navigasi berbasis URL dan perlindungan rute dinamis (RBAC redirect).
- **API Client**: Menggunakan `Dio` dengan *Cookie Manager* untuk memelihara sesi JWT antara Flutter dan Next.js.
- **Penyimpanan Lokal**: Menggunakan `flutter_secure_storage` untuk data sensitif dan `hive` untuk *caching* *offline* (seperti profil Pengepul).

## Environment Variables

Aplikasi menggunakan paket `flutter_dotenv` untuk memuat URL backend sesuai *environment*. Tersedia file:
- `.env.development`
- `.env.staging`
- `.env.production`
- `.env.test`

Secara *default*, menjalankan `flutter run` tanpa argumen akan membaca `.env.development`.
Untuk build *production*, **wajib** menyertakan flag `--dart-define=BUILD_ENV=production`
(lihat bagian Build di bawah) — tanpa flag ini, aplikasi tetap default ke environment
development demi mencegah build lupa-flag diam-diam menembak API production.

## Setup Firebase

Push notification (`firebase_messaging`), analytics, dan crash reporting
membutuhkan konfigurasi Firebase native yang **tidak disertakan di repo**
(berisi kredensial per-project). Tanpa berkas ini, `Firebase.initializeApp()`
gagal secara diam-diam dan semua layanan terkait (notifikasi push, analytics,
crashlytics) menjadi no-op — aplikasi tetap berjalan normal, hanya fitur
tersebut yang tidak aktif.

Untuk mengaktifkannya:

1. Buat project di [Firebase Console](https://console.firebase.google.com/)
   dan tambahkan app Android (`id.reloop.reloop_mobile`) serta iOS
   (`id.reloop.reloopMobile`).
2. Android: unduh `google-services.json`, letakkan di
   `mobile/android/app/google-services.json`.
3. iOS: unduh `GoogleService-Info.plist`, letakkan di
   `mobile/ios/Runner/GoogleService-Info.plist`, lalu tambahkan ke target
   Runner melalui Xcode.
4. Jalankan `flutterfire configure` (paket `flutterfire_cli`) bila ingin
   men-generate `lib/firebase_options.dart` sekaligus untuk kedua platform.
5. Aktifkan Cloud Messaging, Analytics, dan Crashlytics pada project Firebase
   tersebut sesuai kebutuhan.

Berkas-berkas di atas kini di-*gitignore* (lihat `mobile/.gitignore`) — jangan
commit kredensial Firebase ke repository publik.

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

Sertakan `--dart-define=BUILD_ENV=production` agar aplikasi memuat `.env.production`
alih-alih default development:

```powershell
flutter build apk --release --dart-define=BUILD_ENV=production
flutter build appbundle --release --dart-define=BUILD_ENV=production
```

Build iOS harus dijalankan di macOS:

```bash
flutter build ios --release --dart-define=BUILD_ENV=production
```

Lanjutkan signing/archive melalui Xcode dengan bundle id
`id.reloop.reloopMobile`.
