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
| `GET /api/mobile/audit-security` | Superadmin | Audit log, security event, dan ringkasan alert. Sejak A05 setiap log membawa `chainVersion` (1 = arsip legacy, 2 = rantai baru) dan `chainSequence` (string, `null` untuk legacy); verifikasi rantai: [audit-chain.md](security/audit-chain.md) |

Kelompok endpoint existing yang dipakai:

- Auth: `/api/auth/login`, `/register`, `/me`, `/logout`, `/verify-email`,
  `/verify-email/resend`, `/api/travel-agent-invitations/accept` (A03)
- User: `/api/user/dashboard`, `/api/scan`, `/api/sessions/:id`,
  `/api/wallet`, `/api/payout-accounts`, `/api/redemptions`, `/api/trips`
- Trash bag / wisata: `/api/trips`, `/api/trips/:id`, `/api/trash-bags`,
  `/api/manual-validations`, `/api/travel-agents`, `/api/travel-agents/:id`,
  `/api/travel-agents/:id/invitations`
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
`POST /api/scan` (201, dibaca `ScanResult.fromJson`). `reconciliation-report.v1.json`
(M05) membekukan `GET /api/reports/reconciliation` (200, SUPERADMIN, dibaca
`ReconciliationLiability.fromJson`). Penambahan field boleh; menghapus, mengganti
nama, atau mengubah tipe field wajib membuat versi baru.

## Laporan rekonsiliasi dan ringkasan superadmin (M05)

- `GET /api/reports/reconciliation` (SUPERADMIN; peran lain 403) mengembalikan
  `{ report }` dari satu snapshot baca-saja. Angka kewajiban dalam rupiah bulat:
  `availableLiability` (Saldo tersedia), `pendingLiability` (Menunggu pemeriksaan),
  `reservedLiability` (Sedang dicairkan), `paidTotal` (Sudah dibayar, di luar
  kewajiban) dan `totalObligation = availableLiability + reservedLiability +
  pendingLiability`. `totalOutstanding` tetap dikirim sebagai alias
  `availableLiability` untuk klien lama.
- Ketidakcocokan pencairan dilaporkan per pengajuan di `payoutMismatches`
  (`payoutMismatchCount` = total); `redeemedDiscrepancy`/`reservedDiscrepancy`
  adalah jumlah nilai mutlak selisih per pengajuan, dan `hasDiscrepancy` true bila
  salah satunya bukan 0. Jangan menjumlahkan keduanya menjadi satu "selisih".
- Sebelum alokasi per organisasi tersedia, `organizations[].outstanding` = 0
  (`allocationStatus: "UNALLOCATED_LEGACY"`) dan seluruh saldo tersedia ada di
  `unallocatedLegacyAmount`; nilai reward per organisasi adalah bruto.
- `GET /api/mobile/overview` untuk SUPERADMIN: `rewardAvailable` kini saldo
  tersedia bersih (sebelumnya reward bruto), ditambah `rewardLiability` berisi lima
  angka kewajiban di atas. Field lama tidak dihapus.
- Rincian semantik: [`docs/database-ledger-guide.md`](database-ledger-guide.md#6-rekonsiliasi-saldo-global-m05).

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
| Trip ACTIVE, status berubah | 200, kantong diperbarui, skor dihitung ulang dari semua kantong. Hanya scan yang memberi status pada kantong terakhir yang belum berstatus menutup trip (COMPLETED), mencatat satu validasi CHECK_OUT, dan mengkreditkan reward sekali. |
| Trip ACTIVE, status sama | 200 `idempotent: true`. Tidak ada yang ditulis: kantong, skor, status trip, reward, dan audit tidak berubah. |
| Trip ACTIVE yang seluruh kantongnya sudah berstatus sebelum scan (data lama) | Scan, baik status sama maupun berbeda, tidak pernah menutup trip atau mengkreditkan reward. Trip seperti ini dilaporkan `npm run reconcile:wallet` (`unclosedReviewedTrips`, beserta perkiraan reward) dan hanya ditutup lewat check-out massal yang menyertakan ID setiap kantong, setelah operator memeriksanya. |
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
`trip:<tripId>:return`; reward lama tanpa key (alasan `TRASH_BAG_RETURN` dengan
referensi Trip atau ManualValidation) dihormati sehingga trip lama tidak dibayar
dua kali. EARN lain yang mereferensikan trip (misalnya bonus kepatuhan) bukan
reward pengembalian dan tidak menghalanginya.
Penerbitan kantong ke trip yang baru ditutup ditolak 422, dan
`PATCH /api/trips/{id}` (batal/buka ulang) memakai compare-and-set sehingga
tidak menimpa trip yang sudah selesai (409 `Status trip sudah berubah. Muat
ulang halaman lalu coba lagi.`). Antrean lock yang terlalu lama dijawab 503
`Sistem sedang sibuk. Silakan coba lagi.` tanpa perubahan. Audit dan notifikasi
dikirim setelah commit.

## Kebijakan reward setoran, peninjauan, dan scan (M04)

Semua jalur yang dapat memberi uang memakai satu kebijakan: `decideReward`
(`lib/reward-policy.ts`, murni tanpa DB/jaringan) memutuskan status, jumlah, dan
status ledger; `creditReward` (`lib/reward-credit.ts`) menulisnya di transaksi
pemanggil setelah lock User penerima, sekali per business key. Jalurnya:
penerimaan item mesin (`ITEM_ACCEPTED_POINT`), fraud/vandalisme, peninjauan
setoran, check-out trip, dan scan kantong.

**Mode reward.** Campaign `COMPLIANCE_ONLY` tidak pernah menghasilkan uang di
jalur mana pun (item tetap diterima/ditinjau, tanpa baris ledger). Sesi mesin
tanpa campaign memakai `Organization.machineRewardMode` (bawaan
`MONEY_REWARD`, diatur superadmin lewat `PATCH /api/organizations/{id}`
`{ "machineRewardMode": "COMPLIANCE_ONLY" }`). Trip hanya dibayar untuk campaign
`TRASH_BAG`/`TOURISM_PROGRAM` bermode `MONEY_REWARD`.

**Campaign di mesin.** `POST /api/scan` dengan `campaignId` hanya menerima
campaign `MACHINE_DEPOSIT`, atau `EVENT`/`SCHOOL_PROGRAM` yang
`supportsMachine: true` (diatur lewat `POST`/`PATCH /api/campaigns`). Campaign
lain dijawab 422 `Campaign ini tidak berlaku untuk setoran mesin`. Sesi lama
yang terikat campaign non-mesin tetap diproses, tetapi tanpa uang.

**Verifikasi material.** Setiap mesin punya `materialVerification`
(`PATCH /api/machines/{id}`):

| Nilai | Item diterima bila | Klasifikasi AI tidak tersedia |
|---|---|---|
| `WEIGHT_ONLY` (bawaan, perilaku sebelum M04) | berat dalam rentang | diverifikasi berat saja |
| `BARCODE_WEIGHT` | berat dalam rentang dan barcode terbaca | barcode + berat; tanpa barcode -> ditinjau (`BARCODE_MISSING`) |
| `AI_REQUIRED` | AI mengonfirmasi jenis | ditinjau (`AI_UNAVAILABLE`) |

Label AI yang dilaporkan (`IMAGE_CLASSIFIED` dengan confidence > 0) selalu
dicocokkan dengan `WasteType.aiAcceptedLabels` jenis sampah yang dipilih
(`POST`/`PATCH /api/waste-types`, label dinormalisasi, misalnya `Bottle PET` ->
`bottle_pet`). Label lain (kertas, material yang salah dipilih) atau confidence
di bawah 0,5 menahan item untuk ditinjau (`AI_TYPE_MISMATCH`,
`AI_LOW_CONFIDENCE`) dengan EARN `PENDING` sebesar 50% reward; berat di luar
rentang selalu `REJECTED` tanpa uang. Label `unknown` dengan confidence 0
(kamera mati/tanpa model) berarti AI tidak tersedia. Jenis sampah tanpa label
tidak dapat diverifikasi AI (`AI_REQUIRED` menahannya dengan
`AI_TAXONOMY_MISSING`). Migration `20261014013000_reward_policy` mengisi label
`bottle_pet` (PET/botol), `can_aluminium` (kaleng/aluminium), dan keduanya
untuk `Anorganik`.

**Tarif.** Tarif berlaku pada jendela UTC setengah terbuka
`[effectiveFrom, effectiveTo)` dan `active = true`; tarif campaign > organisasi
> global. Tarif yang `effectiveTo`-nya lewat tidak pernah dipakai walaupun
masih `active`.

**Peninjauan.** `PATCH /api/deposit-reviews/{id}` (ADMIN/SUPERADMIN, scope
organisasi mesin):

```json
{ "action": "approve", "wasteTypeId": "<opsional>", "quantity": 1, "note": "<opsional>" }
```

Respons 200:

```json
{ "item": { "...": "..." }, "idempotent": false, "targetAmount": 100,
  "ledgerEntry": { "entryType": "ADJUST", "amount": 50, "businessKey": "review:<id>:decision:v1" },
  "reconciliationCase": null }
```

- Keputusan berjalan sekali di bawah lock User -> Machine -> DepositSession ->
  DepositItem, membaca ulang item dan ledger-nya, lalu compare-and-set dari
  `REVIEW`. `approve` membayar target kebijakan (0 untuk `COMPLIANCE_ONLY`),
  `reject` membayar 0. EARN `PENDING` dilepas ke `AVAILABLE` bila keputusan
  membayar, selain itu menjadi `REJECTED`. Selisih `target - semua EARN/ADJUST/
  REVERSE yang sudah tercatat` ditulis satu kali dengan business key
  `review:<itemId>:decision:v1` (EARN bila item belum punya EARN, ADJUST untuk
  approve, REVERSE untuk reject).
- Keputusan yang sama diulang: 200 `idempotent: true`, tanpa tulisan baru.
  Keputusan berbeda (aksi lawan, atau `quantity`/`wasteTypeId` lain) untuk item
  yang sudah ditinjau: 409 `Item sudah ditinjau dengan keputusan lain`. Item
  yang keluar dari `REVIEW` tanpa keputusan peninjau: 409 `Item sudah berstatus
  <status>, tidak lagi menunggu peninjauan`.
- Koreksi negatif yang tidak lagi tertutup saldo tersedia (uangnya sudah
  dicairkan atau sedang dalam pencairan) tidak didebit paksa: keputusan item
  tetap tersimpan dan `reconciliationCase` (`reasonCode`
  `ANOMALY_ALREADY_PAID_OUT`) dibuka untuk tim keuangan. Kredit ke akun yang
  sudah dihapus (A04) juga ditolak menjadi kasus (`RECIPIENT_ERASED`).
- Event fraud/vandalisme memindahkan EARN item dari `AVAILABLE` ke `PENDING`
  hanya selama saldo tersedia masih menutupinya; bila tidak, EARN tetap dan
  kasus `fraud:<itemId>:hold:v1` dibuka. Event mesin (fraud, vandalisme,
  `SENSOR_SEQUENCE`, `ITEM_REJECTED`) tidak pernah membuka ulang item yang sudah
  diputuskan: item `REJECTED` dan keputusan peninjau hanya mendapat tanda fraud,
  item yang sedang ditinjau mempertahankan alasannya (misalnya
  `UNKNOWN_WASTE_TYPE`), dan `ITEM_REJECTED` hanya menolak item yang belum
  melewati titik penerimaan dan belum punya baris ledger, di bawah lock User ->
  DepositSession -> DepositItem yang sama. Alasan dari payload mesin yang
  berawalan `REVIEW_` disimpan sebagai `MACHINE_REVIEW_...`, sehingga mesin tidak
  dapat memalsukan keputusan peninjau.
- Item dengan jenis sampah tidak dikenal selalu masuk `REVIEW` dengan reward 0
  di titik penerimaan, apa pun berat atau reward bawaan jenis cadangannya;
  menyetujuinya wajib memilih `wasteTypeId`.
- `approve` hanya untuk item yang sudah melewati titik penerimaan mesin
  (`ITEM_ACCEPTED_POINT`). Item yang sudah ada di antrean peninjauan sebelum
  titik itu (misalnya jenis sampah tidak dikenal) hanya dapat ditolak atau
  menunggu mesin selama sesinya masih berjalan: `approve` dijawab 409 `Item
  belum melewati titik penerimaan mesin. Tunggu hingga mesin menyelesaikan
  setoran, atau tolak item ini.`.
- Item `REVIEW` tanpa catatan penerimaan yang utuh (tanpa event penerimaan,
  atau dengan event penerimaan tanpa `acceptedAt`) tidak pernah dihargai
  dengan tarif saat persetujuan. Sesi yang sudah berakhir (`COMPLETED`,
  `CANCELLED`, `EXPIRED`) bukan jaminan bahwa item itu selesai: **mesin tetap
  dapat melengkapi item yang belum diputuskan setelah sesi berakhir, lewat
  outbox-nya** (bacaan, event penerimaan, atau penolakan yang tertunda tetap
  memutuskan item itu, R03). Yang berakhir adalah sisi manusia: **peninjau
  hanya menyetujui item yang sudah melewati titik penerimaan**. Untuk item
  seperti ini `approve` biasa dijawab 409, tanpa pernah menyuruh menunggu:
  - item yang tercatat **setelah batas waktu M04** (termasuk item yang
    ditahan R03 dengan alasan `SESSION_TIMEOUT`/`SESSION_CLOSED`): `Item belum
    melewati titik penerimaan mesin dan sesi setorannya sudah berakhir,
    sehingga tidak dapat disetujui. Item ini hanya dapat ditolak; catatan
    penerimaan mesin yang masih tertunda, bila ada, akan memperbaruinya secara
    otomatis.` Tidak ada jalur persetujuan oleh manusia; `reject` tetap
    tersedia.
  - item yang tercatat **sebelum batas waktu M04** (baris lama): `Catatan
    penerimaan mesin untuk item ini tidak ada atau tidak lengkap, dan sesi
    setorannya sudah berakhir. Item ini tercatat sebelum kebijakan penerimaan
    saat ini berlaku: hanya superadmin yang dapat menyetujuinya sebagai setoran
    lama, atau tolak item ini.`

  Batas waktu M04 (`lib/reward-legacy-cutover.ts`) ditentukan secara
  deterministik: `REWARD_LEGACY_CUTOVER_AT` (ISO-8601) bila diatur, selain itu
  waktu penerapan migrasi `20261014013000_reward_policy` di
  `_prisma_migrations`. Nilai yang tidak dapat dibaca, atau migrasi yang belum
  diterapkan, berarti tidak ada baris yang memenuhi syarat (fail closed; 409
  `Batas waktu setoran lama belum dapat ditentukan, ...`).

  **Persetujuan setoran lama oleh superadmin** hanya untuk baris sebelum batas
  waktu itu dan selalu diperiksa versinya: `PATCH /api/deposit-reviews/{id}`
  dengan `{ "action": "approve", "legacy": true, "itemVersion": "<updatedAt
  yang dilihat superadmin, ISO-8601>", ... }`. `itemVersion` wajib (422 `Versi
  item yang Anda lihat wajib disertakan ...`; `GET /api/deposit-reviews`
  mengembalikan `updatedAt` setiap item) dan dibandingkan di bawah lock item:
  bila item berubah sejak dilihat (misalnya tanda fraud atau bacaan mesin yang
  tertunda), 409 `Item setoran berubah sejak Anda melihatnya. Muat ulang
  halaman, periksa kembali, lalu ulangi.` tanpa tulisan apa pun. Penolakan
  lain: ADMIN 403 `Persetujuan setoran lama hanya dapat dilakukan oleh
  superadmin.`; sesi masih berjalan 409 `Sesi setoran ini masih berjalan.
  ...`; item sesudah batas waktu 409 `Item ini tercatat setelah kebijakan
  penerimaan saat ini berlaku, ...`; item yang sudah tercatat diterima mesin
  422 `Item ini sudah tercatat diterima mesin. Gunakan persetujuan biasa.`.
  Persetujuan ini memakai gerbang, lock, pemeriksaan berat dan business key
  yang sama dengan `approve` biasa, menghitung harga dengan resolusi tarif
  historis pada waktu tercatat item (`acceptedAt`, atau `createdAt` bila
  kosong; tarif yang tercatat pada baris lama dipakai hanya bila jendelanya
  memuat waktu itu, dan baris lama tanpa tarif tercatat, yang umumnya memang
  belum pernah dihargai, selalu ditentukan ulang pada waktu itu), menulis
  penanda `acceptanceEventId = legacy-approval:<superadminId>` bila item belum
  punya event penerimaan (event asli tidak pernah ditimpa) dan mengisi
  `acceptedAt` dengan waktu tercatat itu, serta dicatat di audit
  (`DEPOSIT_REVIEW_APPROVED` dengan `legacyApproval: true`, `pricedAt`,
  `sessionStatus`, `measuredWeightGrams`, `itemVersion`, `legacyCutoverAt`,
  `legacyCutoverSource`). Ulangan persetujuan (biasa atau lama) idempotent
  apa pun versi yang dibawa; `reject` tetap tersedia untuk admin. Inventaris:
  `npm run reconcile:wallet` (`reviewItemsWithoutAcceptance` dengan
  `beforeCutover`, `acceptedItemsWithoutAcceptance`, dan `legacyCutover`).
- `approve` dihitung dari bukti yang sudah diverifikasi: jenis sampah cadangan
  (tidak dikenal) tidak pernah dapat disetujui (422 `Jenis sampah cadangan tidak
  dapat disetujui. Pilih jenis sampah yang sebenarnya.`), dan berat diperiksa
  ulang serta harga dihitung dengan tarif yang tercatat saat titik penerimaan
  **hanya bila jendela tarif itu (`effectiveFrom` <= `acceptedAt` <
  `effectiveTo`, tanpa melihat `active`) memuat waktu penerimaan**, walaupun
  tarif itu sudah dinonaktifkan atau diganti sesudahnya. Tarif tercatat yang
  jendelanya tidak memuat waktu penerimaan (sisa bug EX-03 pada baris lama)
  tidak dipakai: tarif ditentukan ulang secara **historis** pada waktu
  penerimaan (`resolveRewardRateAt`: hanya jendela tarif yang diperiksa,
  `active` diabaikan, sama seperti aturan tarif tercatat, sehingga tarif yang
  berlaku saat itu tetap dipakai walaupun kemudian dinonaktifkan dan diganti;
  resolusi untuk penerimaan baru tetap mensyaratkan `active`), dan baris
  seperti itu tercantum di `reviewItemsWithRateOutsideAcceptance` pada
  `npm run reconcile:wallet`. Bila saat penerimaan tidak ada tarif tercatat,
  dipakai batas dan reward bawaan jenisnya. Item yang diklasifikasi ulang dan
  setoran lama memakai resolusi historis yang sama pada waktu tercatatnya.
  Setiap jenis sampah ditimbang: berat kosong tidak pernah valid (422 `Berat
  setoran tidak tercatat. Item tanpa berat tidak dapat disetujui; tolak item
  ini.`), berat di luar batas juga 422 (`Berat setoran di luar batas jenis
  sampah yang dipilih. Tolak item ini atau pilih jenis sampah yang sesuai.`);
  item seperti ini hanya dapat ditolak.
- Berat, label AI, dan barcode hanya dicatat sebelum titik penerimaan
  (`WEIGHT_MEASURED`, `IMAGE_CLASSIFIED`, `BARCODE_READ` setelahnya diabaikan,
  event tetap tersimpan), di bawah lock User -> DepositSession -> DepositItem,
  apa pun status sesinya: mesin adalah otoritas atas hasil fisik item di
  outbox-nya, dan bacaan yang tertunda (misalnya setelah mesin tersambung
  kembali) tetap dicatat untuk item yang belum diputuskan walaupun sesinya
  sudah berakhir. Bukti membeku tepat saat persetujuan menjadi mungkin,
  sehingga bacaan mesin yang terlambat tidak dapat mengubah nilai persetujuan;
  persetujuan setoran lama membawa versi item yang dilihat superadmin, sehingga
  bacaan yang masuk setelah itu membuatnya ditolak (409), bukan dihargai ulang.
  `COMPACTION_*` hanya dicatat untuk item yang sudah melewati titik penerimaan
  dan tidak ditolak.
- Kasus terbuka tampil di `GET /api/reports/reconciliation`
  (`report.rewardCases: { open, openAmount, recent[] }`) dan halaman
  Rekonsiliasi Keuangan superadmin.

Dana/budget reward (B01a, `lib/reward-funding.ts`): setiap sesi mesin
berhadiah mereservasi batas reward per sesi (program, atau mesin bila program
tidak menetapkannya) dari dana terkonfirmasi organisasi saat scan, dan setiap
penerbitan kantong trip mereservasi jumlah kantong x tarif x multiplier.
`checkRewardFunding` di `lib/reward-credit.ts` mengikat setiap EARN ke
reservasi sumbernya (kunci bisnis yang sama, retry tidak memakai dana dua
kali). Penolakan hanya aktif bila `REWARD_FUNDING_ENFORCED=true` (409
"Program sementara tidak menerima setoran berhadiah" / "Kuota reward program
tidak mencukupi" sebelum sesi atau kantong dibuat); tanpa flag semuanya
dicatat dalam mode bayangan. Lihat `docs/database-ledger-guide.md` bagian 7;
rollout uang tetap tertahan di gate Z01.

## Sesi setoran mesin: satu sesi aktif per mesin (R03)

Satu mesin hanya punya satu sesi aktif (`RESERVED`, `ACTIVE`,
`PROCESSING_ITEM`, `REVIEW`). Server memutuskan di
`lib/deposit-session-service.ts` di bawah lock baris User -> Machine, membaca
ulang token QR, status mesin, sesi aktif mesin, dan campaign sebelum membuat
sesi; index unik parsial `DepositSession_one_active_per_machine` adalah
pengaman database.

`POST /api/scan` (`{ machineCode, token, campaignId? }`):

| Kondisi | Respons |
|---|---|
| Mesin kosong | 201, `resumed: false` (kontrak `scan-session.v1`) |
| Pemilik scan ulang mesin yang sama (termasuk dua request bersamaan) | 200, `resumed: true`, sesi yang sama; tidak ada perubahan pada sesi |
| Sesi aktif milik pengguna lain | 409 `Mesin sedang digunakan. Silakan coba lagi nanti atau gunakan mesin lain.` Hanya `error`; tanpa ID, nama, email, atau detail sesi pemilik |
| Data lama dengan lebih dari satu sesi aktif di mesin | 409 `Mesin sedang tidak dapat digunakan. Silakan gunakan mesin lain.` (sesi terbaru tidak pernah dipilih; lihat `scripts/reconcile-active-sessions.ts`) |

Respons 200 untuk resume kini juga memuat `machine.supportedWasteTypes`
(aditif). Pesan lain tidak berubah (401 token, 409 mesin/organisasi, 422/403
campaign termasuk guard M04 `Campaign ini tidak berlaku untuk setoran mesin`).

`PATCH /api/sessions/:id` (`finish`/`cancel`, hanya pemilik) berjalan di bawah
lock User -> Machine -> DepositSession:

- Selama mesin masih memutuskan sebuah item (item `PENDING` tanpa titik
  penerimaan) dijawab 409 `Mesin masih memproses item terakhir Anda. Tunggu
  sebentar, lalu coba lagi.` tanpa perubahan. Setelah mesin menerima/menolak
  item itu, finish/cancel berhasil. Item yang sudah ditahan untuk ditinjau
  (`REVIEW`) tidak menghalangi. Bila batas waktu sesi sudah lewat (mesin
  berhenti karena lease habis), finish/cancel menutup sesi lewat kebijakan
  timeout di bawah: 200 dengan status `EXPIRED`, item yang belum diputuskan
  menjadi `REVIEW`.
- Finish yang tidak diizinkan state machine (mis. `RESERVED`) dijawab 409
  `Sesi tidak dapat diselesaikan saat ini.`, bukan 500.
- Sesi yang sudah berakhir dikembalikan apa adanya (200).

**Kebijakan timeout.** Sesi yang ditinggalkan hanya ditutup oleh kebijakan
timeout, tidak pernah ditimpa sesi baru. Batas waktu sesi adalah `timeoutAt`,
atau untuk sesi tanpa `timeoutAt` (baris lama, termasuk sesi `REVIEW`)
`startedAt` + `sessionIdleTimeoutMinutes` mesin. Batas ini hanya diperpanjang
oleh `ITEM_DETECTED` selama belum lewat, tidak pernah dipercepat, dan setelah
lewat tidak ada event mesin yang membukanya lagi (event terlambat tidak
memperpanjang atau menghidupkan sesi). Lease mesin tidak pernah melewati batas
ini, jadi saat batas lewat setiap lease untuk sesi itu sudah kedaluwarsa (dengan
asumsi jam mesin sinkron, lihat `rvm/README.md`). Poll mesin berikutnya, scan
berikutnya, atau finish/cancel pemiliknya lalu menutup sesi menjadi `EXPIRED`
dan memindahkan item yang belum diputuskan mesin ke `REVIEW` dengan alasan
`SESSION_TIMEOUT` (tidak ada item atau uang yang dihapus; audit
`DEPOSIT_SESSION_EXPIRE` mencatat item yang ditahan). Sesi `REVIEW` tanpa
`timeoutAt` (mis. `sessionB` di seed) karenanya berhenti menahan mesin setelah
batas itu, bukan selamanya.

**Event terlambat.** Event mesin selalu dicatat pada sesi yang dibawanya, dan
mesin tetap menjadi penentu hasil fisik item di antreannya: bukti (berat, AI,
barcode) dan penerimaan/penolakan tetap diproses untuk item yang belum punya
titik penerimaan, apa pun status sesinya.

- Item yang dilaporkan setelah sesinya berakhir dibuat di sesi itu dengan
  status `REVIEW` (alasan `SESSION_CLOSED`), tanpa membuka ulang atau
  memperpanjang sesi. Item yang dilaporkan untuk sesi yang batasnya sudah
  lewat tetapi belum ditutup tetap `PENDING` sampai kebijakan timeout
  memindahkannya ke `REVIEW` (`SESSION_TIMEOUT`).
- Titik penerimaan (`ITEM_ACCEPTED_POINT`) yang `occurredAt`-nya (jam mesin)
  tidak melewati akhir sesi (batas waktu, atau finish/cancel/timeout yang lebih
  awal) mengikuti kebijakan reward biasa dan boleh membayar.
- Titik penerimaan yang `occurredAt`-nya setelah akhir sesi, atau untuk item
  `SESSION_CLOSED`, menjadi **review tertahan**: titik penerimaan tercatat,
  bukti dibekukan, EARN `PENDING` (50% hold, tidak pernah `AVAILABLE`), dan
  alasannya tetap terlihat (`SESSION_TIMEOUT` atau `SESSION_CLOSED`).
  Peninjau lalu menyetujui atau menolaknya dengan aturan pasca-penerimaan M04.
- Sebelum titik penerimaannya, item `SESSION_TIMEOUT`/`SESSION_CLOSED` tidak
  dapat disetujui manusia: item ini dibuat setelah cutover M04, sehingga
  persetujuan legacy (hanya untuk baris sebelum cutover, dengan `itemVersion`)
  tidak berlaku; peninjau hanya dapat menolaknya, atau menunggu event mesin.
- Event yang menyebut item dari sesi lain tidak memengaruhi item mana pun
  (referensi dicatat di `payload.orphanedReferences`).

`getActiveDepositForUser(userId, machineCode?)` di service yang sama
mengembalikan ringkasan sesi aktif milik pengguna sendiri saja (read-only:
tanpa lease baru, tanpa perpanjangan, tanpa write). Tanpa `machineCode` dan
dengan lebih dari satu sesi, `session` bernilai `null` dan klien harus meminta
pengguna memilih dari `sessions`. Route publiknya (`GET /api/sessions/active`)
dibuat di U01.

Rollout dalam dua rilis:

1. **Rilis expand**: kode ini + migration
   `20261014120000_one_active_machine_session` (hanya melaporkan jumlah
   duplikat). Eksklusivitas dijaga lock baris Machine; mesin dengan beberapa
   sesi aktif tidak mendapat lease.
2. Jalankan `npm run reconcile:sessions` terhadap produksi sampai exit 0
   (prosedur di header `scripts/reconcile-active-sessions.ts`).
3. **Rilis berikutnya (enforce)**: SQL yang disiapkan di
   `prisma/migrations-enforce/one_active_machine_session_enforce/migration.sql`
   disalin ke `prisma/migrations/<timestamp baru>_one_active_machine_session_enforce/`.
   File ini sengaja tidak berada di `prisma/migrations`, karena `web` baru
   start setelah `prisma migrate deploy` berhasil: bila dikirim bersama expand,
   guard-nya akan menghentikan deploy saat duplikat masih ada dan kode baru
   tidak pernah berjalan untuk merekonsiliasinya. Guard tetap berhenti dengan
   jumlah duplikat bila masih ada, tanpa menutup atau menghapus apa pun. Perubahan
perilaku mesin (lease ditahan saat konflik, sesi ditutup setelah batas waktu)
tidak dirilis sebelum uji mock dan uji hardware terkendali di gate Z01.

## Batas sesi, lease v2, dan close watermark (B01b)

**Batas sesi terlihat sebelum item pertama.** `POST /api/scan` (201 dan 200
resume) dan `GET /api/sessions/:id` memuat field aditif `limits`
(kontrak `scan-session.v1`, field `limits`; model `SessionLimits` di
`mobile/lib/core/models.dart`):

```json
"limits": { "maxRewardRupiah": 20000, "maxItems": 10 }
```

- `maxRewardRupiah`: reward maksimal yang dapat diperoleh sesi ini (batas per
  sesi program, atau mesin), `null` untuk sesi `COMPLIANCE_ONLY` atau bila
  belum dikonfigurasi (mode bayangan). `maxItems`: jumlah item maksimal
  (`Machine.maxItemsPerSession`), `null` bila tidak ada.
- Nilai ini dibekukan saat sesi dibuat (snapshot admisi) dan ditandatangani ke
  lease mesin: mesin **berhenti menerima item** begitu batas tercapai (item
  berikutnya ditolak dengan alasan `SESSION_BOUND_REACHED`, gate tidak dibuka
  lagi) dan kiosk menampilkan "Batas sesi tercapai". Aplikasi menampilkan batas
  sebelum item pertama ("Batas sesi ini: reward maksimal Rp20.000 dan maksimal
  10 item. Mesin berhenti menerima item setelah batas tercapai.") dan tetap
  memberi tombol Selesai.
- Tarif, multiplier, dan mode reward sesi juga dibekukan saat admisi: item yang
  masuk (termasuk batch offline/terlambat dari mesin dan keputusan peninjauan)
  dihargai dengan tarif saat admisi, bukan konfigurasi yang diubah kemudian.
  Program yang berubah menjadi berhadiah setelah sesi dibuat tidak membayar
  item sesi itu.

**Lease mesin v2** (`GET /api/machine-session/:code`, bukan API mobile): worker
RVM yang mengirim header `x-reloop-lease-protocol: 2` menerima lease v2 dengan
`reservationId`, `policyVersion`, `ceilingRupiah`, `maxItems` dan snapshot
`policy` yang terikat HMAC (`lib/machine-lease.ts`, kontrak
`tests/fixtures/contracts/machine-lease.v2.json`). Worker tanpa header tetap
mendapat lease v1 untuk sesi kepatuhan dan, selama `REWARD_FUNDING_ENFORCED`
belum `true`, sesi berhadiah; saat penegakan aktif sesi berhadiah **ditolak**
untuk worker v1 (`lease: null`, `leaseRefused: "LEASE_PROTOCOL_V2_REQUIRED"`).
Respons `session` kini juga memuat `limits`. Urutan rollout: backend, lalu
worker mesin, baru flag (`rvm/README.md`, "Lease v2").

**Close watermark.** Sisa reservasi dana sebuah sesi dilepas hanya setelah
mesin mengirim `SESSION_CLOSE_WATERMARK` (event protokol v2 biasa, setelah
server mengakhiri sesi dan semua event sesi ter-ACK). Koneksi mesin yang hilang
berarti sisa tetap ditahan dan tampil di laporan rekonsiliasi
(`SOURCE_CLOSED_AWAITING_WATERMARK`) sampai mesin kembali atau superadmin
melepasnya secara eksplisit; tidak ada timeout yang membebaskan dana. Tidak ada
perubahan pada API mobile selain `limits`. Perubahan perilaku mesin ini belum
diuji pada hardware (gate Z01).

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

## Verifikasi email dan undangan travel agent (A03)

Akses ke trip sebuah travel agent hanya diberikan kepada akun yang membuktikan
dapat membaca kotak surat yang diundang. Registrasi, perubahan email, atau
daftar agent di dashboard admin **tidak pernah** lagi membuat keanggotaan
travel agent (dulu akun dengan email yang cocok langsung menjadi OWNER).

**Registrasi.** `POST /api/auth/register` kini menjawab **201** (sebelumnya
200; klien yang menerima semua 2xx tetap berfungsi). Field tambahan:
`user.emailVerified: false` dan `emailVerificationQueued: true`. Email
verifikasi dikirim setelah respons. `GET /api/auth/me` menambahkan
`user.emailVerified` (boolean). Respons `PATCH /api/auth/me` tidak berubah.

**Verifikasi email.**

| Endpoint | Peran | Body | Jawaban |
|---|---|---|---|
| `POST /api/auth/verify-email` | Semua role, sesi aktif | `{ "token": "…" }` saja | 200 `{ "verified": true }` |
| `POST /api/auth/verify-email/resend` | Semua role, sesi aktif | kosong | 202 `{ "queued": true, "alreadyVerified": false }` atau 200 `{ "queued": false, "alreadyVerified": true }` |

Kesalahan verifikasi: 400 token tidak dikenal atau milik akun lain, 409 sudah
dipakai atau email akun sudah berubah sejak tautan dikirim, 410 kedaluwarsa
(24 jam), 422 body bukan tepat `{ token }`, 429 terlalu sering (10 per 15
menit; kirim ulang 3 per jam), 503 `NEXT_PUBLIC_BASE_URL` belum dikonfigurasi.
Tautan terbaru menggantikan tautan sebelumnya.

**Perubahan email.** `PATCH /api/auth/me` dengan email baru mengosongkan
status email terverifikasi akun, mencabut status terverifikasi semua
keanggotaan travel agent akun itu, membatalkan tautan verifikasi lama, dan
mengirim tautan verifikasi ke alamat baru. Memverifikasi alamat baru
memulihkan status email, tetapi **tidak** memulihkan akses trip: keanggotaan
harus diverifikasi ulang dengan menerima undangan baru (admin menekan "Kirim
ulang undangan").

**Undangan travel agent.**

| Endpoint | Peran | Fungsi |
|---|---|---|
| `POST /api/travel-agents` | ADMIN, SUPERADMIN | Membuat/memperbarui agent dan mengirim undangan ke email agent. 201 `{ agent, invite, organizationStatus, delivery: "QUEUED" }`. Tidak ada keanggotaan dibuat; `invite.status` selalu `PENDING` dan status organisasi `PENDING` sampai undangan diterima (agent yang sudah `INVITED` tetap `INVITED`). Email `@invalid.reloop` ditolak (422). |
| `GET /api/travel-agents` | ADMIN, SUPERADMIN | Field tambahan per agent: `memberCount`, `verifiedMemberCount`, `latestInvite` (`null`, atau `{ state, createdAt, expiresAt, acceptedAt }` dengan `state` salah satu dari `NOT_SENT`, `SENT`, `EXPIRED`, `ACCEPTED`). Tidak lagi menautkan akun apa pun. |
| `POST /api/travel-agents/:id/invitations` | ADMIN, SUPERADMIN (`organizationId` untuk SUPERADMIN) | Kirim ulang undangan ke email agent: 202 `{ invite, delivery: "QUEUED" }`. Tautan lama tidak berlaku lagi. 404 bila agent tidak terhubung ke organisasi, 422 bila agent ditangguhkan/dihapus. |
| `POST /api/travel-agent-invitations/accept` | USER, sesi aktif | Body tepat `{ "token": "…" }`; email atau field lain ditolak (422). 200 `{ "accepted": true, "travelAgentId", "organizationId" }`. |

Penerimaan undangan memeriksa, di bawah lock User: token terkini, belum
dipakai, belum kedaluwarsa (24 jam); email akun saat ini sama dengan email
yang diundang; agent, organisasi, dan relasi agent-organisasi aktif. Lalu
secara atomik: undangan ditandai terpakai, keanggotaan OWNER dibuat atau
diverifikasi, relasi `PENDING` menjadi `INVITED`, dan email akun ditandai
terverifikasi (token membuktikan kotak surat itu). Kesalahan: 400 tautan
tidak valid, 403 `Undangan ini dikirim ke alamat email lain…` / `Travel agent
atau organisasi ini sedang tidak aktif…` / bukan role USER, 409 `Undangan
sudah digunakan`, 410 kedaluwarsa, 429 terlalu sering. Pesan tidak pernah
memuat token.

**Akses trip.** Keanggotaan travel agent hanya dihitung bila
`TravelAgentUser.verifiedAt` terisi **dan** email akun terverifikasi. Berlaku
untuk `GET /api/trips`, `GET /api/trips/:id` (403 untuk anggota yang belum
terverifikasi), `GET /api/mobile/overview` (`isTravelAgent`,
`tourismSummary`), `isTravelAgent` pada `GET /api/wallet` dan
`GET /api/user/dashboard`, halaman web trip pengguna, serta notifikasi trip
dari `/api/trash-bags` dan `/api/manual-validations`. Akses sebagai penerima
reward trip (`trip.userId`) tidak berubah.

**Tautan email.** Tautan berbentuk `<NEXT_PUBLIC_BASE_URL>/accept-invitation#token=…`
dan `/verify-email#token=…`. Token ada di fragmen URL, yang tidak pernah
dikirim browser ke server atau ke header Referer; halaman web memindahkannya
dari address bar sebelum script aplikasi berjalan, menyimpannya hanya di
`sessionStorage` tab itu selama login, dan mengirimnya hanya di body POST.
Halaman tersebut `noindex`, `Referrer-Policy: no-referrer`, dan `no-store`.
Aplikasi mobile belum menangani tautan ini (dibuka di browser). Klien yang
memegang token boleh langsung memanggil endpoint di atas.

**Pengiriman tahan gagal.** Email undangan dan verifikasi masuk ke tabel
`EmailOutbox` dalam transaksi yang sama dengan perubahannya, dicoba sekali
setelah respons, lalu dicoba ulang oleh `npm run email:outbox`
(`scripts/process-email-outbox.ts`; jalankan berkala, mis. tiap 5 menit).
Baris outbox tidak menyimpan alamat atau token: token dibuat saat pengiriman
dan hanya hash SHA-256-nya yang disimpan, sehingga percobaan ulang membuat
token baru. Exit code 3 berarti ada pengiriman gagal (pantau), output hanya
berisi ID. Email reset password dan konfirmasi hapus akun (A04) masih memakai
pengiriman setelah respons tanpa outbox (tindak lanjut terpisah).

**Rollout (Z01).** Keanggotaan yang ada sebelum A03 **tidak** diverifikasi
otomatis, karena dibuat dari email registrasi yang tidak terbukti. Sejak rilis
ini anggota tersebut kehilangan akses trip sampai menerima undangan baru.
Sebelum rilis jalankan `npm run report:travel-agent-access` (read-only; daftar
keanggotaan yang terdampak, alasan, organisasi, dan jumlah trip yang tidak
lagi terlihat; tanpa email atau nama orang), beri tahu agent terkait, lalu
admin organisasi menekan "Kirim ulang undangan" pada halaman Travel Agent.
Status verifikasi terlihat pada kolom "Verifikasi" di halaman itu dan pada
halaman profil pengguna.

## Pickup dispatch (B05)

Pickup memakai **dispatch admin**: ADMIN (organisasi sendiri) atau SUPERADMIN
menugaskan satu pengepul yang kemitraannya `ACTIVE`; pengepul yang ditugaskan
menjalankan langkah lapangan. Tidak ada endpoint klaim/self-assign untuk
pengepul. `GET /api/pickups?scope=available` untuk PENGEPUL kini selalu
menjawab `{ "pickups": [], "pagination": … }` (bentuk sama, agar aplikasi lama
tidak menampilkan tombol klaim yang tidak berfungsi).

**Field baru** pada setiap `pickup` (aditif): `version` (int, naik pada setiap
keputusan), `assignedAt`, `expectedStartAt` (tenggat mulai yang dipilih admin,
`null` = tanpa tenggat; tidak ada SLA bawaan), `lastEscalatedAt`,
`closedReason` (alasan batal/gagal), `replacesPickupId`. `GET /api/pickups` dan
`GET /api/pickups/:id` menambahkan `replacedBy` dan objek turunan
`dispatch: { nextStatus, nextActor: "ADMIN"|"COLLECTOR"|null, nextLabel,
overdue, needsReplacement }` untuk menampilkan PIC, status berikutnya dan
keterlambatan.

**`PATCH /api/pickups/:id`** body: `action`, `expectedVersion` (versi yang
dilihat klien), `collectorUserId` (assign; field lama, disimpan sebagai
`assignedCollectorId`), `expectedStartAt` (assign, ISO-8601 dengan offset,
di masa depan dan paling lama satu tahun), `reason` (cancel/fail, wajib 3-500
karakter), `notes`. Respons `{ pickup }` membawa `version` baru.

| Aksi | Peran | Dari status | `expectedVersion` |
|---|---|---|---|
| `assign` | ADMIN/SUPERADMIN | REQUESTED, ASSIGNED (ganti pengepul hanya sebelum berangkat) | wajib |
| `start` / `arrive` / `collect` / `complete` | pengepul yang ditugaskan (atau SUPERADMIN) | ASSIGNED / ON_THE_WAY / ARRIVED / COLLECTED | wajib untuk SUPERADMIN; PENGEPUL: dikirim klien baru, lihat masa transisi |
| `fail` | pengepul yang ditugaskan (atau SUPERADMIN) | ASSIGNED … COLLECTED | wajib, plus `reason` |
| `cancel` | ADMIN/SUPERADMIN | REQUESTED, ASSIGNED, ON_THE_WAY, ARRIVED | wajib, plus `reason` |

Kesalahan: **409** `{ error: "Tugas telah diperbarui; muat ulang", code:
"PICKUP_VERSION_CONFLICT" }` bila `expectedVersion` berbeda dari versi saat ini
(semua aksi); **409** `{ code: "PICKUP_VERSION_REQUIRED" }` bila assign/cancel/
fail tanpa `expectedVersion`, atau bila ADMIN/SUPERADMIN mengirim aksi apa pun
tanpa `expectedVersion` (pesan meminta muat ulang atau perbarui aplikasi);
409 tanpa `code` untuk status yang tidak mengizinkan aksi (mis. assign setelah
pengepul berangkat); **403** bila pengepul bukan lagi yang ditugaskan, atau
kemitraannya tidak aktif (diperiksa di dalam transaksi sebelum setiap aksi);
**422** alasan kosong atau tenggat tidak valid. Klien memuat ulang daftar pada
409/403 dan tidak mengulang permintaan yang sama.

**Masa transisi klien.** Hanya aplikasi pengepul lama (peran PENGEPUL) yang
boleh tidak mengirim `expectedVersion`, dan hanya untuk `start`, `arrive`,
`collect` dan `complete`: server menerimanya hanya bila pengguna PENGEPUL itu
adalah pengepul yang saat ini ditugaskan, kemitraannya aktif, dan status saat
ini adalah status asal aksi tersebut. ADMIN dan SUPERADMIN selalu wajib
mengirim `expectedVersion` (tanpa versi: 409 `PICKUP_VERSION_REQUIRED`). Penulisannya tetap bersyarat pada versi yang dibaca di bawah lock
dan menaikkan versi; audit mencatat `expectedVersionProvided: false`.
`expectedVersion` yang dikirim tetapi usang selalu ditolak 409. Assign, cancel
dan fail tidak pernah diterima tanpa versi. Pada rilis berikutnya (setelah
aplikasi lama tidak dipakai) `expectedVersion` diwajibkan untuk semua aksi.

**Pengganti tugas.** Setelah cancel/fail, admin membuat tugas pengganti dengan
`POST /api/pickups { "replacesPickupId": "<id>" }`: 201 tugas REQUESTED baru
(organisasi, mesin, alasan dan prioritas disalin), 200 `existing: true` bila
pengganti sudah ada (satu pengganti per tugas), 409 bila tugas belum ditutup
atau mesinnya sudah punya tugas terbuka. Pickup otomatis FULL dari mesin
(heartbeat/status penuh) dicatat sebagai pengganti tugas terakhir mesin itu
bila tugas tersebut dibatalkan/gagal dan belum punya pengganti; tombol "Buat
pengganti" lalu menjawab 200 `existing: true` dengan tugas otomatis tersebut.

**Catat material.** `POST /api/pickups/:id/items` (PENGEPUL yang ditugaskan
atau SUPERADMIN) berjalan di bawah lock pickup yang sama: penugasan,
kemitraan aktif (403 bila pengepul bukan lagi yang ditugaskan atau
kemitraannya tidak aktif) dan status (409 di luar ARRIVED/COLLECTED/COMPLETED)
dibaca ulang di dalam transaksi, sehingga pembatalan yang bersamaan diputuskan
lebih dulu.

**Notifikasi** (dikirim setelah commit): `PICKUP_ASSIGNED` ke pengepul yang
ditugaskan; `PICKUP_STATUS` ke pengepul lama saat dialihkan dan ke pengepul
yang ditugaskan saat dibatalkan; `PICKUP_STATUS` ke admin aktif organisasi saat
tugas gagal; `PICKUP_OVERDUE` ke admin aktif organisasi saat terlambat. Tidak
ada notifikasi ke organisasi lain, pengguna lain, atau superadmin.

**Eskalasi terlambat.** Tugas `ASSIGNED` yang `expectedStartAt`-nya terlewati
tanpa `start` ditandai `dispatch.overdue` dan memicu satu `PICKUP_OVERDUE` per
(pickup, versi): klaimnya satu UPDATE bersyarat pada versi dan
`lastEscalatedAt IS NULL`; setiap assign mengosongkan `lastEscalatedAt` dan
menaikkan versi. Eskalasi tidak pernah menugaskan ulang. Pemeriksaan berjalan
otomatis saat admin membuka daftar/detail pickup (web dan API), dan oleh
runner `npm run pickups:escalate` (`scripts/process-pickup-escalations.ts`,
opsi `--limit 1..1000`, default 200; keluaran JSON berisi id pickup, versi dan
id organisasi saja; exit 0 selesai, 2 argumen salah, 1 gagal). Repositori ini
tidak menjadwalkannya: operasi menjalankannya berkala (cron atau scheduler
CI, mis. tiap 5 menit) dengan `DATABASE_URL` produksi. Menjalankannya berulang
aman (idempoten).

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

### Setup dan penggantian faktor MFA (A02)

Setup MFA tidak lagi menyentuh faktor yang aktif. Endpoint hanya untuk ADMIN dan
SUPERADMIN, dan setiap langkah memerlukan bukti baru, bukan sesi saja:

| Endpoint | Body | Hasil |
|---|---|---|
| `POST /api/auth/mfa/setup` | `{ currentPassword, currentCode? }` | `currentCode` wajib selama MFA aktif (penggantian); setup pertama cukup password. Respons: `secret`, `otpauthUrl`, `qrDataUrl`, `replacement`, `expiresAt`, `message`. |
| `DELETE /api/auth/mfa/setup` | — | Membuang setup tertunda saja; faktor aktif dan sesi tidak berubah. Respons `{ cancelled, message }`. |
| `POST /api/auth/mfa/enable` | `{ code }` | Kode dari secret tertunda. Berhasil: secret tertunda menjadi faktor aktif, `tokenVersion` naik, cookie sesi pemohon diterbitkan ulang. Respons `{ replaced, message }`. |
| `POST /api/auth/mfa/disable` | `{ currentPassword, code }` | Kode dari faktor aktif. Berhasil: MFA mati, setup tertunda dibuang, `tokenVersion` naik, cookie sesi pemohon diterbitkan ulang. |

Aturan:

- Secret baru disimpan di `User.pendingTotpSecret` (ciphertext AES-GCM, helper
  yang sama dengan `totpSecret`) dengan `pendingTotpExpiresAt` 10 menit dan
  `pendingTotpTokenVersion` = `tokenVersion` saat setup dimulai. Ketiganya selalu
  terisi bersama atau kosong bersama (CHECK `User_pendingTotp_all_or_none`).
  Login (`/api/auth/mfa/verify`) hanya memakai `totpSecret`, sehingga faktor lama
  tetap berlaku sampai konfirmasi.
- Setup, konfirmasi, disable, dan pembatalan berjalan di bawah lock baris User
  (`lockUser`, transaksi ReadCommitted dengan `lock_timeout`), lalu membaca ulang
  password, faktor aktif, dan field tertunda. Dua konfirmasi paralel hanya
  menghasilkan satu promosi; yang lain mendapat 409.
- Konfirmasi ditolak (409, setup dibuang) bila setup kedaluwarsa atau
  `tokenVersion` sudah berubah sejak setup dimulai. Kode salah (400) tidak
  membuang setup. Tanpa setup tertunda juga 409.
- Ganti password (`PATCH /api/auth/me`) dan reset password membuang setup
  tertunda di bawah lock User yang sama; perubahan email juga. Penghapusan akun
  (A04) mengosongkan ketiga field.
- Enable/replace dan disable menaikkan `tokenVersion`: semua sesi lain dan
  challenge MFA lama dicabut, sedangkan pemohon langsung menerima cookie sesi
  baru dengan versi baru dan tetap masuk. Klien yang menyimpan cookie harus
  memakai `Set-Cookie` dari respons ini.
- Status: body tidak valid atau tanpa body 422 (klien lama yang memanggil setup
  tanpa body ditolak, tidak ada fallback); password atau kode salah 400 dengan
  satu pesan "Password atau kode MFA tidak valid" untuk kedua faktor; untuk
  penggantian, kode yang hilang ditolak 422 sebelum password diperiksa.
  Rate limit per pengguna + IP: setup 5/15 menit, enable 10/5 menit, disable
  5/15 menit; kuota habis 429, rate limiter tidak tersedia 503.
- Respons tidak pernah memuat secret yang aktif. Audit (`MFA_SETUP_STARTED`,
  `MFA_SETUP_PROOF_FAILED`, `MFA_SETUP_CANCELLED`, `MFA_ENABLED`, `MFA_REPLACED`,
  `MFA_ENABLE_FAILED`, `MFA_DISABLED`, `MFA_DISABLE_FAILED`) hanya mencatat IP
  dan jenis setup; kode, secret, dan password tidak pernah dicatat di audit
  maupun log server.
- Tidak ada jalur pemulihan atau bypass lewat API. Admin yang kehilangan
  perangkat authenticator dipulihkan oleh operator setelah identitasnya
  divalidasi di luar aplikasi. Pemulihan harus mengosongkan `totpSecret`, field
  tertunda, dan `mfaEnabled`, menaikkan `tokenVersion`, serta dicatat di audit.
  Runbook operator (siapa memvalidasi dan bagaimana) belum ditetapkan.
- Migrasi `20261014023251_mfa_pending_setup`: expand (tiga kolom nullable) dan
  enforce (CHECK) dalam satu langkah, tanpa backfill. Baris lama semuanya
  kosong, dan kode sebelum A02 tidak menulis kolom tersebut.
- Mobile tidak memanggil endpoint `/api/auth/mfa/*` (hanya web dashboard,
  `components/security/MfaManager.tsx`), jadi tidak ada perubahan Flutter.
- Kode TOTP sekali pakai (RFC 6238 §5.2, perbaikan A02 putaran 1).
  `User.totpLastUsedStep` menyimpan langkah waktu (detik Unix / 30) kode
  terakhir yang diterima untuk faktor aktif. Login (`/api/auth/mfa/verify`) serta
  bukti setup dan disable menolak kode pada langkah itu atau sebelumnya, lalu
  mencatat langkah baru dalam penulisan yang sama. Login memakai update
  bersyarat, sehingga dua login paralel dengan kode yang sama hanya menghasilkan
  satu keberhasilan. Saat faktor baru dipromosikan, nilainya menjadi langkah
  kode konfirmasi faktor baru. Disable dan penghapusan akun mengosongkannya.
  Akibatnya, kode yang baru dipakai untuk login tidak dapat dipakai lagi untuk
  setup atau disable: pengguna menunggu kode berikutnya (maksimal 30 detik).
  Migrasi `20261014032039_totp_last_used_step` hanya menambah satu kolom
  nullable, tanpa backfill; NULL berarti belum ada kode yang dipakai.
- `PATCH /api/auth/me` hanya mengembalikan `user` dengan `id`, `name`, `email`,
  `phone`, `role`, `organizationId`, `status`, `payoutEligible`, `createdAt`,
  dan `updatedAt` (select eksplisit). Secret TOTP aktif atau tertunda,
  `passwordHash`, `emailLookup`, dan `tokenVersion` tidak pernah dikirim. Klien
  mobile tidak membaca body ini dan memanggil `checkSession()` sesudahnya.
- `POST /api/auth/reset-password` mengklaim token reset di dalam transaksi yang
  sama dengan perubahan password, di bawah lock User. Kegagalan seperti 503
  akibat lock membatalkan klaim, sehingga tautan reset tetap bisa dipakai.

## Otorisasi websocket realtime (R04)

Gateway `realtime/server.mjs` (proses terpisah, endpoint `/ws`) tidak lagi
memakai role dari handshake selama socket hidup. Kedaluwarsa sesi, pencabutan
akun, perubahan role, dan perpindahan organisasi berlaku untuk socket yang
sudah terhubung.

### Verifier internal

`POST /api/internal/ws-session` (Bearer `REALTIME_INTERNAL_SECRET`, body
`{ token }`) menjawab 401 tanpa secret yang benar dan 422 tanpa `token`. Untuk
pemanggil yang sah, jawabannya 200 dengan salah satu dari:

- `{ userId, role, organizationId, tokenVersion, expiresAt }` jika JWT sesi
  lolos verifikasi ketat, akun `ACTIVE`, tokenVersion sama dengan database,
  dan `expiresAt` (exp yang sudah diverifikasi, detik Unix) belum lewat.
  `role` dan `organizationId` dibaca dari database, bukan dari token.
- `null` untuk kondisi lain: token tidak sah atau kedaluwarsa, akun
  nonaktif/ditangguhkan, atau tokenVersion berubah. Gateway menganggapnya
  pencabutan definitif.

DB guard ada di `lib/ws-session.ts` (`resolveWsSessionIdentity`).
`verifySessionToken` kini juga mengembalikan `expiresAt` (field tambahan).
Jawaban lama `{ role }` tidak diterima: identitas yang tidak lengkap tidak
memberi akses privat, dan tidak ada fallback permisif.

### Metadata socket dan revalidasi

- Socket anonim (tanpa cookie, cookie ditolak, atau verifier tidak
  dikonfigurasi) hanya menerima topik publik. Frame dari klien diabaikan dan
  tidak pernah mempromosikan socket.
- Socket dengan identitas menyimpan `userId`, `role`, `organizationId`,
  `tokenVersion`, `expiresAt`, dan `lastValidatedAt`. Socket ditutup tepat
  pada `expiresAt` dengan close code `4401`.
- Socket ADMIN/SUPERADMIN menyimpan cookie mentah hanya di memori. Cookie
  tidak pernah dicatat di log dan hanya dikirim ke verifier. Socket ini
  divalidasi ulang setiap 30 detik. Sebelum broadcast topik restricted, socket
  yang validasi terakhirnya sudah 30 detik atau lebih divalidasi ulang dulu.
  Umur identitas dihitung sejak request ke verifier dimulai, bukan sejak
  jawabannya tiba, sehingga pencabutan berlaku paling lambat 30 detik
  berapa pun lama round-trip-nya.
- Jawaban `null` menutup socket dengan close code `4403`. Perubahan role atau
  organisasi memperbarui kapabilitas. Socket yang turun ke USER/PENGEPUL
  kehilangan topik restricted, dan cookie-nya dibuang.
- Jika verifier tidak tersedia (timeout, non-2xx, atau jawaban tidak
  lengkap), topik restricted ditahan sampai identitas valid lagi. Socket
  tidak ditutup dan topik publik tetap berjalan. Aturan ini juga berlaku untuk
  socket yang terhubung saat verifier mati. Gateway mencatat peringatan
  `[realtime] live verifier unavailable (<status/alasan>)` paling banyak sekali
  per 60 detik, berisi jumlah peringatan yang ditekan. Peringatan ini hanya
  memuat status atau alasan, tidak pernah cookie atau body.
- Socket USER/PENGEPUL tidak divalidasi ulang karena tidak pernah menerima
  topik restricted, tetapi tetap ditutup saat expiry.
- Shutdown membersihkan seluruh timer dan cookie. Koneksi ulang selalu
  mendapat metadata baru dari verifier, tanpa mewarisi socket lama.

### Kontrak publish

`POST /publish` hanya untuk internal (Bearer secret).

| Topik | Penerima | Field yang diteruskan |
|---|---|---|
| `machine-state`, `machine-event` | Semua socket, termasuk kiosk anonim | `topic`, `machineCode`, `eventType`, `occurredAt` |
| `security-alert` | ADMIN dengan `organizationId` yang sama, dan semua SUPERADMIN | `topic`, `organizationId`, `machineCode`, `eventType`, `eventId`, `occurredAt` |

- Field lain selalu dibuang (whitelist). Topik publik tidak membawa
  organisasi, pemilik, pengguna, PII, nilai uang/refund, atau payload mentah
  mesin.
- Validasi: `machineCode` berupa string 1–128 karakter, dan `eventType` harus
  cocok dengan `^[A-Z][A-Z0-9_]{0,63}$`. `eventId` opsional, string paling
  panjang 128 karakter. `occurredAt` opsional: hanya diteruskan sebagai
  timestamp ISO yang dinormalisasi gateway. Nilai yang tidak dapat di-parse
  dibuang tanpa menolak event, dan teks bebas tidak pernah sampai ke socket.
- Respons:
  - Topik tidak dikenal: 422 `unknown_topic`.
  - `security-alert` tanpa `organizationId`: 422 `organization_required`.
    Alert seperti ini tidak pernah diperlakukan sebagai global.
  - Field tidak valid: 422 dengan kode field.
  - Body bukan JSON: 400.
  - Sukses: 202 `{ delivered }`.

### Publisher

`publishRealtime` (`lib/realtime.ts`) mewajibkan `organizationId` (tipe) untuk
`security-alert`. Alert tanpa organisasi tidak dikirim, dan web hanya mencatat
peringatan tanpa token. Organisasi selalu diambil dari baris database:

- `POST /api/machines/[id]/remote-commands` dan
  `POST /api/machine-commands/[code]/[id]/result` (`machine-state`) mengisi
  `organizationId` dari baris Machine. Gateway tidak meneruskannya ke socket.
- Event mesin `FRAUD_DETECTED`/`VANDALISM_DETECTED` mem-publish
  `security-alert` setelah commit lewat `publishSecurityAlert`
  (`lib/machine-events/fraud.ts`). `organizationId`-nya diambil dari baris
  Machine, bukan dari payload mesin.

### Klien dan peluncuran

- Dashboard web (`RealtimeRefresh`) tersambung ulang 3 detik setelah socket
  ditutup. Setelah expiry atau pencabutan, koneksi tanpa sesi valid menjadi
  socket anonim (topik publik saja). Setelah login baru, socket mendapat
  identitas baru.
- Kiosk (`MachineDisplay`) bersifat anonim dan tidak terpengaruh. Mobile tidak
  memakai websocket.
- Tidak ada migrasi skema atau backfill. Deploy web (verifier baru) bersamaan
  dengan atau sebelum gateway realtime:
  - Gateway lama dengan verifier baru: body `null` membuat akses privat
    ditolak (fail closed).
  - Gateway baru dengan verifier lama: jawaban `{ role }` dianggap tidak
    lengkap, sehingga topik restricted ditahan sampai web diperbarui.
- Finding SEC-10 tidak ditandai RELEASED sebelum gate Z01.
