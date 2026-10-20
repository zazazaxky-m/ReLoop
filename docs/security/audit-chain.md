# Rantai audit v2 dan arsip legacy (A05 / SEC-08)

`AuditLog` adalah log append-only yang setiap barisnya terhubung ke baris
sebelumnya lewat checksum. Dokumen ini menjelaskan kontrak format versi 2,
cara verifikasi, status arsip lama (versi 1), dan prosedur checkpoint untuk
operasional.

## Masalah yang ditutup

Sebelum A05, rantai tidak dapat diverifikasi secara andal:

- `logAudit` meng-hash timestamp aplikasi yang dibuat sebelum transaksi, tetapi
  `createdAt` diisi database saat insert. Timestamp yang di-hash tidak pernah
  disimpan.
- Writer dan verifier menserialisasi nilai kosong secara berbeda: `actor`
  hilang (writer) vs `null` (verifier), `entity` `Tipe:undefined` vs
  `Tipe:null`, `meta` hilang vs `null`.
- PostgreSQL JSONB menyusun ulang key metadata, sehingga JSON yang dibaca
  kembali tidak sama dengan yang di-hash.
- Writer memilih "baris terakhir" dan verifier mengurutkan menurut `createdAt`.
  Timestamp yang sama, atau timestamp database yang lebih awal dari baris yang
  menunggu lock, membuat urutan ambigu dan rantai bisa bercabang.

## Format versi 2 (`lib/audit.ts`)

- **Satu pembentuk baris dan satu canonicalizer.** `buildAuditRow(input,
  createdAt)` dan `canonicalAuditPayload(entry)` dipakai `logAudit`,
  `logAuditInTransaction`, seed demo, event checkpoint, dan verifier.
- **Canonical.** JSON dengan key terurut rekursif dari `{ v: 2, createdAt (ISO),
  actorId, action, entityType, entityId, metadataJson }`. Field opsional yang
  tidak diisi dan yang diisi `null` sama-sama menjadi `null`. Metadata disimpan
  dan di-hash dalam bentuk yang dikembalikan PostgreSQL: member `undefined`
  hilang, angka non-finite menjadi `null`, dan `Date` di dalam array menjadi
  string ISO. Urutan elemen array tetap dihitung karena itu bagian dari data.
- **Timestamp.** `createdAt` dibuat sekali, setelah lock diperoleh, lalu
  disimpan persis seperti yang di-hash.
- **Nomor urut.** `chainSequence` dialokasikan sebagai head + 1 di bawah
  `pg_advisory_xact_lock(8675309)`, dalam transaksi yang sama dengan insert.
  Rollback membuang baris beserta nomornya, sehingga writer berikutnya memakai
  nomor yang sama dan terhubung ke head yang sudah commit. Tidak ada celah dan
  tidak ada link phantom. Transaksi penulis harus READ COMMITTED (`logAudit` dan
  `runWalletTransaction` sudah begitu). Dengan snapshot yang basi, unique index
  `chainSequence` membuat insert gagal, bukan bercabang.
- **Checksum.** `HMAC-SHA256(AUDIT_CHECKSUM_SECRET, "reloop-audit-v2\n" +
  chainSequence + "\n" + previousHash + "\n" + canonical)`.
- **Dalam transaksi pemanggil.** `logAuditInTransaction(tx, …)` tetap commit
  atau rollback bersama perubahan yang dicatatnya (dipakai penghapusan akun
  A04). Lock rantai ditahan sampai pemanggil commit, jadi panggil di akhir.
  `logAudit` tetap best-effort: kegagalan hanya di-log, tidak dilempar.

## Database (migration `20261014200000_audit_chain_v2`)

| Objek | Isi |
| --- | --- |
| `chainVersion INT NOT NULL` | Semua baris yang sudah ada diberi `1` secara eksplisit, baru kemudian default diubah menjadi `2`. |
| `chainSequence BIGINT` unique, nullable | Posisi di rantai v2. Baris legacy tetap `NULL`. |
| CHECK `AuditLog_chain_version_sequence` | Sebuah baris adalah legacy (versi 1, tanpa nomor) atau v2 (versi 2, dengan nomor). |
| Trigger `AuditLog_unsequenced_is_legacy` | Insert tanpa nomor urut, misalnya dari kode sebelum A05 yang masih berjalan saat rollout, disimpan sebagai versi 1. Data tidak hilang dan tidak masuk rantai v2. |
| Trigger `AuditLog_legacy_immutable` | UPDATE dan DELETE pada baris versi 1 ditolak. |

`previousHash` dan `checksum` lama tidak pernah ditulis ulang, dan checksum lama
tidak dihitung ulang. Prisma 6 tidak memodelkan CHECK dan trigger, jadi
keduanya dikelola manual seperti partial unique index M01/M03.

Database pengembangan yang sudah berisi audit lama tidak bisa di-seed ulang
dengan `npm run db:seed`, karena `wipe()` menghapus `AuditLog` dan trigger
menolak penghapusan baris versi 1. Gunakan `npm run db:reset`. Seed sekarang
menulis rantai v2 lewat writer produksi; hanya timestamp demonya yang dimundurkan.

## Verifikasi (`POST /api/audit/verify`, SUPERADMIN)

| Field | Arti |
| --- | --- |
| `valid` | Validitas **rantai v2 saja**. Baris dibaca menurut `chainSequence`, bukan timestamp. Setiap baris harus versi 2, berada di nomor berikutnya, `previousHash` sama dengan checksum sebelumnya, dan checksum sama dengan HMAC atas canonical baris yang tersimpan. |
| `brokenAt`, `reason` | Hanya muncul jika `valid: false`. `reason` berisi `version`, `sequence` (celah, nomor berubah, atau baris tanpa nomor yang bukan legacy), `previous-hash`, atau `checksum` (isi atau checksum berubah). |
| `checkedVersion` | Selalu `2`. |
| `checkedCount` | Jumlah baris v2 yang lolos verifikasi. |
| `legacyStatus` | `not-present` (tidak ada baris versi 1), `unverifiable`, atau `valid`. Nilai `valid` hanya diberikan jika setiap checksum lama cocok dengan rumus v1 atas data yang tersimpan, dibaca menurut `(createdAt, id)`. Tidak ada yang dihitung ulang atau ditandatangani ulang. Sebagian besar baris dari `logAudit` lama akan `unverifiable` karena timestamp yang di-hash tidak disimpan. Status ini tidak memengaruhi `valid`. |
| `legacyCount` | Jumlah baris versi 1. |
| `legacyCheckpoint` | `not-required` (tidak ada legacy dan tidak ada checkpoint), `missing` (ada legacy tetapi belum ada checkpoint), `matches` (jumlah dan digest arsip sama dengan event checkpoint di bagian rantai v2 yang terverifikasi), atau `mismatch` (arsip berubah setelah checkpoint). |

Respons tidak pernah memuat secret. Halaman audit superadmin
(`components/security/AuditChainVerifier.tsx`) menampilkan rantai baru, arsip
lama, dan checkpoint sebagai baris terpisah. Arsip yang `unverifiable`
ditampilkan sebagai "tidak dapat diverifikasi", tidak pernah sebagai valid.

`GET /api/mobile/audit-security` kini juga mengirim `chainVersion` dan
`chainSequence` untuk setiap baris. `chainSequence` dikirim sebagai string
(atau `null`) karena BigInt bukan JSON.

## Prosedur checkpoint arsip legacy (operasional)

Checkpoint mencatat jumlah dan digest arsip versi 1 sebagai satu event v2
(`AUDIT_CHAIN_CHECKPOINT`, entity `AuditChain`/`legacy-v1`). Setelah itu,
perubahan apa pun pada arsip lama terlihat sebagai `legacyCheckpoint:
"mismatch"`. Checkpoint tidak membuktikan keaslian arsip yang sudah ada sebelum
A05. Arsip itu tetap berstatus `unverifiable`; checkpoint hanya membekukannya.

1. **Selesaikan rollout terlebih dahulu.** `scripts/deploy.sh` menjalankan
   `db-migrate` saat container web lama masih hidup. Audit yang ditulis kode
   lama setelah migrasi disimpan sebagai versi 1, sehingga mengubah digest.
   Jalankan checkpoint hanya setelah semua instance memakai kode A05.
2. **Dry run (default, read-only).** Jalankan dengan `DATABASE_URL` dan
   `AUDIT_CHECKSUM_SECRET` lingkungan target:
   `npm run audit:checkpoint` atau `npx tsx scripts/checkpoint-audit-chain.ts`.
   Output berupa JSON berisi `legacyCount`, `legacyDigest`, `legacyStatus`,
   checkpoint yang sudah ada, dan `elapsedMs`. Output tidak memuat secret. Simpan JSON di tiket
   perubahan.
3. **Tinjau.** Bandingkan `legacyCount` dengan `SELECT count(*) FROM
   "AuditLog" WHERE "chainVersion" = 1` dan dengan backup terakhir sebelum
   migrasi. Pastikan digest dicatat di tiket oleh peninjau. Digest dapat
   dihitung ulang tanpa secret: sha256 atas `"reloop-audit-legacy-v1\n"`
   diikuti, untuk setiap baris versi 1 menurut `(createdAt, id)`, array JSON
   `[id, createdAt ISO, actorId, action, entityType, entityId, metadataJson
   (key terurut rekursif), previousHash, checksum]` dan `"\n"`.
4. **Apply dengan digest yang sudah ditinjau.**
   `npx tsx scripts/checkpoint-audit-chain.ts --apply --expected-digest <legacyDigest>`.
   Di bawah lock rantai dan `LOCK TABLE "AuditLog" IN SHARE ROW EXCLUSIVE MODE`,
   script menghitung ulang digest. Event ditulis hanya jika digest masih sama
   dan belum ada checkpoint. Selama proses, penulisan audit lain menunggu kira-kira
   selama `elapsedMs` dry run. `logAudit` menyerah setelah 5 detik dan hanya
   mencatat kegagalan di log server, jadi jika dry run lebih lama dari beberapa
   detik, jalankan apply di jendela pemeliharaan. Baris legacy tidak diubah.
5. **Periksa.** Di halaman audit superadmin, klik "Verifikasi rantai". Hasil
   yang diharapkan: rantai baru valid, arsip lama `unverifiable` (atau
   `valid`), dan "Arsip lama tidak berubah sejak checkpoint dicatat".

| Exit | `outcome` | Tindakan |
| --- | --- | --- |
| 0 | `dry-run` | Tinjau, lalu lanjut ke langkah 4. |
| 0 | `written` | Selesai. Lanjut ke langkah 5. |
| 0 | `already-recorded` | Checkpoint dengan digest yang sama sudah ada. Tidak ada yang ditulis. |
| 0 | `nothing-to-checkpoint` | Tidak ada baris versi 1. Tidak ada yang ditulis dan checkpoint tidak diperlukan. |
| 3 | `digest-mismatch` | Arsip berubah sejak dry run yang ditinjau. Tidak ada yang ditulis. Ulangi langkah 2–3 dan selidiki penyebab perubahan. |
| 3 | `checkpoint-conflict` | Arsip tidak lagi sama dengan checkpoint yang tercatat. Tangani sebagai insiden keamanan: jangan membuat checkpoint baru, jangan mengubah baris, dan bandingkan dengan backup. |
| 2 | — | Argumen salah. `--apply` wajib disertai `--expected-digest` berupa 64 karakter hex huruf kecil. |
| 1 | — | Script gagal (koneksi atau database). Tidak ada perubahan parsial: event hanya ditulis di akhir transaksi. |

## Batas yang diketahui

- **Ujung rantai.** Penghapusan baris di ujung rantai v2 tidak terdeteksi oleh
  hash chain saja. Catat `checkedCount` hasil verifikasi secara berkala di luar
  database (tiket atau log operasional) sebagai jangkar pembanding.
- **Rotasi secret.** Mengganti `AUDIT_CHECKSUM_SECRET` membuat semua baris v2
  sebelumnya gagal diverifikasi, karena belum ada versioning kunci. Jangan
  rotasi tanpa rencana migrasi kunci terpisah.
- **Trigger bisa dimatikan.** Pemilik tabel dapat menonaktifkan trigger.
  Perubahan arsip legacy setelah checkpoint tetap terdeteksi lewat digest, tetapi
  perubahan sebelum checkpoint tidak.
- **Rantai rusak sebelum checkpoint.** Event checkpoint hanya dibaca dari bagian
  rantai yang terverifikasi. Jika rantai rusak sebelum event itu, status
  checkpoint dilaporkan `missing` sampai kerusakannya ditangani. Script tetap
  menolak checkpoint kedua.
- **`Date` di metadata.** `redactAuditMetadata` (perilaku lama) mengubah objek
  `Date` yang langsung menjadi nilai field metadata menjadi `{}`. Writer dan
  verifier menyimpan dan meng-hash bentuk yang sama, jadi rantai tetap valid,
  tetapi isi tanggal itu hilang. Kirim tanggal sebagai string ISO.
