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
- Urutan lock global: User -> RewardFundingAccount -> Campaign -> Machine -> Trip -> DepositSession -> DepositItem -> Redemption -> RewardLedger. Pengajuan pencairan juga memegang baris `PayoutAccount` tujuan (`FOR SHARE`) tepat setelah User agar status akun tidak berubah di tengah keputusan.
- Setiap efek finansial baru memiliki `RewardLedger.businessKey` unik: `redemption:<id>:reserve` untuk reserve pencairan, `deposit-item:<id>:earn` untuk EARN setoran mesin. Baris lama bernilai `NULL`.
- Backstop database: maksimal satu EARN per `depositItemId` dan satu reserve per pencairan (index unik parsial pada migration `20261013122400_wallet_keys_enforce`). Idempotency pencairan unik per `(userId, idempotencyKey)`.
- Inventaris histori: `npm run reconcile:wallet` (read-only) melaporkan saldo negatif, duplikat, dan reserve tanpa pengajuan. Duplikat lama tidak pernah dihapus; prosedurnya ada di header `scripts/reconcile-wallet-history.ts`.
- Audit, notifikasi, dan transfer dijalankan setelah commit, tidak di dalam transaksi.
