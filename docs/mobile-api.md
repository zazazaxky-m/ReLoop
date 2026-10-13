# Kontrak API ReLoop Mobile

Aplikasi native menggunakan seluruh route `/api/*` web yang sudah ada. Session
disimpan dalam cookie `reloop_session` selama tujuh hari (24 jam untuk ADMIN dan
SUPERADMIN) dan setiap endpoint
tetap menerapkan RBAC serta scope organisasi/kemitraan di server.

Endpoint tambahan untuk data yang sebelumnya hanya dibaca langsung oleh Server
Component:

| Endpoint | Peran | Fungsi |
| --- | --- | --- |
| `GET /api/mobile/overview` | Semua role | Ringkasan dashboard sesuai role (USER/ADMIN termasuk `tourismSummary`) |
| `GET /api/mobile/map` | Semua role | Mesin berkoordinat dan campaign publik; pengepul dibatasi mitra aktif (bukan layer trip wisata) |
| `GET /api/mobile/tourism-pickups` | PENGEPUL | Daftar trip `COMPLETED` siap pickup bank sampah (mitra aktif) |
| `GET /api/mobile/audit-security` | Superadmin | Audit log, security event, dan ringkasan alert |

Kelompok endpoint existing yang dipakai:

- Auth: `/api/auth/login`, `/register`, `/me`, `/logout`
- User: `/api/user/dashboard`, `/api/scan`, `/api/sessions/:id`,
  `/api/wallet`, `/api/payout-accounts`, `/api/redemptions`, `/api/trips`
- Trash bag / wisata: `/api/trips`, `/api/trips/:id`, `/api/trash-bags`,
  `/api/manual-validations`, `/api/travel-agents`, `/api/travel-agents/:id`
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


## Batas sesi dan verifikasi MFA (A01)

JWT sesi baru menggunakan HS256, issuer `reloop`, audience `reloop-session`, dan
`purpose=session`. Server serta proxy memvalidasi subject nonkosong, role yang
dikenal, name/email string, organizationId string/null, tokenVersion integer
nonnegatif, serta iat/exp numerik finite. Versi yang hilang tidak diberi nilai
bawaan. Guard API dan verifikator websocket membaca status dan tokenVersion
akun terkini dari database.

Login akun ber-MFA mengembalikan `requiresMfa=true` dan `challengeToken`, tanpa
menerbitkan cookie sesi. Challenge memakai audience `reloop-mfa`, `purpose=mfa`,
versi akun saat login, jti unik, dan masa berlaku lima menit. Challenge tidak
bisa dipakai sebagai cookie autentikasi, termasuk pada `/api/auth/me`, API
administrasi, dan verifikator websocket. `POST /api/auth/mfa/verify` baru
menerbitkan cookie sesi setelah kode benar, akun masih aktif, versi akun cocok,
dan challenge berhasil dikonsumsi satu kali. Pemakaian ulang dan challenge
lama setelah reset password ditolak dengan 401.

Kontrak internal `verifyMfaChallenge` menghasilkan
`{ userId, tokenVersion, challengeId, expiresAt }`; `expiresAt` adalah exp yang
sudah diverifikasi, dalam detik Unix. `consumeMfaChallenge(challengeId, expiresAt)`
memakai Redis `SET NX EXAT`, dengan namespace `mfa-consumed:`. Redis wajib di
production (Redis 7 sudah digunakan compose). Gangguan penyimpanan challenge
atau rate limiter pada verifikasi MFA menghasilkan 503; kuota percobaan yang
habis tetap 429. Penyimpanan memori hanya digunakan tanpa REDIS_URL di luar
production. Setelah gangguan sementara, koneksi dapat dicoba kembali.

Peluncuran harus mengganti web dan gateway realtime bersama-sama. JWT lama
sengaja ditolak tanpa jalur kompatibilitas: seluruh pengguna perlu login ulang
satu kali. Tidak ada migrasi skema atau backfill. Gateway realtime memerlukan
`REALTIME_WS_SESSION_URL` dan `REALTIME_INTERNAL_SECRET` untuk akses topik
privat; jika verifier tidak tersedia, topik publik tetap berjalan dan akses
privat ditolak. Fallback verifikasi JWT lokal sudah dihapus.

Pada mobile, `AuthProvider.checkSession()` menghapus pengguna aktif ketika
`/api/auth/me` mengembalikan 401; router mengarahkan pengguna tanpa sesi ke login.
Pesan pengguna: “Sesi Anda telah berakhir. Silakan masuk kembali.” Pemeriksaan
runtime Flutter dan peluncuran terkoordinasi tetap menjadi gate F01/U04/Z01;
A01 tidak menyatakan finding sudah RELEASED.
