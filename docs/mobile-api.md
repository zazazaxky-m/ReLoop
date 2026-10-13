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
HMAC-SHA256 dan tidak digunakan aplikasi pengguna. Sejak R02 responsnya
protokol v2 (`protocolVersion: 2`, satu hasil per event dengan `retryable`
pada error); kontraknya `tests/fixtures/contracts/machine-events.v2.json`
(dipakai bersama oleh test backend dan test worker Python) dan aturan ACK,
retry, dead-letter serta urutan rollout ada di
[`rvm/README.md`](../rvm/README.md#sinkronisasi-event-protokol-v2-retry-dan-dead-letter).

## Fixture kontrak DTO berversi (F01)

Respons yang dikonsumsi web dan mobile dibekukan sebagai fixture JSON berversi di
`tests/fixtures/contracts/<kontrak>.v<N>.json`. Backend memvalidasinya lewat
`tests/support/contracts.ts` (termasuk respons live di `npm run test:integration`),
dan Flutter mem-parse file yang sama dengan model `fromJson` asli di
`mobile/test/contracts/`. Fixture pertama: `scan-session.v1.json` untuk
`POST /api/scan` (201, dibaca `ScanResult.fromJson`). Penambahan field boleh;
menghapus, mengganti nama, atau mengubah tipe field wajib membuat versi baru.

## Pengajuan pencairan dan idempotency (M01)

`POST /api/redemptions` (role USER) menerima:

```json
{ "amount": 50000, "payoutAccountId": "<id akun pencairan>", "idempotencyKey": "<kunci unik per pengajuan>" }
```

- `amount` adalah rupiah bulat positif, maksimal 2.147.483.647. Pecahan, nol,
  negatif, string, dan nilai di luar batas ditolak 422 `Validasi gagal`
  (dengan `issues[].path = "amount"`) sebelum transaksi saldo dimulai.
- `idempotencyKey` berisi 1-80 karakter ASCII terlihat (tanpa spasi), misalnya
  UUID. Buat satu kunci untuk satu pengajuan yang dikonfirmasi pengguna,
  simpan, dan kirim ulang kunci yang sama pada setiap retry (timeout, respons
  hilang, ketukan ganda). Ubah jumlah atau akun berarti pengajuan baru dengan
  kunci baru.
- Kunci berlaku per pengguna. Kunci yang sama milik pengguna lain tidak pernah
  mengembalikan data mereka.
- Klien lama boleh sementara tidak mengirim `idempotencyKey`; server membuat
  kunci dan mengembalikannya agar retry tetap aman. Klien baru wajib mengirimnya.

Respons:

| Status | Arti |
| --- | --- |
| 201 | Pengajuan baru: `{ redemption, idempotent: false, idempotencyKey }` |
| 200 | Retry dengan kunci dan isi yang sama: pengajuan lama, `{ redemption, idempotent: true, idempotencyKey }` (tidak ada potongan saldo kedua) |
| 409 | Kunci sama tetapi jumlah/akun berbeda, atau akun pencairan dinonaktifkan |
| 404 | Akun pencairan tidak ditemukan atau bukan milik pengguna |
| 422 | Validasi gagal, di bawah minimum (`min_redemption`, bawaan Rp10.000), atau `Saldo tersedia tidak mencukupi` |
| 503 | Antrean saldo sibuk; tidak ada yang tersimpan, ulangi dengan kunci yang sama |

`idempotent` dan `idempotencyKey` adalah field tambahan; field `redemption`
tidak berubah. Saldo diperiksa dan dipotong (reserve `REDEEM/PENDING` dengan
business key `redemption:<id>:reserve`) dalam satu transaksi di bawah lock baris
pengguna, sehingga pengajuan paralel tidak dapat memakai saldo yang sama. Status
akun pencairan dibaca ulang di dalam transaksi tersebut. Audit ditulis setelah
commit; kegagalannya tidak mengubah respons pengajuan yang sudah tersimpan.

## Transisi pencairan, tujuan transfer, dan rekonsiliasi (M02)

`PATCH /api/redemptions/{id}` menerima:

```json
{ "action": "approve | process | success | fail | cancel | flag_reconciliation", "note": "opsional, maks 500", "providerReference": "opsional, maks 120" }
```

| Aksi | Peran | Dari status | Ke status | Saldo yang ditahan (reserve) |
| --- | --- | --- | --- | --- |
| `approve` | SUPERADMIN | REQUESTED | APPROVED | tetap ditahan |
| `process` | SUPERADMIN | APPROVED | PROCESSING | tetap ditahan |
| `success` | SUPERADMIN | PROCESSING | SUCCESS | menjadi `REDEEMED` (dibayar) |
| `fail` | SUPERADMIN | REQUESTED, APPROVED, PROCESSING | FAILED | menjadi `REVERSED` (kembali ke saldo) |
| `cancel` | USER pemilik, SUPERADMIN | REQUESTED | REVERSED | menjadi `REVERSED` |
| `flag_reconciliation` | SUPERADMIN, `note` wajib | PROCESSING | tetap PROCESSING | tetap ditahan |

- `success` memerlukan `providerReference` atau bukti transfer yang diunggah
  untuk pengajuan yang sama (`POST /api/redemptions/{id}/proof`).
- Status pengajuan dan reserve ledger berubah dalam satu transaksi di bawah lock
  User pemilik lalu Redemption, dengan compare-and-set pada status. Aksi yang
  saling bertentangan (misalnya `fail` dan `success`, atau `approve` dan
  `cancel`) yang dikirim bersamaan menghasilkan tepat satu 200 dan satu 409;
  pengajuan yang reserve-nya sudah dilepas tidak bisa dihidupkan lagi.
- `flag_reconciliation` dipakai bila operator tidak yakin transfer manual
  berhasil. Pengajuan tetap PROCESSING, saldo tetap ditahan, dan
  `reconciliationRequired=true` + `reconciliationNote` dicatat. Setelah hasilnya
  pasti, operator menandai `success`, atau `fail` dengan `note` wajib berisi
  hasil pengecekan (tanpa catatan: 422). Status gagal tidak pernah dipakai
  untuk transfer yang belum pasti. Mengulang `flag_reconciliation` dengan
  catatan yang sama bersifat idempotent; catatan berbeda ditolak 409.

Respons:

| Status | Arti |
| --- | --- |
| 200 | `{ redemption, idempotent: false }` untuk perubahan baru; `{ redemption, idempotent: true }` bila aksi yang sama diulang, ledger sudah sesuai, dan `providerReference`/`note` yang dikirim kosong atau sama dengan yang tersimpan (tanpa settlement, audit, atau notifikasi kedua) |
| 403 | Peran tidak boleh menjalankan aksi ini, atau USER membatalkan pengajuan orang lain |
| 404 | Pengajuan tidak ditemukan |
| 409 | `Status pencairan sudah berubah` (pengajuan sudah diputuskan lain), `Transisi status pencairan tidak valid`, reserve hilang/jumlah atau pemilik tidak sesuai (perlu rekonsiliasi tim keuangan), pemilik pengajuan berubah, tujuan transfer data lama tidak tersedia, atau pengulangan aksi dengan nomor referensi/catatan berbeda dari yang tersimpan (referensi lain bisa berarti transfer ganda; periksa dulu). Tidak ada perubahan yang tersimpan. |
| 422 | Validasi gagal, sukses tanpa referensi/bukti, atau gagal pada pengajuan yang sedang direkonsiliasi tanpa catatan |
| 503 | Antrean saldo sibuk; tidak ada yang tersimpan, ulangi aksi yang sama |

`idempotent` adalah field tambahan. Field `redemption` tetap sama, ditambah
`payoutDestinationSource`, `payoutDestinationProvider`,
`payoutDestinationCapturedAt`, `reconciliationRequired`, `reconciliationNote`,
dan `reconciliationFlaggedAt`. `requestHash` dan ciphertext tujuan tidak pernah
dikirim. Audit dan notifikasi ditulis setelah commit; kegagalannya tidak
mengubah respons dan retry tidak mengulang settlement.

**Tujuan transfer.** Saat pengajuan dibuat, akun pencairan yang dipilih disalin
ke pengajuan (provider, nomor, nama; nomor dan nama dienkripsi). Antrean,
`process`, `success`, dan unggah bukti memakai salinan ini, bukan akun yang
mungkin diubah atau dinonaktifkan pengguna sesudahnya. `GET /api/redemptions`
mengembalikan `payoutDestination`:

```json
{ "source": "REQUEST_SNAPSHOT", "provider": "DANA", "accountIdentifier": "08…", "accountName": "…", "capturedAt": "2026-10-13T…", "erased": false }
```

`erased: true` (dengan `accountIdentifier` dan `accountName` bernilai `null`)
berarti nomor dan nama tujuan sudah dihapus karena pemiliknya menghapus akun
(`DELETE /api/user/data`, A04). Penghapusan akun baru berjalan setelah semua
pengajuan pemilik selesai (SUCCESS, FAILED, REVERSED); selama masih ada
pengajuan yang berjalan, permintaan ditahan (`PENDING_RECONCILIATION`) dan
semua tujuan tetap tersimpan agar bisa dibayar atau direkonsiliasi. Pengajuan
lama tanpa salinan yang akunnya sudah dihapus juga tampil `erased: true`.

`source` bernilai `REQUEST_SNAPSHOT` (disalin saat pengajuan),
`LEGACY_ACCOUNT_FALLBACK` (pengajuan lama tanpa salinan: akun pemilik dicatat
pada aksi operator pertama yang memerlukan tujuan, yaitu `process`, `success`,
unggah bukti, atau `flag_reconciliation`; `capturedAt: null` berarti belum
tercatat dan yang tampil adalah akun saat ini), atau `LEGACY_UNAVAILABLE` (akun
pengajuan lama sudah tidak ada; nomor tidak ditebak, `process` ditolak 409,
sedangkan `success`/`fail` tetap bisa dicatat). Field lama `payoutAccount`
tetap ada untuk klien lama tetapi bukan acuan transfer.

**Bukti transfer.** `POST /api/redemptions/{id}/proof` hanya untuk SUPERADMIN.
Bukti dipasang di bawah lock yang sama dan ditolak (409, file dihapus lagi) bila
pengajuan sudah selesai atau pemiliknya berubah sejak unggahan dimulai. Bukti
yang tersimpan untuk satu pengajuan tidak pernah memenuhi syarat `success`
pengajuan lain.

## Validasi kantong trip, check-out, dan koreksi (M03)

Kantong (`TrashBagAssignment`) adalah satu baris per QR fisik. Reward trip
dihitung hanya dari baris kantong milik trip yang sudah diverifikasi di server;
jumlah yang dikirim klien tidak pernah menghasilkan uang.

**Check-out massal** `POST /api/manual-validations` (ADMIN organisasi trip,
SUPERADMIN):

```json
{ "tripId": "<trip>", "validationStage": "CHECK_OUT", "appCompleted": true,
  "bags": [{ "id": "<id kantong>", "status": "GOOD | PARTIAL | POOR | NOT_RETURNED" }] }
```

- Setiap `bags[].id` wajib baris kantong trip tersebut. ID ganda ditolak 422
  `Kantong dipindai lebih dari sekali`; ID trip lain, organisasi lain, atau
  yang tidak ada ditolak 422 `Kantong tidak sesuai trip`. Penolakan terjadi
  sebelum kantong mana pun berubah.
- Kantong yang belum pernah dipindai dan tidak ada di daftar dicatat
  `NOT_RETURNED`; kantong yang sudah dipindai sebelumnya tetap dengan statusnya.
  Skor compliance dan reward dihitung ulang dari seluruh kantong trip.
- `bags` hanya diterima pada `CHECK_OUT` (tahap lain: 422
  `Kondisi kantong hanya dicatat saat check-out`). Daftar kosong diperlakukan
  sebagai permintaan lama tanpa ID (di bawah).
- Respons tetap `201 { validation, rewardAmount, compliance }`; `rewardAmount`
  adalah rupiah yang dikreditkan oleh permintaan ini.

**Permintaan lama tanpa ID kantong** (`returnedBagCount` + `conditionStatus`):

- `returnedBagCount` tidak boleh melebihi jumlah kantong yang diterbitkan untuk
  trip (422 `Jumlah kantong kembali melebihi jumlah kantong yang diterbitkan
  untuk trip ini`). Batas yang sama berlaku untuk check-in dan pickup Bank Sampah.
- Trip `MONEY_REWARD` yang punya penerima reward dan kantong wajib mengirim
  `bags`: tanpa ID ditolak 422 `Check-out trip berhadiah wajib menyertakan ID
  setiap kantong. Muat ulang daftar kantong lalu ulangi.` Trip tetap ACTIVE
  sehingga klien bisa mengulang dengan ID.
- Trip `COMPLIANCE_ONLY`, trip tanpa penerima, atau trip tanpa kantong boleh
  check-out dengan jumlah (dibatasi seperti di atas); status kantong tidak
  diubah dan tidak ada reward. Trip tanpa kantong tidak pernah mendapat reward.
- Web (`components/trip/TripManager.tsx`) dan mobile
  (`admin_trips_screen.dart`) sudah mengirim `bags` dengan ID setiap kantong
  saat check-out; pickup Bank Sampah mengirim jumlah baris kantong.

**Scan per kantong** `PATCH /api/trash-bags` (ADMIN organisasi trip, SUPERADMIN):

```json
{ "id": "<id kantong>", "status": "GOOD", "appCompleted": true, "correctionReason": "opsional, 5-500 karakter" }
```

| Keadaan | Hasil |
| --- | --- |
| Trip ACTIVE, status berubah | 200, kantong diperbarui, skor dihitung ulang dari semua kantong. Scan yang membuat seluruh kantong sudah berstatus menutup trip (COMPLETED), mencatat satu validasi CHECK_OUT, dan mengkreditkan reward sekali. |
| Trip ACTIVE, status sama | 200 `idempotent: true`, tidak ada perubahan kantong maupun audit. |
| Trip COMPLETED, status sama | 200 `idempotent: true`, tidak ada yang ditulis (retry aman bila respons scan penutup hilang). |
| Trip COMPLETED, status berbeda tanpa `correctionReason` | 422 `Trip sudah selesai. Perubahan kondisi kantong setelah check-out harus dicatat sebagai koreksi beserta alasannya.` |
| Trip COMPLETED, status berbeda dengan `correctionReason` | 200 `correction: { previousStatus, paidRewardAmount, recomputedRewardAmount }`. Kantong dan skor compliance diperbarui, audit `TRASH_BAG_CORRECTION` mencatat alasan serta selisih reward. Saldo tidak berubah: tidak ada reward kedua, penyesuaian, atau pembalikan otomatis; selisih ditindaklanjuti tim keuangan. |
| Trip PLANNED / CANCELLED | 422 seperti sebelumnya |

`idempotent` dan `correction` adalah field tambahan; `bag`, `validation`,
`compliance`, dan `rewardAmount` tidak berubah.

**Serialisasi.** Check-out, scan, dan penerbitan kantong berjalan dalam satu
transaksi di bawah lock User penerima reward (bila ada) -> Trip -> seluruh
baris kantong trip (urut id). Dua kantong terakhir yang dipindai bersamaan,
atau scan yang bersamaan dengan check-out massal, menghasilkan tepat satu
penutupan trip dan satu reward; permintaan yang kalah melihat trip sudah
selesai (`Trip sudah selesai; validasi gerbang tidak dapat diulang` untuk
check-out kedua). Reward trip ditulis sekali dengan business key
`trip:<tripId>:return`; reward lama tanpa key (referensi Trip atau
ManualValidation) dihormati sehingga trip lama tidak dibayar dua kali.
Penerbitan kantong ke trip yang baru ditutup ditolak 422, dan
`PATCH /api/trips/{id}` (batal/buka ulang) memakai compare-and-set sehingga
tidak menimpa trip yang sudah selesai (409 `Status trip sudah berubah. Muat
ulang halaman lalu coba lagi.`). Antrean lock yang terlalu lama dijawab 503
`Sistem sedang sibuk. Silakan coba lagi.` tanpa perubahan. Audit dan notifikasi
dikirim setelah commit.

## Penghapusan akun (A04)

`DELETE /api/user/data` (role USER, sesi aktif = verifikasi pemilik) selalu
menjawab **202 Accepted** dengan status pekerjaan; klien lama yang menerima
semua 2xx tetap berfungsi tetapi wajib membaca `status`/`completed`:

```json
{ "requestId": "…", "status": "COMPLETED", "completed": true, "accountErased": true,
  "message": "…", "resolutionSteps": [], "erased": ["…"], "retained": ["…"] }
```

| `status` | Arti | Akun |
|---|---|---|
| `PENDING_RECONCILIATION` | Ditunda: masih ada saldo tersedia/ditinjau/tertahan, pencairan berjalan, sesi setoran terbuka, atau trip aktif. **Belum ada data yang dihapus.** `resolutionSteps` berisi langkah penyelesaian. | Tetap aktif, login tidak dikunci |
| `PROCESSING` | Sedang berjalan. | Aktif sampai anonimisasi selesai |
| `RETRYABLE_FAILED` | Ada langkah gagal, dicoba ulang otomatis. `accountErased` menyatakan apakah profil sudah dianonimkan. Bukan sukses. | Nonaktif bila `accountErased` |
| `COMPLETED` | Semua langkah wajib selesai. | Nonaktif, sesi dicabut |

Bila `accountErased` bernilai `true`, server sudah mencabut semua sesi
(`tokenVersion`) dan menghapus cookie; klien harus menghapus kredensial lokal
(biometrik, email tersimpan) lalu logout. Memanggil ulang `DELETE` saat
permintaan masih terbuka mengembalikan `requestId` yang sama (permintaan yang
ditahan diperiksa ulang). `GET /api/user/data/erasure` mengembalikan
`{ "erasure": <objek yang sama> | null }` untuk menampilkan status yang masih
berjalan. Pesan tidak pernah menyatakan seluruh data terhapus: `retained`
menjelaskan data yang tetap disimpan tanpa identitas dan alasannya (lihat
docs/privacy-erasure.md).

Formulir publik `POST /api/account-deletion-requests` hanya mencatat
permintaan (202, jawaban sama untuk email terdaftar maupun tidak) dan mengirim
tautan konfirmasi sekali pakai ke email akun. Penghapusan baru berjalan setelah
`POST /api/account-deletion-requests/confirm { "token": "…" }` (jawaban 202
dengan objek status di atas; token salah, terpakai, atau kedaluwarsa = 400).

`GET /api/user/data` (ekspor) kini juga memuat `payoutAccounts`, `trips`,
`notifications`, `deletionRequests`, dan `payoutDestination` per pencairan
(nomor dan nama tujuan milik pemilik dalam bentuk teks biasa; ciphertext dan
`requestHash` tidak pernah dikirim).

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
