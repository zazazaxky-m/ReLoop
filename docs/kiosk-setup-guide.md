# Panduan Setup Mesin Kiosk (RVM)

Aplikasi ReLoop menyediakan antarmuka web khusus yang dirancang untuk dijalankan di layar sentuh (tablet/monitor) yang menempel pada mesin fisik RVM (Reverse Vending Machine).

## 1. Menjalankan Mode Kiosk

Antarmuka mesin diakses melalui rute web Next.js:
`https://[domain-reloop]/kiosk`

Karena mesin ini beroperasi 24/7 di tempat umum, UI kiosk dirancang agar:
- Memiliki tingkat kontras tinggi (mudah dibaca di bawah sinar matahari).
- Otomatis menolak *input* yang tidak valid untuk mencegah *vandalism* perangkat lunak.
- Selalu menampilkan kode QR yang berotasi (untuk alasan keamanan).

## 2. Alur Otentikasi Mesin (QR Token Rotation)

Untuk mencegah pengguna men-scan QR code lama dari foto, Kiosk menerapkan sistem **QR Token Rotation**:
1. Setiap sekian detik (default: 30 detik), Kiosk akan meminta token baru ke backend.
2. Backend menghasilkan `qrToken` baru dan menyimpannya di tabel `Machine`.
3. Kiosk merender QR Code yang mengarah ke `https://[domain]/scan?m=[machineCode]&t=[qrToken]`.
4. Jika User men-scan QR code tersebut menggunakan aplikasi *mobile*, backend memvalidasi apakah `t` (token) masih berlaku dan sama dengan yang ada di database.
5. Jika valid, pintu mesin (*chamber*) terbuka.

## 3. Realtime Gateway (WebSocket)

Kiosk tidak mengandalkan *polling* lambat ke database untuk mengetahui apakah sebuah barang telah dimasukkan ke dalam mesin.
Sistem menggunakan **Realtime Gateway** berbasis Node.js yang berjalan di port terpisah.

**Cara menjalankan (di server):**
```bash
npm run realtime
```

**Alur Kerja Realtime:**
1. RVM Hardware (sensor) mendeteksi botol, menimbangnya, dan mengenali jenisnya menggunakan AI Camera.
2. Hardware mengirim *payload* HMAC-SHA256 ke *endpoint* internal `/api/machine-events`.
3. Backend memproses data tersebut (memasukkan `DepositItem` ke database), lalu meneruskan notifikasi lewat WebSocket (menggunakan koneksi `realtime`).
4. Kiosk yang terbuka di layar mesin otomatis merespons melalui WebSocket, memunculkan animasi botol masuk dan menambahkan poin di layar secara instan tanpa perlu memuat ulang (*refresh*) halaman.
