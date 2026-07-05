# Kontrak API ReLoop Mobile

Aplikasi native menggunakan seluruh route `/api/*` web yang sudah ada. Session
disimpan dalam cookie `reloop_session` selama tujuh hari dan setiap endpoint
tetap menerapkan RBAC serta scope organisasi/kemitraan di server.

Endpoint tambahan untuk data yang sebelumnya hanya dibaca langsung oleh Server
Component:

| Endpoint | Peran | Fungsi |
| --- | --- | --- |
| `GET /api/mobile/overview` | Semua role | Ringkasan dashboard sesuai role |
| `GET /api/mobile/map` | Semua role | Mesin berkoordinat dan campaign publik; pengepul dibatasi mitra aktif |
| `GET /api/mobile/audit-security` | Superadmin | Audit log, security event, dan ringkasan alert |

Kelompok endpoint existing yang dipakai:

- Auth: `/api/auth/login`, `/register`, `/me`, `/logout`
- User: `/api/user/dashboard`, `/api/scan`, `/api/sessions/:id`,
  `/api/wallet`, `/api/payout-accounts`, `/api/redemptions`, `/api/trips`
- Operasional: `/api/machines`, `/api/pickups`, `/api/partnerships`,
  `/api/campaigns`, `/api/waste-types`, `/api/reward-rates`
- Superadmin: `/api/organizations`, `/api/users`, `/api/regions`,
  `/api/config`, `/api/reports`

Machine ingestion `/api/machine-events` tetap khusus perangkat RVM dengan
HMAC-SHA256 dan tidak digunakan aplikasi pengguna.

## Strategi Caching & Offline (Khusus Pengepul)

Mengingat **Pengepul** sering beroperasi di area dengan konektivitas rendah saat melakukan pengambilan (*pickup*) dari mesin RVM atau tempat wisata, aplikasi seluler dirancang untuk mendukung *Offline Tolerance* secara terbatas:

1. **Hive Storage**: Data kritis seperti profil pengepul, daftar tugas *pickup* yang di-*assign* kepadanya, dan tarif dasar disimpan (di-cache) di lokal menggunakan package `hive_flutter`.
2. **Sinkronisasi Optimistis**: Jika pengepul menekan tombol "Collect" saat *offline*, aplikasi akan menyimpan instruksi API tersebut ke antrean lokal (Local Queue).
3. **Auto-Sync**: Saat `ConnectivityProvider` mendeteksi kembalinya sinyal internet, aplikasi akan mengeksekusi ulang permintaan-permintaan yang tertunda di antrean ke *endpoint* `/api/pickups/...`.
