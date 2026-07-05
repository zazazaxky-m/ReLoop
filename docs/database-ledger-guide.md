# Panduan Buku Besar (Ledger) Database ReLoop

Berbeda dengan sistem *wallet* tradisional yang sering kali hanya memperbarui kolom `balance` (saldo) secara langsung, ReLoop menggunakan sistem **Ledger (Buku Besar) Append-Only**.

Sistem ini memastikan bahwa setiap perubahan saldo pengguna, organisasi, atau pengepul memiliki rekam jejak (*audit trail*) yang tidak bisa diubah (*immutable*).

## 1. Tabel Utama: `RewardLedger`

Tabel `RewardLedger` mencatat semua arus masuk dan keluar poin/uang dalam platform.

### Kolom Kunci:
- `userId`: Pengguna yang memiliki saldo tersebut.
- `transactionType`: Jenis transaksi, misalnya:
  - `DEPOSIT_REWARD`: Pendapatan poin dari menyetor sampah di Kiosk.
  - `TRIP_REWARD`: Pendapatan poin hasil konversi Trash Bag dari sistem Trip pariwisata.
  - `REDEMPTION_WITHDRAWAL`: Pemotongan saldo karena pengguna mencairkan poin ke e-Wallet / Bank.
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
3. **Race Condition Prevention**: Jika ada dua pencairan bersamaan, database tidak akan saling mengunci (deadlock) pada satu baris `User.balance`. Keduanya sekadar menulis baris baru di `RewardLedger`.
