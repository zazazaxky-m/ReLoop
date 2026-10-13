# Panduan Buku Besar (Ledger) Database ReLoop

Berbeda dengan sistem *wallet* tradisional yang sering kali hanya memperbarui kolom `balance` (saldo) secara langsung, ReLoop menggunakan sistem **Ledger (Buku Besar) Append-Only**.

Sistem ini memastikan bahwa setiap perubahan saldo pengguna, organisasi, atau pengepul memiliki rekam jejak (*audit trail*) yang tidak bisa diubah (*immutable*).

## 1. Tabel Utama: `RewardLedger`

Tabel `RewardLedger` mencatat semua arus masuk dan keluar poin/uang dalam platform.

### Kolom Kunci:
- `userId`: Pengguna yang memiliki saldo tersebut.
- `entryType`: Jenis entri ledger (`EARN`, `REDEEM`, dll.).
- `reasonCode`: Alasan bisnis, misalnya:
  - `DEPOSIT_ACCEPTED` / `ITEM_ACCEPTED`: Pendapatan dari setoran mesin RVM.
  - `TRASH_BAG_RETURN`: Reward pengembalian trash bag setelah check-out trip wisata (`referenceType: Trip`).
  - `TOURISM_COMPLIANCE_BONUS`: Bonus demo/seed kepatuhan wisata (bukan jalur produksi utama).
  - `REDEMPTION_RESERVE` / `REDEMPTION_SUCCESS`: Pencairan ke e-wallet / bank.
- `status`: Status dari transaksi tersebut:
  - `PENDING`: Poin sudah didapat tapi masih ditahan (misal: mesin belum di-verifikasi, atau sedang dalam proses pencairan). Saldo jenis ini belum bisa dibelanjakan.
  - `AVAILABLE`: Poin sudah sah dan bisa ditarik/dibelanjakan oleh pengguna.
  - `REDEEMED`: Saldo sudah berhasil ditarik menjadi uang riil.

## 2. Cara Menghitung Saldo Akhir (Balance)

Karena tidak ada kolom khusus `current_balance` pada entitas User, maka saldo total pengguna dihitung secara agregat *(sum)* dari seluruh baris di `RewardLedger` miliknya.

**Rumus:**
`Saldo Aktif = SUM(amount) di mana status = 'AVAILABLE'`
`Saldo Tertahan = SUM(amount) di mana status = 'PENDING'`

*Catatan: Nilai transaksi keluar (penarikan tunai) akan dicatat sebagai angka negatif (contoh: `-50000`), sehingga fungsi agregat SUM() akan otomatis menguranginya dari saldo total.*

## 3. Keuntungan Sistem Append-Only

1. **Anti-Fraud**: Tidak mungkin ada admin nakal yang bisa "mengubah" saldo `100` menjadi `1000` dengan mengubah satu angka. Mereka harus membuat transaksi buatan baru (yang akan terdeteksi di log).
2. **Rekonsiliasi Keuangan**: Sistem ini sangat disukai oleh akuntan mitra karena setiap perak yang keluar bisa ditelusuri riwayat asalnya.
3. **Mutasi saldo diserialkan per pengguna**: Menulis baris baru saja tidak mencegah dua pencairan paralel memakai saldo yang sama (keduanya bisa membaca saldo lama). Karena itu setiap mutasi saldo mengikuti aturan di bawah.

## 4. Aturan transaksi saldo (M01)

- Saldo tetap dihitung dari ledger (`getWalletBalance(userId, tx?)`); tidak ada kolom saldo kedua.
- Setiap transaksi yang menulis EARN/ADJUST/REVERSE/PENALTY/REDEEM memanggil `lockUser(tx, userId)` (`lib/db-locks.ts`, `SELECT ... FOR NO KEY UPDATE`) lebih dulu, lalu membaca saldo, status, kepemilikan, dan idempotency melalui `tx` yang sama. Isolasi transaksi ReadCommitted eksplisit. Pengajuan pencairan sudah mengikuti aturan ini; writer mesin, fraud, review, dan trip dipindahkan oleh M03/M04, dan rollout uang tetap tertahan di gate Z01 sampai semuanya patuh.
- Urutan lock global: User -> PayoutAccount -> RewardFundingAccount -> Campaign -> Machine -> Trip -> DepositSession -> DepositItem -> Redemption -> RewardLedger. Pengajuan pencairan memegang baris `PayoutAccount` tujuan (`FOR SHARE`) tepat setelah User agar status akun tidak berubah di tengah keputusan. Transisi pencairan (M02) mengunci User pemilik (dibaca dari `Redemption.userId` yang immutable), lalu baris Redemption, lalu baru mengubah reserve di RewardLedger.
- Setiap efek finansial baru memiliki `RewardLedger.businessKey` unik: `redemption:<id>:reserve` untuk reserve pencairan, `deposit-item:<id>:earn` untuk EARN setoran mesin. Baris lama bernilai `NULL`.
- Backstop database: maksimal satu EARN per `depositItemId` dan satu reserve per pencairan (index unik parsial pada migration `20261013122400_wallet_keys_enforce`). Idempotency pencairan unik per `(userId, idempotencyKey)`.
- Inventaris histori: `npm run reconcile:wallet` (read-only) melaporkan saldo negatif, duplikat, dan reserve tanpa pengajuan. Duplikat lama tidak pernah dihapus; prosedurnya ada di header `scripts/reconcile-wallet-history.ts`.
- Audit, notifikasi, dan transfer dijalankan setelah commit, tidak di dalam transaksi.
- Transisi pencairan (M02, `transitionRedemption` di `lib/wallet-service.ts`): status pengajuan berubah lewat compare-and-set pada status yang dibaca di bawah lock, dan reserve berubah lewat `settleRedeemLedger(redemptionId, outcome, tx)` yang hanya membuktikan settlement yang sudah sesuai atau melakukan tepat satu update bersyarat `PENDING`. Reserve hilang, jumlah/pemilik berbeda, atau outcome berlawanan menghasilkan 409 dan rollback. Mengulang outcome yang sama hanya idempotent bila ledger sudah sesuai.
- Transfer yang hasilnya tidak pasti tidak pernah ditandai gagal: pengajuan tetap PROCESSING dengan `reconciliationRequired` dan reserve tetap `PENDING` sampai hasilnya dipastikan. Idempotency key ke provider payout adalah `redemption:<id>:payout` (`payoutIdempotencyKey`), bukan `Redemption.idempotencyKey` milik klien.
- Tujuan transfer disalin terenkripsi ke `Redemption.payoutDestination*` saat pengajuan (`REQUEST_SNAPSHOT`). Pengajuan lama tanpa salinan mencatat akun saat aksi operator pertama sebagai `LEGACY_ACCOUNT_FALLBACK`, atau `LEGACY_UNAVAILABLE` bila akunnya sudah tidak ada (tidak ada nomor yang ditebak). Migration `20261013131619_redemption_destination_snapshot` hanya menambah kolom (expand), tanpa backfill. Permintaan hapus data (`processErasureRequest`) mengosongkan nomor dan nama tujuan pada pengajuan yang sudah selesai (SUCCESS/FAILED/REVERSED; provider, sumber, dan waktu salinan tetap), mencatat jumlah yang dihapus dan yang masih ditahan untuk settlement di log penghapusan, dan antrean menampilkannya sebagai "dihapus".
