# Penghapusan akun: matriks retensi dan prosedur operasional (A04 / SEC-05)

Dokumen ini adalah acuan untuk tim produk, legal, dan operasional. Kode:
`lib/erasure-jobs.ts` (alur), `lib/erasure-copy.ts` (teks pengguna),
`scripts/process-erasure-jobs.ts` (runner), migrasi
`prisma/migrations/20261013170623_erasure_jobs`.

> **Lama retensi.** Kolom "Lama retensi" sengaja tidak berisi angka. Untuk
> setiap kelas data nilainya: **per approved policy — owner: product/legal (to
> be set)**. Jangan mengisi periode hukum tanpa keputusan pemilik kebijakan.
> Fitur ini tidak dirilis (status finding tidak menjadi RELEASED) sebelum gate
> Z01.

## Alur singkat

1. **Permintaan dan verifikasi pemilik.** Penghapusan hanya berjalan untuk
   permintaan `FULL` yang sudah diverifikasi pemilik akun:
   - `DELETE /api/user/data` dari sesi yang masuk (metode `SESSION`);
   - formulir publik `POST /api/account-deletion-requests` hanya mencatat
     permintaan `PENDING` dan mengirim tautan sekali pakai (24 jam) ke email
     akun; pemilik membuka `/account-deletion/confirm` dan menekan konfirmasi
     (`POST /api/account-deletion-requests/confirm`, metode `EMAIL_TOKEN`).
     Jawaban formulir sama dan sama cepat untuk email terdaftar maupun tidak:
     email dikirim setelah respons (`after()`). Tautan hanya dibangun dari
     `NEXT_PUBLIC_BASE_URL`, tidak pernah dari header Host; di production tanpa
     nilai itu endpoint menjawab 503 dan tidak mengirim apa pun (sama untuk
     lupa kata sandi). Domain `invalid.reloop` (alamat pengganti akun yang
     dihapus) ditolak saat registrasi, ganti email, dan pembuatan akun oleh
     admin;
   - operator, untuk pemilik yang tidak bisa masuk maupun membuka email akun
     (metode `OPERATOR`, lihat prosedur di bawah).
   Permintaan publik yang tidak diverifikasi tidak pernah dieksekusi: job dan
   runner mengabaikan permintaan tanpa `verificationMethod`.
2. **Penahanan (PENDING_RECONCILIATION).** Di bawah lock User (urutan global
   User -> PayoutAccount -> Redemption), job membaca ulang saldo dan aktivitas.
   Jika saldo tersedia > 0, saldo ditinjau ≠ 0, saldo tertahan > 0, ada
   pencairan belum selesai, sesi setoran terbuka/ditinjau, atau trip
   PLANNED/ACTIVE atas nama pemilik, permintaan ditahan: **tidak ada data yang
   dihapus**, akun tetap aktif, login tidak dikunci, dan pengguna menerima
   `resolutionSteps`. Saldo tidak pernah dihanguskan. Saldo tersedia negatif
   (utang) tidak menahan penghapusan; ledger tetap menyimpannya.
3. **Anonimisasi (langkah `ANONYMIZE_ACCOUNT`).** Satu transaksi database: semua
   perubahan di tabel "Saat penghapusan" di bawah ditulis bersama entri audit
   `DATA_ERASURE`, atau tidak sama sekali.
4. **Pembersihan berkas (langkah `DELETE_PROOF_FILES`).** Setelah commit,
   folder bukti transfer pemilik dihapus dari penyimpanan privat. Gagal =
   `RETRYABLE_FAILED`, dicoba ulang dengan backoff (5 menit, berlipat, maks. 6
   jam).
5. **Selesai (`COMPLETED`).** Hanya ditulis bila semua langkah wajib memiliki
   `completedAt`, bersama audit `DATA_ERASURE_COMPLETED`.

Status: `PENDING` (belum diverifikasi) → `VERIFIED`/`PROCESSING` →
`PENDING_RECONCILIATION` (ditahan) / `RETRYABLE_FAILED` (dicoba ulang) →
`COMPLETED`. `REJECTED` = permintaan duplikat yang ditutup karena pemilik sudah
punya permintaan berjalan atau selesai.

## Matriks data

| Kelas data | Lokasi | Saat penghapusan | Alasan bisnis bila disimpan | Lama retensi |
|---|---|---|---|---|
| Nama, email, telepon | `User` | Diganti `Pengguna dihapus`, `erased-<id>@invalid.reloop`, `null` (lewat ekstensi enkripsi; `emailLookup` ikut berganti sehingga email lama bebas dipakai mendaftar lagi) | — | — |
| Kredensial dan sesi | `User.passwordHash`, `totpSecret`, `mfaEnabled`, `PasswordResetToken`, `DeviceToken`, sesi (`tokenVersion`) | Dihapus / dikosongkan; `tokenVersion` dinaikkan sehingga semua sesi dan tantangan MFA tidak berlaku; status `INACTIVE` | — | — |
| Baris akun pseudonim | `User.id`, `role`, `organizationId`, `createdAt`, `status`, `tokenVersion` | Disimpan, tanpa identitas | Menjaga foreign key nyata dari sesi setoran, ledger, pencairan, dan trip; menjaga pembukuan tetap utuh | per approved policy — owner: product/legal (to be set) |
| Sesi setoran dan item | `DepositSession`, `DepositItem` | Disimpan, `userId` tidak diubah | Bukti dasar reward, audit mesin, pencegahan penipuan, pelaporan dampak lingkungan | per approved policy — owner: product/legal (to be set) |
| Ledger reward | `RewardLedger` (termasuk `actorId`) | Disimpan **tanpa perubahan** (append-only) | Sumber kebenaran saldo dan rekonsiliasi keuangan. `actorId` berisi ID pseudonim pengguna atau ID operator, tidak memuat PII | per approved policy — owner: product/legal (to be set) |
| Pencairan: nominal, status, provider, metode, waktu, operator, kunci idempotency | `Redemption` | Disimpan | Pembukuan pembayaran, rekonsiliasi, sengketa | per approved policy — owner: product/legal (to be set) |
| Tujuan transfer (nomor, nama) | `Redemption.payoutDestinationIdentifier/Name` | Dikosongkan (sumber, provider, waktu pencatatan tetap) | — | — |
| Catatan bebas operator | `Redemption.note`, `reconciliationNote` | Dikosongkan | — (bisa memuat nomor rekening) | — |
| Nomor referensi transfer | `Redemption.providerReference` | Diganti sidik jari berkunci `erased-ref:<16 hex>` (HMAC, tidak dapat dibalik) | Mencocokkan transfer dengan mutasi bank tanpa menyimpan teks aslinya | per approved policy — owner: product/legal (to be set) |
| Bukti transfer | `Redemption.manualTransferProofUrl`, folder `REDEMPTION_PROOF_STORAGE_DIR/<redemptionId>/` | Tautan dilepas di transaksi; folder dihapus oleh langkah `DELETE_PROOF_FILES` | — (tangkapan layar memuat nomor/nama rekening) | — |
| Akun pencairan | `PayoutAccount` | Baris disimpan dengan status `DISABLED`, `accountIdentifier` kosong, `accountName` `null` | Referensi `payoutAccountId` lama tetap dapat diselesaikan; riwayat provider | per approved policy — owner: product/legal (to be set) |
| Trip | `Trip` (penerima reward `userId`, data grup/pemimpin dari pengelola trip) | Disimpan, `userId` tidak diubah | Operasional mitra dan laporan kepatuhan; data pemimpin trip milik pengelola trip, bukan profil pengguna | per approved policy — owner: product/legal (to be set) |
| Foto keamanan dan event mesin | `MachineCapture`, `MachineEvent` (terhubung ke sesi) | Disimpan | Investigasi keamanan dan penipuan mesin RVM | per approved policy — owner: product/legal (to be set) |
| Notifikasi dalam aplikasi | `Notification` | Dihapus | — | — |
| Persetujuan | `ConsentRecord` | Disimpan; `ipAddress` dan `userAgent` dikosongkan | Bukti pemberian/penarikan persetujuan | per approved policy — owner: product/legal (to be set) |
| Permintaan penghapusan dan langkahnya | `DeletionRequest`, `ErasureJobStep` | Disimpan; `email`, `ipAddress`, `userAgent`, `reason` dikosongkan | Bukti permintaan diterima, diverifikasi, dan dipenuhi | per approved policy — owner: product/legal (to be set) |
| Audit log | `AuditLog` (rantai hash) | Tidak diubah. Entri baru A04 tidak memuat email, nama, telepon, nomor rekening, atau catatan bebas | Keamanan dan akuntabilitas; rantai checksum tidak boleh ditulis ulang | per approved policy — owner: product/legal (to be set) |
| Data sementara Redis | penghitung rate limit (kunci IP/ID), ID tantangan MFA | Tidak disentuh; kedaluwarsa sendiri sesuai jendela teknisnya | Pembatasan penyalahgunaan | Jendela teknis (menit), bukan retensi data pribadi |
| Cadangan database dan berkas | di luar aplikasi | Tidak dijangkau job ini | Pemulihan bencana | per approved policy — owner: product/legal (to be set) |

**Sisa data lama yang tidak dapat ditulis ulang.** Entri audit dari sebelum
A04 dapat memuat email yang diketik (`ACCOUNT_DELETION_REQUESTED`,
`DATA_DELETION_REQUESTED`, dan `LOGIN_FAILED` yang memakai email sebagai
`entityId`) serta catatan operator pada `REDEMPTION_*`. Mengubahnya merusak
rantai checksum, jadi penanganannya diputuskan pemilik kebijakan (owner:
product/legal + security). Sejak A04, catatan operator pencairan hanya dicatat
sebagai `hasNote`; `LOGIN_FAILED` masih memakai email yang diketik dan menjadi
tindak lanjut tim auth.

## Prosedur operasional

### Menjalankan runner

Runner tidak dijadwalkan oleh repository ini. Operasional memutuskan jadwalnya
(cron, scheduler CI, atau manual) dan menjalankannya dengan environment aplikasi
yang sama (`DATABASE_URL`, `ENCRYPTION_KEY`, `REDEMPTION_PROOF_STORAGE_DIR`) di
host yang dapat mengakses folder bukti transfer:

```bash
npm run erasure:process                       # satu putaran (default maks. 50 permintaan)
npx tsx scripts/process-erasure-jobs.ts --limit 20
npx tsx scripts/process-erasure-jobs.ts --request <requestId>   # jalankan sekarang, abaikan backoff
```

- Satu putaran memproses permintaan terverifikasi yang langkah berikutnya sudah
  jatuh tempo: permintaan ditahan diperiksa ulang tiap 60 menit
  (`RECONCILIATION_RECHECK_MS`), langkah gagal setelah backoff-nya. Jadwal yang
  lebih jarang dari 60 menit hanya memperlambat kelanjutan permintaan ditahan.
- Aman dijalankan berulang atau paralel: langkah selesai dilewati, `COMPLETED`
  hanya ditulis sekali, file dihapus secara idempoten.
- Keluaran: JSON berisi `requestId` dan status saja. Exit code 0 = tidak ada
  yang gagal, 3 = ada `RETRYABLE_FAILED` (pasang alert), 2 = argumen salah,
  1 = runner gagal.
- Diagnosis: `SELECT "requestId", step, attempts, "nextAttemptAt", "lastError"
  FROM "ErasureJobStep" WHERE "completedAt" IS NULL;` — `lastError` hanya berisi
  kode (mis. `EACCES`, `HTTP_503`, `PROOF_STORAGE_MISSING`), bukan data.
  Perbaiki penyebab (izin folder, koneksi), lalu `--request <id>`.
- `PROOF_STORAGE_MISSING` berarti runner berjalan di host tanpa folder
  `REDEMPTION_PROOF_STORAGE_DIR` padahal ada bukti transfer yang harus dihapus.
  Runner sengaja gagal (bukan menandai selesai) agar berkas di host lain tidak
  dianggap terhapus; jalankan ulang di host yang memasang folder tersebut.

### Pemohon yang tidak bisa masuk

1. Pemilik yang masih bisa membuka email akun: arahkan ke formulir
   `/account-deletion`; tautan konfirmasi dikirim ke email akun.
2. Pemilik yang tidak bisa masuk **dan** tidak bisa membuka email akun
   (privacy@reloop.id):
   1. Minta pemohon mengisi formulir `/account-deletion` (atau cari
      `DeletionRequest` berstatus `PENDING` miliknya), lalu catat `requestId`.
   2. Verifikasi identitas di luar sistem sesuai daftar periksa verifikasi yang
      disetujui (owner: product/legal, to be set). Simpan bukti di tiket
      dukungan, bukan di database aplikasi.
   3. Jalankan:
      `npx tsx scripts/process-erasure-jobs.ts --operator-verify <requestId> --reference <ID-tiket>`
      Referensi hanya boleh berisi huruf, angka, `-_./` dan spasi (tanpa email
      atau data pribadi) karena tercatat di audit `DATA_ERASURE_VERIFIED`.
   4. Sampaikan status dari keluaran runner kepada pemohon. Setelah
      `COMPLETED`, sistem tidak lagi menyimpan alamat email pemohon, jadi
      konfirmasi dikirim dari tiket dukungan.
3. Permintaan publik yang dibuat sebelum A04 semuanya `PENDING` tanpa
   verifikasi dan tidak akan pernah dieksekusi otomatis; tangani dengan langkah
   1 atau 2.

### Permintaan yang ditahan

- Pengguna menyelesaikan sendiri: mencairkan saldo, menunggu pencairan selesai,
  menyelesaikan sesi, atau meminta pengelola trip menutup trip. Runner
  melanjutkan otomatis; pengguna juga dapat mengirim ulang dari aplikasi.
- Saldo di bawah minimum pencairan tidak bisa dicairkan pengguna. Tidak ada
  penghangusan otomatis; penyelesaiannya mengikuti kebijakan yang disetujui
  (owner: product/legal, to be set) dan dicatat sebagai transaksi baru, bukan
  dengan mengubah ledger lama.

## Batas yang diketahui

- Penulis reward dari tinjauan setoran dan event mesin belum memakai lock User
  (M04); check-out dan scan trip sudah (M03). Reward yang dibuat tepat setelah pemeriksaan
  penahanan dapat masuk ke akun yang sudah dianonimkan; ledger tetap mencatatnya
  dan rekonsiliasi menanganinya.
- Setelah selesai, sistem tidak dapat mengirim email konfirmasi (alamat sudah
  dihapus); status akhir ditampilkan di respons aplikasi/halaman konfirmasi.
