# ReLoop Audit Remediation Design

Tanggal: 13 Oktober 2026. Baseline repository: `cdd31a5`. Status: rancangan untuk implementation plan yang diminta pengguna; belum diimplementasikan.

## Tujuan dan sumber

Tutup 30 temuan utama serta 4 temuan tambahan dari `artifacts/reloop-audit-2026-10-13.json`. Keberhasilan berarti invariant keamanan, uang, data mesin dan alur pengguna dibuktikan oleh pengujian yang relevan, termasuk PostgreSQL nyata. Audit visual, perangkat fisik dan production belum dilakukan; rencana memasukkan validasi tersebut sebagai release gate, bukan menganggapnya sudah lulus.

Empat temuan tambahan diberi ID stabil untuk pelacakan:
- EX-01: approval review paralel menggandakan ADJUST.
- EX-02: dua scan kantong terakhir memakai aggregate trip usang.
- EX-03: OR scope menimpa effectiveTo reward rate.
- EX-04: dua pengguna memperoleh sesi aktif mesin yang sama.

## Pendekatan yang dipilih

Remediasi bertahap dalam modular monolith yang ada. Pertahankan Next.js, PostgreSQL/Prisma 6, Flutter dan Python RVM; ekstrak service domain kecil hanya pada jalur yang membutuhkan transaksi bersama. Hindari perubahan ORM major bersamaan dengan perbaikan invariant uang. Dependency yang terkena advisory harus ditriage; jika tidak ada patch kompatibel, perubahan major menjadi task tersendiri dengan regression gate.

Alternatif patch per endpoint lebih cepat tetapi akan mengulang kebijakan reward/locking. Rewrite ledger atau microservices memerlukan migrasi dan operasional baru yang tidak diperlukan untuk menutup temuan. Service bersama + constraint DB memberi perubahan yang dapat ditinjau bertahap tanpa mengganti platform.

## Global constraints

- Seluruh nilai uang disimpan sebagai integer rupiah; API menolak pecahan, negatif yang tidak sah, overflow dan nilai di luar batas database.
- Ledger pengguna tetap menjadi sumber saldo; tidak menambahkan kolom saldo kedua tanpa mekanisme konsistensi yang dibuktikan.
- Gunakan Prisma Client 6 API `$transaction` / `$queryRaw` yang tersedia di generated client; jangan menyalin API Prisma 8 `db.transaction` ke repository ini.
- Operasi jaringan, email, push dan transfer pembayaran tidak dijalankan di dalam transaksi database.
- Semua mutasi saldo menggunakan lock user yang sama dan TransactionClient yang sama untuk baca serta tulis.
- Lock order: User -> RewardFundingAccount -> Campaign -> Machine -> Trip -> DepositSession -> DepositItem -> Redemption -> RewardLedger; jika beberapa ID satu kelas, urutkan leksikografis. Transaksi boleh memakai subset berurutan, tetapi tidak boleh memperoleh lock kelas sebelumnya setelah kelas berikutnya.
- Untuk mengetahui ID lock, baca relasi immutable terlebih dahulu; setelah lock diperoleh, baca ulang status, ownership dan angka yang menentukan keputusan.
- Setiap efek finansial baru memiliki business key unik; retry request identik tidak menghasilkan uang atau side effect kedua.
- API lama tetap didukung melalui field tambahan selama migrasi client; field keamanan yang tidak aman tidak diberi fallback permisif.
- Migrasi memakai expand -> backfill/reconcile -> enforce -> contract. Jangan menulis ulang histori finansial atau checksum audit lama untuk membuat laporan terlihat cocok.
- Seluruh pesan pengguna menggunakan bahasa Indonesia dan tidak memuat simulator, acceptance point, token atau detail protokol internal.
- Data cache private mobile dipisahkan per verified user ID, dan response akun lama tidak boleh ditulis setelah logout/pergantian akun.
- Perubahan perilaku mesin tidak dirilis sebelum mock safety tests dan uji hardware terkendali lulus.
- Tidak melakukan deploy, migrasi production, pengiriman undangan, penghapusan akun atau transfer nyata hanya karena dokumen rencana dibuat.

## Asumsi bisnis yang dipakai dalam plan

Asumsi ini menjaga perilaku yang sudah ada dan harus tercantum pada handoff implementasi. Jika pemilik produk mengubahnya, revisi task B terkait sebelum aktivasi fitur, bukan menghentikan hotfix security.

1. **Reward kantong = insentif partisipasi.** Default Rp2.000 per kantong yang diterbitkan dan dikembalikan dalam kondisi rewardable, dikalikan multiplier/compliance. Berat tetap menjadi data material. Tidak membayar kantong kosong: operator wajib mengonfirmasi berisi material; batas jumlah per peserta/trip dikonfigurasi per campaign dan diperiksa saat issuance. Campaign baru tidak dapat aktif sebelum batasnya diisi; campaign lama perlu policy snapshot dan review operator sebelum enforcement.
2. **Pickup = dispatch admin.** ADMIN/SUPERADMIN menugaskan satu mitra aktif; PENGEPUL menjalankan tugasnya. Tidak menambah marketplace self-claim pada remediasi ini; dokumentasi yang menyatakan self-assign diperbaiki.
3. **Fee pencairan = Rp0.** Schema mendukung gross/fee/net dan snapshot kebijakan, tetapi tidak mengaktifkan fee baru. Pengelola dapat menerbitkan kontrak biaya secara terpisah; klaim subscription/transaction fee otomatis pada docs diubah menjadi model komersial yang belum diaktifkan.
4. **Penerima reward trip = user yang dikonfirmasi di trip.** Admin memilih, recipient mengonfirmasi sebelum check-in pada trip MONEY_REWARD. Perubahan recipient setelah earning harus menggunakan workflow koreksi tersendiri, tidak mengubah ledger lama.
5. **Reward didanai organisasi atau sponsor melalui organisasi.** Akun funding menyimpan confirmed funding dan obligation. Budget campaign membatasi penerbitan reward. Funding manual baru aktif setelah ada referensi/bukti dan verifikasi SUPERADMIN; plan ini tidak membuat integrasi bank/prefunding otomatis.
6. **COMPLIANCE_ONLY tidak menciptakan uang.** Skor dan pencatatan material tetap berjalan. Tidak ada fallback ke tarif global untuk menerbitkan uang ketika rewardMode melarangnya.
7. **Saldo historis adalah kewajiban existing.** Backfill tidak menciptakan bukti kas fiktif. Kekurangan pendanaan dicatat sebagai gap; pengguna tidak kehilangan saldo. Earning baru dapat dibatasi setelah rekonsiliasi dan komunikasi rollout.
8. **Pembayaran bulk awal = manual yang tercatat.** Collector melaporkan pembayaran; pengelola mengonfirmasi penerimaan. Status logistik dan keuangan terpisah; tidak ada transfer uang otomatis.

## Kontrak transaksi dan domain

### Wallet dan payout

Tambahkan `lib/wallet-service.ts` sebagai pemilik request/transition pencairan, bukan memindahkan seluruh ledger ke framework baru. `getWalletBalance(userId, tx?)` harus mendukung pembacaan melalui transaction yang sama. `RewardLedger.businessKey String? @unique` ditambahkan secara additive dan seluruh write baru wajib mengisinya lewat service.

`Redemption` mendapat `requestHash`, destination snapshot encrypted, `grossAmount`, `feeAmount`, `netAmount`, `policyVersion`. Field `amount` lama dipertahankan sama dengan gross untuk kompatibilitas. Default backfill gross=amount, fee=0, net=amount. Idempotency scoped per user dengan `@@unique([userId, idempotencyKey])`; request dengan key sama tetapi body berbeda ->409. Status sukses berarti bukti transfer sudah tersedia; timeout transfer tidak boleh otomatis dianggap gagal dan melepaskan reserve.

Jumlah tersedia = AVAILABLE EARN + AVAILABLE ADJUST + PENDING/REDEEMED REDEEM (debit bertanda negatif). Pending earning, reserved dan paid dilaporkan terpisah. Koreksi setelah uang terbayar tidak boleh diam-diam membuat saldo spendable negatif; tandai kasus rekonsiliasi dan gunakan proses recovery yang ditinjau operator.

### Reward dan funding

`lib/reward-policy.ts` menghitung keputusan murni tanpa database. `lib/reward-credit.ts` menulis EARN/ADJUST satu kali dari business key dan memeriksa policy/funding ketika enforcement aktif. Semua jalur mesin, review, bulk checkout dan progressive bags memakai service yang sama.

Tambahkan funding account per organisasi, immutable funding entries, campaign limit/reservation, dan allocation debit ke sumber earning. Satu allocation mencatat `redemptionId`, `creditLedgerId`, `organizationId`, `amount`, `status` (RESERVED/PAID/RELEASED), serta unique pasangan redemption-credit. FIFO berdasarkan `(createdAt,id)` untuk kredit AVAILABLE, termasuk ADJUST positif; ADJUST negatif harus mengurangi sisa lot di bawah lock. Earning PENDING mereservasi maksimum kewajiban yang mungkin disetujui, bukan hanya nominal sementara; review/rejection menyesuaikan reservation atomik.

Funding confirmed = kas yang sudah dikonfirmasi operator. Funding held = total kewajiban reward belum dibayar, termasuk reserve payout dan review maksimum. Payout sukses mengurangi confirmed dan held sebesar gross; cancellation payout mengembalikan spendable pengguna tetapi tetap merupakan kewajiban funding. Rejected earning melepaskan hold. Budget campaign yang sudah dikonsumsi oleh reward dibayar tidak terisi ulang setelah payout.

### Mesin dan sinkronisasi

Backend response batch tetap HTTP200 ketika struktur batch valid, dengan hasil per event. `accepted` dan `duplicate` adalah ACK durable; `error` berisi error code stabil dan `retryable`. RVM hanya menandai ACK yang cocok dengan localEventId. Protocol contract version ditambahkan secara additive; response legacy atau malformed tidak boleh menghapus antrean.

Satu mesin maksimal memiliki satu sesi RESERVED/ACTIVE/PROCESSING_ITEM/REVIEW. Unique partial index dan lock Machine menegakkan ini; sesi REVIEW yang masih memblokir mesin mengikuti kebijakan close yang eksplisit, bukan dihapus agar constraint lolos. Resume sesi yang dimiliki user tidak menerbitkan lease baru tanpa validasi mesin. Interlock lokal memiliki prioritas di atas lease backend; renewable lease tidak boleh menghapus safety latch.

### Auth, privasi dan audit

Session JWT memiliki `purpose=session`, issuer `reloop`, audience `reloop-session`, dan claim wajib tervalidasi. MFA challenge memiliki audience `reloop-mfa`, user tokenVersion dan identifier sekali pakai. Session lama tanpa purpose ditolak pada rollout; pengguna perlu login ulang.

MFA replacement menggunakan pending secret encrypted dengan expiry 10 menit. Faktor aktif tetap digunakan sampai kode pending valid. Password dan faktor lama wajib diperiksa pada replacement/disable, tanpa mengandalkan session saja. Recovery di luar kehilangan faktor tetap proses operator yang terdokumentasi, bukan bypass setup.

Invitation hanya diklaim lewat token acak yang disimpan sebagai hash dan terikat normalized email, agent, organisasi, expiry 24 jam, single-use. Penggantian email profil mencabut status verified; invitation tidak otomatis menautkan akun hanya karena email cocok. Existing privileged membership yang belum terbukti emailnya ditandai untuk re-verification dengan komunikasi rollout.

Erasure mempertahankan ID user pseudonymous untuk integritas FK dan akuntansi, menghapus PII yang tidak perlu, secret, device tokens dan cache. Request dengan kewajiban finansial yang belum beres masuk pending reconciliation terlebih dahulu; jangan membuat klaim seluruh data sudah dihapus. File cleanup dijalankan lewat durable job. Identitas pemohon public deletion request harus diverifikasi sebelum tindakan.

Audit chain baru memakai canonical format version=2, timestamp yang disimpan, normalization null dan nomor urut deterministik. Legacy chain diarsipkan sebagai legacy/unverifiable bila memang tidak dapat dibuktikan, lalu dihubungkan dengan checkpoint digest. Jangan menghitung ulang signature lama dan menyebutnya bukti keaslian.

## Pengukuran penutupan

Setiap finding memiliki task, test/evidence, migration status dan release status. `IMPLEMENTED` berbeda dari `VERIFIED` dan `RELEASED`. Race tests menggunakan PostgreSQL dengan minimal dua koneksi dan sinkronisasi deterministik, bukan `Promise.all` di atas mock transaction. Uji browser memakai staging fixture, bukan transaksi produksi. RVM hardware gate memerlukan teknisi, fixture aman dan bukti output aktuator.

## Referensi teknis

- PostgreSQL row lock bertahan selama transaksi: https://www.postgresql.org/docs/16/explicit-locking.html
- Partial unique index untuk subset state: https://www.postgresql.org/docs/16/indexes-partial.html
- Source of truth API Prisma 6 repository: `node_modules/.prisma/client/index.d.ts` (`$transaction`, `$queryRaw`, `TransactionIsolationLevel`). Dokumentasi current Prisma/Context7 pada saat perencanaan menampilkan API versi 8; jangan menggunakannya sebagai drop-in untuk v6.
- Audit, source references dan evidence limits: `artifacts/reloop-audit-2026-10-13.json`.
