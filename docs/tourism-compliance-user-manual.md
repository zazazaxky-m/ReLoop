# User Manual MVP Tourism Compliance

Manual ini menjelaskan flow MVP program wisata Pangandaran: travel agent, trash bag QR, validasi gerbang masuk/pulang, compliance, dan pickup Bank Sampah.

## Konsep Utama

MVP ini memakai `Campaign` sebagai payung program.

- Campaign mesin tetap memakai `rewardMode = MONEY_REWARD`.
- Campaign wisata Pangandaran memakai `rewardMode = COMPLIANCE_ONLY`.
- Reward uang mesin tetap masuk ke wallet/ledger seperti sebelumnya.
- Program wisata fokus pada status patuh/tidak patuh travel agent, bukan pembayaran uang.

## Role

- `SUPERADMIN`: membuat organisasi, user admin, dan konfigurasi global.
- `ADMIN`: admin tempat wisata/petugas gerbang. Mengelola campaign wisata, travel agent, trip, QR trash bag, dan validasi.
- `PENGEPUL`: Bank Sampah. Mencatat pickup trash bag/sampah terpilah setelah trip selesai.
- `USER`: pengguna mesin, tour leader, atau akun travel agent yang menerima invite.

Travel agent bukan role baru. Travel agent adalah entitas bisnis yang bisa terhubung ke banyak organisasi/tempat wisata.

## Setup Awal Admin

1. Login sebagai `ADMIN`.
2. Buka `Campaign`.
3. Buat campaign baru:
   - Tipe: `Program Wisata` atau `Trash Bag / Trip`
   - Mode reward: `Compliance only`
   - Status: `Aktif`
4. Buka `Travel Agent`.
5. Klik `Tambah Agent`.
6. Isi nama agent, email, kontak person, nomor HP, dan catatan jika perlu.
7. Sistem menyimpan agent dengan status berdasarkan email:
   - `PENDING`: email belum punya akun user.
   - `INVITED`: email sudah punya akun user dan otomatis terhubung ke travel agent.

Catatan: MVP ini tidak mengirim email otomatis dan tidak memakai link undangan. Email hanya dipakai sebagai kunci pencocokan akun.

## Aktivasi Travel Agent

1. Jika email travel agent belum punya akun, status agent di organisasi adalah `PENDING`.
2. Travel agent membuat akun biasa melalui halaman register memakai email yang sama.
3. Setelah akun dibuat, sistem otomatis mengubah status menjadi `INVITED`.
4. Akun user tersebut otomatis terhubung ke travel agent.

Satu travel agent bisa diundang oleh lebih dari satu tempat wisata. Data agent tetap satu, relasi organisasinya bertambah.

## Membuat Trip Rombongan

1. Login sebagai `ADMIN`.
2. Buka `Trip / Trash Bag`.
3. Klik `Buat Trip`.
4. Pilih campaign wisata.
5. Pilih travel agent.
6. Isi nama grup, leader, kontak leader, dan jumlah peserta.
7. Klik `Buat Trip`.

Setiap trip mewakili satu rombongan wisatawan dari satu travel agent.

## Menerbitkan Trash Bag QR

1. Di halaman `Trip / Trash Bag`, klik `Tas` pada trip.
2. Isi jumlah trash bag.
3. Pilih jenis sampah jika kantong ingin dipetakan, misalnya `Botol Plastik` atau `Kaleng Aluminium`.
4. Klik `Terbitkan`.
5. Sistem membuat kode QR unik per trash bag, misalnya `BAG-XXXX`.

QR ini dipakai untuk menghubungkan trash bag dengan trip/rombongan. Jika jenis sampah dipilih, label cetak QR dan halaman user akan menampilkan mapping jenis sampah tersebut.

## Validasi Gerbang Masuk

1. Di halaman `Trip / Trash Bag`, klik `Validasi`.
2. Pilih tahap `Gerbang masuk`.
3. Pilih apakah aplikasi sudah diisi.
4. Simpan validasi.

Hasil:

- Trip berubah menjadi `ACTIVE`.
- Compliance status menjadi `CHECKED_IN`.
- Skor awal diberikan berdasarkan pengisian aplikasi.

## Validasi Gerbang Pulang

1. Di halaman `Trip / Trash Bag`, klik `Validasi`.
2. Pilih tahap `Gerbang pulang`.
3. Isi QR trash bag jika ada.
4. Isi jumlah tas kembali.
5. Isi berat aktual jika ada.
6. Pilih kondisi:
   - `GOOD`: sampah terpilah baik
   - `PARTIAL`: sebagian sesuai
   - `POOR`: buruk/tidak sesuai
   - `NOT_RETURNED`: tidak kembali
7. Simpan validasi.

Sistem menghitung skor:

- Aplikasi diisi: 30 poin
- Trash bag kembali: maksimal 40 poin
- Sampah terpilah: maksimal 30 poin

Hasil:

- `80-100`: `COMPLIANT`
- `50-79`: `NEEDS_REVIEW`
- `0-49`: `NON_COMPLIANT`

## Dashboard Compliance

Admin membuka `Compliance` untuk melihat:

- total trip wisata
- jumlah trip patuh
- jumlah trip tidak patuh
- compliance rate per travel agent

Dashboard ini menjadi output utama jika tempat wisata tidak menyediakan uang reward.

## Pickup Bank Sampah

1. Login sebagai `PENGEPUL`.
2. Buka `Pickup Wisata`.
3. Pilih trip yang sudah selesai.
4. Klik `Catat Pickup`.

Sistem mencatat validasi `BANK_SAMPAH_PICKUP` sebagai bukti bahwa sampah terpilah sudah diambil Bank Sampah.

## Integrasi Dengan Mesin

Flow mesin tidak berubah:

- user scan mesin
- setor botol/kaleng
- item divalidasi
- reward uang masuk ke `RewardLedger`
- saldo tampil di wallet user

Program wisata memakai campaign yang sama secara konsep, tetapi `rewardMode = COMPLIANCE_ONLY`, sehingga tidak membuat reward uang otomatis.

Jika nanti ada sponsor atau dana reward, campaign wisata bisa dibuat/diubah menjadi `MONEY_REWARD`, dan validasi trash bag yang valid dapat masuk ke ledger user seperti reward mesin.

## Rekomendasi Operasional MVP

- Gunakan satu campaign aktif untuk pilot Pangandaran.
- Daftarkan travel agent sebelum hari operasional.
- Petugas gerbang masuk fokus pada check-in dan pembagian trash bag.
- Petugas gerbang pulang fokus pada jumlah tas kembali dan kondisi pemilahan.
- Bank Sampah hanya mencatat pickup setelah trip selesai.
- Gunakan dashboard compliance untuk evaluasi travel agent per periode.
