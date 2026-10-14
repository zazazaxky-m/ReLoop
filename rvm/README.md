# ReLoop RVM Edge Runtime

Runtime produksi untuk Reverse Vending Machine. Berjalan lokal, tetap aktif
tanpa internet, memakai SQLite WAL sebagai durable state/outbox, dan
menyinkronkan event ke ReLoop API secara batch saat koneksi tersedia.

## Fitur

- State machine mesin dan session lease.
- Durable event outbox dengan ACK per event (protokol v2), retry exponential
  backoff ≤ 60 s + jitter, dan dead-letter yang terlihat operator (lihat bawah).
- Local kiosk/API hanya pada loopback.
- Sensor abstraction: mock/simulator dan Raspberry Pi GPIO.
- Kamera OpenCV opsional: health, occlusion, blur, motion/impact evidence.
- Fraud rules: reverse motion, retrieval/string-pull, impossible sequence,
  duplicate acceptance, abnormal weight.
- Vandalism rules: forced door/panel, high vibration, camera covered/offline.
- Safe-state mematikan actuator sebelum event dikirim.
- Interlock keselamatan lokal selalu mengalahkan lease server (lihat bawah).
- Maintenance tersembunyi dan dilindungi PIN.

## Interlock keselamatan dan safety latch

Lease server yang valid **tidak pernah** dapat membuka output selama kondisi
keselamatan lokal aktif. Kontraknya:

- **Guard per output.** Setiap pembukaan input gate, conveyor dan compactor
  (aktivasi lease, `OPEN_GATE`, `RESUME_OPERATION`, reset, gate dibuka ulang
  setelah item ditolak, conveyor/compactor saat item diterima, serta jog di
  panel maintenance) membaca sensor terbaru lalu memeriksa interlock dan
  menulis output dalam satu critical section di bawah RLock controller
  (`RvmController.try_open_input_gate(reason)`,
  `RvmController.actuation_block_reason(snapshot)`). Loop kontrol memegang
  lock yang sama untuk setiap tick, sehingga sensor tidak dapat diproses di
  antara pemeriksaan dan penulisan output.
- **Item tidak dikreditkan bila conveyor ditolak.** Jika interlock menolak
  conveyor di titik penerimaan, mesin mengirim `ITEM_REJECTED`
  (`reason: ACTUATION_BLOCKED`, `blockedBy: <alasan>`) dan tidak pernah
  mengirim `ITEM_ACCEPTED_POINT` maupun menjalankan compactor untuk item itu.
- **Kondisi yang memblokir:** gangguan output yang belum teratasi (stop
  terakhir gagal), service panel atau pintu kolektor terbuka,
  suhu ≥ `max_temperature_c`, getaran ≥ `vibration_threshold_g`, kamera
  tidak memenuhi syarat (kamera aktif harus online dan tidak tertutup; hanya
  `MockHardware` yang mensimulasikan sinyal kamera), state `SAFE_STATE`,
  `MAINTENANCE` atau `FULL`, isi bin ≥ `max_fill_percent`, dan safety latch
  aktif (`safe_reason` tersimpan atau alert `CRITICAL`). Jika diblokir, semua
  output dimatikan dan `activate_lease` mengembalikan `False` tanpa menyimpan
  lease atau mengubah state/latch.
- **Sesi dimulai dari mesin yang berhenti.** `activate_lease` memanggil
  `all_stop()` di critical section yang sama dengan pemeriksaan interlock dan
  pembukaan gate, sehingga output yang masih berjalan (jog yang tertinggal,
  relay yang menyangkut, penulis asing) berhenti sebelum gate terbuka untuk
  pengguna. Jika stop itu gagal, mesin ter-latch `OUTPUT_STOP_FAILED` (lihat
  bawah) dan lease ditolak tanpa disimpan.
- **Jog maintenance** (PIN: buka gate, jalankan conveyor, nyalakan compactor)
  hanya diterima saat state `MAINTENANCE` (masuk lewat `ENTER_MAINTENANCE`
  superadmin). Di state lain jog ditolak (`Aktuator ditolak: mesin belum dalam
  mode maintenance`) tanpa mengubah output atau sesi yang sedang berjalan. Di
  `MAINTENANCE` jog tetap ditolak (`Aktuator ditolak: …`) selama ada bahaya
  fisik (panel/pintu terbuka, suhu, getaran) atau latch aktif. Perintah
  tutup/stop tidak memerlukan `MAINTENANCE` (lihat "Menutup/menghentikan
  selalu boleh").
- **Level-triggered.** Panel/pintu yang terbuka me-latch `SAFE_STATE` pada
  setiap tick selama mesin belum ter-latch, bukan hanya saat transisi
  tertutup→terbuka. Selama `SAFE_STATE` atau selama ada bahaya fisik, setiap
  tick kembali mematikan seluruh output. Alert tidak diulang per tick.
- **Latch hanya dilepas operator.** `RESET_ALERT` (superadmin) dan
  `reset-safe-state` (maintenance) menolak reset selama kondisi belum aman.
  Akhir sesi, pembaruan lease, sesi baru, dan lease kedaluwarsa dari server
  tidak mengubah `SAFE_STATE`/`MAINTENANCE`/`FULL` menjadi `IDLE`, tidak
  menghapus alert keselamatan, dan tidak membuka output. Selama `safe_reason`
  tersimpan, `SAFE_STATE` hanya dapat ditinggalkan lewat reset operator
  (transisi lain ditolak dan dicatat sebagai `STATE_CHANGE_SUPPRESSED`; masuk
  `MAINTENANCE` tetap boleh dan latch tetap aktif), alert `CRITICAL` tidak
  pernah ditimpa alert peringatan (fraud, kamera blur), dan heartbeat
  melaporkan status `ERROR` selama latch aktif.
- **Menutup/menghentikan selalu boleh.** `CLOSE_GATE`, `STOP_ALL`, dan perintah
  maintenance yang menutup/mematikan output tidak melewati guard. Jika menutup
  atau menghentikan satu output gagal (`CLOSE_GATE`, perintah maintenance
  tutup/stop, maupun penutupan di dalam proses item), mesin ter-latch di
  `SAFE_STATE` (`OUTPUT_STOP_FAILED`), seluruh output dihentikan dan dicoba
  ulang setiap tick, lalu error dilaporkan ke pemanggil. `RESUME_OPERATION`
  hanya keluar dari maintenance setelah `all_stop()` berhasil; jika gagal,
  perintah ditolak dan mesin ter-latch.
- **Tidak menunggu jaringan.** `STOP_ALL` dan masuk safe-state langsung
  mematikan output tanpa menunggu lock, lalu sekali lagi di bawah lock.
  `SYNC_NOW`, `CAPTURE_SNAPSHOT` dan polling sesi server berjalan di luar
  lock, sehingga server lambat/hang tidak menunda loop sensor. Hasil perintah
  remote tetap di-cache per `id` dan dilaporkan ulang tanpa eksekusi ulang.
- **Latensi `STOP_ALL` remote.** Server memberikan `STOP_ALL` yang tertunda
  sebelum perintah lain, termasuk perintah yang sudah `DISPATCHED`. Mesin
  memproses perintah remote satu per satu, jadi `STOP_ALL` yang tiba saat
  `SYNC_NOW`/`CAPTURE_SNAPSHOT` sedang berjalan menunggu perintah itu selesai.
  Durasinya dibatasi timeout HTTP yang ada: `SYNC_NOW` ≤ 5 s (batch event) +
  2 × 20 s (upload bukti kamera) = 45 s, `CAPTURE_SNAPSHOT` ≤ 40 s, lalu
  laporan hasil ≤ 5 s, jeda loop 2 s dan pengambilan perintah ≤ 3 s. Kasus
  terburuk ±55 s setelah `STOP_ALL` diantrikan; tanpa perintah I/O yang
  berjalan ±5 s. Timeout `urllib` berlaku per operasi socket, sehingga server
  yang mengirim data sangat lambat dapat memperpanjangnya, dan perintah remote
  kedaluwarsa setelah 60 s. Untuk penghentian darurat gunakan E-stop fisik
  atau panel maintenance lokal.
- **Boot/crash.** Output GPIO dibuat dalam keadaan mati (`initial_value=False`),
  `start()` memanggil `all_stop()`, dan sesi yang dipulihkan setelah restart
  tidak membuka gate secara otomatis. `all_stop()` GPIO tetap mematikan output
  lain walaupun salah satu output gagal ditulis.
- **Stop yang gagal selalu me-latch.** Setiap jalur yang mematikan seluruh
  output (safe state, tick saat ter-latch, bin penuh, lease kedaluwarsa, akhir
  sesi server, penolakan guard, fraud, reset, `STOP_ALL`, `ENTER_MAINTENANCE`,
  `RESUME_OPERATION`, start dan stop runtime) memakai stop yang sama, dan
  penutupan satu output me-latch dengan cara yang sama (lihat di atas). Jika
  `all_stop()` gagal, mesin langsung ter-latch di `SAFE_STATE` dengan alasan `OUTPUT_STOP_FAILED` (event
  `ERROR`, dan `SAFE_STATE_ENTERED` melaporkan `stopFailed: true` serta
  `outputsDisabled: []`), juga bila stop gagal saat masuk safe state karena
  alasan lain. Mesin tidak pernah dibiarkan
  `FULL`/`SYNC_PENDING`/`IDLE`/`SESSION_ACTIVE` dan dapat digerakkan, dan
  status `FULL` tidak dilaporkan bila stop-nya gagal. Selama gangguan belum
  teratasi, setiap tick mencoba stop lagi sampai berhasil, semua aktuasi
  (termasuk `activate_lease`) ditolak, dan `RESET_ALERT`/`reset-safe-state`
  ditolak (`output gagal dimatikan`). Setelah stop berhasil, latch tetap ada
  sampai reset operator yang tervalidasi. `STOP_ALL`, `ENTER_MAINTENANCE` dan
  `RESUME_OPERATION` yang stop-nya gagal dilaporkan gagal ke superadmin.
- **Error tidak mematikan loop.** Loop kontrol dan loop sesi mencatat error di
  log lalu berlanjut dengan backoff (kontrol ≤ 1 s, sesi ≤ 30 s). Error pada
  tick kontrol me-latch `SAFE_STATE` (`CONTROL_LOOP_ERROR`); bila mesin sudah
  ter-latch, alasan latch awal dipertahankan dan seluruh output dihentikan
  lagi.
- Audit lokal mencatat `INPUT_GATE_OPENED` dan `ACTUATION_BLOCKED` beserta
  alasannya.

Perilaku ini diuji dengan mock hardware di `tests/test_rvm_safety.py`.
**Uji penerimaan hardware oleh teknisi belum dilaksanakan** dan wajib lulus
sebelum rollout armada; prosedurnya ada di
[`docs/kiosk-setup-guide.md`](../docs/kiosk-setup-guide.md#4-interlock-keselamatan-dan-uji-penerimaan-teknisi).

## Sinkronisasi event: protokol v2, retry dan dead-letter

Setiap event mesin masuk outbox SQLite (`outbox`) dengan `localEventId` unik
dan dikirim batch ke `POST /api/machine-events` (HMAC). Respons protokol v2
(kontrak bersama: `tests/fixtures/contracts/machine-events.v2.json`):

```json
{ "protocolVersion": 2, "received": 3, "results": [
  { "localEventId": "…", "status": "accepted", "eventId": "…" },
  { "localEventId": "…", "status": "duplicate", "eventId": "…" },
  { "localEventId": "…", "status": "error", "error": "TEMPORARY_FAILURE", "retryable": true }
] }
```

- **ACK hanya untuk yang tercatat.** Batch yang valid selalu HTTP 200; mesin
  hanya menandai `sent` event yang hasilnya `accepted`/`duplicate` dan
  `localEventId`-nya cocok dengan yang dikirim. Server baru menjawab
  `accepted` setelah event beserta reward-nya commit dalam satu transaksi.
- **Retry dengan ID yang sama.** Error tanpa `retryable: false` (termasuk
  error tanpa field `retryable`, item yang hilang/rusak, JSON rusak, HTTP
  non-2xx, timeout) tetap `pending` dengan backoff `min(60, 2^attempts)`
  detik dan jitter (50–100 % dari nilai itu, tidak pernah > 60 s). Retry
  memakai `localEventId` yang sama, sehingga respons yang hilang setelah
  commit dijawab `duplicate` tanpa reward kedua. Pengiriman bersamaan event
  yang sama juga dijawab `duplicate` (server membaca ulang event pemenang
  setelah benturan unique).
- **Dead-letter.** `retryable: false` (`INVALID_EVENT`: event tidak dikenali;
  `EVENT_REJECTED`: ditolak aturan/data) memindahkan event ke
  `delivery_status = 'dead_letter'`. Baris tidak pernah dihapus atau diubah,
  dan tidak dikirim lagi sampai teknisi mengirim ulang.
- **Respons yang tidak dipercaya ditolak utuh.** Respons tanpa
  `protocolVersion: 2` (termasuk respons backend lama v1), `results` yang
  bukan daftar, atau ID asing/ganda tidak meng-ACK apa pun; seluruh batch tetap
  `pending`.
- **Event racun tidak menahan antrean.** Backoff berlaku per event, jadi event
  yang terus gagal tidak menghalangi event lain. Bila server menolak seluruh
  batch (HTTP 400/413/422), mesin mengirim satu event per batch selama 5 menit
  agar event penyebabnya hanya menahan dirinya sendiri. Penolakan level HTTP
  tidak pernah men-dead-letter event (server bisa jadi yang salah).
- **Urutan per sesi.** Backend menentukan item sebuah event dari riwayat sesi,
  jadi event sebuah sesi ditahan selama event sebelumnya dari sesi yang sama
  masih menunggu retry (di mesin) dan dijawab `TEMPORARY_FAILURE` dalam batch
  yang sama setelah event sebelumnya gagal sementara (di server). Sesi lain dan
  event tanpa sesi tetap berjalan; event yang di-dead-letter tidak menahan sesi.
- **Batas waktu tetap.** Satu `flush_once` tetap satu request HTTP dengan
  timeout 5 s, sehingga angka latensi `STOP_ALL` di atas tidak berubah.
- **Loop sinkronisasi tidak pernah berhenti.** Body respons yang terpotong
  (`IncompleteRead`) diperlakukan seperti respons hilang, item dengan `status`
  bukan string dianggap rusak (tetap `pending`), dan setiap langkah loop
  (event, bukti kamera, media) dijaga: error tak terduga dicatat di log dan
  `lastError`, lalu dicoba lagi pada iterasi berikutnya.

**Tampilan operator.** Panel maintenance kiosk (PIN) menampilkan jumlah event
menunggu, yang ditolak permanen (jenis, alasan, jumlah percobaan) dan waktu
sinkron terakhir yang berhasil; tombol **Kirim ulang event ditolak**
(`retry-dead-letter`, wajib token maintenance; tanpa `ids` = semua, atau
`ids` berupa daftar ID outbox positif, selain itu ditolak 422) mengembalikan event ke antrean
dengan `localEventId` dan payload yang sama, menyimpan riwayat `attempts` dan
`last_error`, dan mencatat audit `OUTBOX_DEAD_LETTER_RETRY`. Heartbeat
membawa `queueDepth`, `deadLetterDepth` dan `lastSyncSuccessAt`, yang tampil di
dashboard admin/superadmin pada tab **Sinkronisasi** detail mesin.

### Upgrade outbox dan urutan rollout

1. **Deploy backend dulu.** Respons v2 bersifat aditif (`protocolVersion` dan
   `retryable` baru; `received`/`results` tetap), jadi worker lama tetap
   berjalan.
2. **Baru kemudian worker mesin.** Worker v2 menolak respons v1 tanpa
   menghapus antrean; bila backend belum v2, event menumpuk `pending` sampai
   backend di-upgrade.
3. **Upgrade database otomatis saat start, dengan backup lebih dulu.** Bila
   tabel `outbox` belum punya `delivery_status`, runtime menyalin database
   (SQLite backup API, termasuk isi WAL) ke
   `<database>.pre-outbox-v2-<UTC>.bak`, memverifikasi `integrity_check` dan
   jumlah baris outbox, lalu dalam satu transaksi menambah kolom
   `delivery_status` (`pending`/`sent`/`dead_letter`) dan `dead_lettered_at`,
   mengisi `sent` untuk baris yang sudah punya `sent_at`, dan membuat index
   baru. Kolom `attempts`, `next_attempt_at`, `last_error` dan seluruh baris
   pending dipertahankan. Bila backup gagal diverifikasi, runtime berhenti
   tanpa mengubah database. Simpan file `.bak` sampai mesin terbukti sinkron
   normal.

## Lease sesi dan jendela replay (R03)

**Lease sesi.** `GET /api/machine-session/{code}` (HMAC, body kosong)
mengembalikan lease v1 untuk worker lama:
`{ id, sessionId, userRef, issuedAt, expiresAt, signature }`, signature =
HMAC-SHA256(secret, `id.sessionId.issuedAt.expiresAt`), atau lease v2 untuk
worker yang mengumumkan protokol 2 (lihat "Lease v2" di bawah); `lease: null`
berarti "tidak ada sesi: berhenti". Aturan server di baliknya:

- Satu mesin punya paling banyak satu sesi aktif. Bila data lama masih
  memuat beberapa sesi aktif untuk satu mesin, server **tidak** memberi lease
  (`lease: null`, `sessionConflict: true`) dan tidak memilih sesi terbaru;
  mesin berhenti sampai operator merekonsiliasi
  (`scripts/reconcile-active-sessions.ts`).
- `expiresAt` tidak pernah melewati batas waktu sesi (`timeoutAt`, atau
  `startedAt` + idle timeout untuk sesi tanpa `timeoutAt`) dan tidak pernah
  lebih dari 300 s setelah `issuedAt`. Batas waktu hanya diperpanjang oleh
  `ITEM_DETECTED` selama belum lewat; event terlambat tidak pernah
  menghidupkan sesi yang batasnya sudah lewat. Karena itu, setelah batas waktu
  lewat, setiap lease untuk sesi itu sudah kedaluwarsa, dan server menutup
  sesi lewat kebijakan timeout: item yang belum diputuskan mesin menjadi
  `REVIEW` (`SESSION_TIMEOUT`), tidak ada yang dihapus.
- **Asumsi jam mesin.** `expiresAt` adalah waktu unix absolut yang diperiksa
  runtime terhadap jamnya sendiri (`activate_lease`). Pernyataan "batas lewat ⇒
  semua lease kedaluwarsa" tepat bila jam mesin sama dengan jam server (NTP).
  Karena request mesin diterima dengan selisih jam hingga 300 s, mesin yang
  jamnya tertinggal dapat memakai lease hingga 300 s setelah batas server.
  Apa yang dilakukan mesin di jendela itu tetap tercatat pada sesinya, dan
  titik penerimaan dengan `occurredAt` setelah akhir sesi ditahan untuk
  ditinjau (di bawah).
- Event terlambat (antrean outbox) tetap milik sesi yang dibawanya, dan mesin
  tetap menentukan hasil fisik item yang belum punya titik penerimaan, apa pun
  status sesinya. Item yang dilaporkan setelah sesinya berakhir ditahan untuk
  ditinjau di sesi itu (`SESSION_CLOSED`). Titik penerimaan dengan
  `occurredAt` (jam mesin) setelah akhir sesi, atau untuk item
  `SESSION_CLOSED`, menjadi review tertahan (penerimaan tercatat, EARN
  `PENDING`, tidak pernah `AVAILABLE`) yang diputuskan peninjau; yang sebelum
  akhir sesi mengikuti kebijakan biasa. Event yang menyebut item dari sesi lain
  tidak memengaruhi item mana pun.

**Jendela replay.** Tanda tangan diterima selama
|jam server − `x-reloop-timestamp`| ≤ 300 s (`MACHINE_SIG_MAX_SKEW_SECONDS`), jadi
satu request bertanda tangan berlaku hingga 600 s waktu server. Nonce disimpan
`MACHINE_NONCE_TTL_MS` = (2 × 300 + 60) s = 660 s sejak pertama dipakai
(`lib/machine-auth-constants.ts`), sehingga replay ditolak selama tanda tangan
masih berlaku (sebelumnya nonce kedaluwarsa setelah 360 s).

- Produksi menyimpan nonce di Redis (`SET NX PX`), dipakai bersama semua
  instance aplikasi: satu nonce hanya diterima sekali di seluruh instance.
  Tanpa `REDIS_URL` aplikasi menolak start; saat Redis tidak terjangkau setiap
  request mesin ditolak (fail-closed) sampai koneksi pulih, lalu otomatis
  normal kembali. Di luar produksi ada fallback memori per proses.
- Rollout aman untuk request bertanda tangan yang sudah ada: kunci lama tetap
  berlaku sampai TTL lamanya habis, kunci baru memakai 660 s. Tidak perlu
  rotasi secret dan tidak ada perubahan di mesin.
- **Belum dilakukan (upgrade protokol terpisah):** method dan path request
  belum ikut ditandatangani (string kanonik tetap
  `timestamp.nonce.rawBody`), dan lease memakai waktu kedaluwarsa absolut.
  Upgrade berikutnya menandatangani method/path dan menambah durasi lease
  relatif (detik sejak diterima mesin, dihitung dengan jam monotonic mesin)
  agar selisih jam tidak lagi memperpanjang lease. Keduanya memerlukan versi
  protokol yang dikirim mesin secara eksplisit (mis. header versi) dan masa
  transisi di mana server menerima keduanya; mengubah string kanonik atau arti
  `expiresAt` diam-diam akan menolak atau mengubah perilaku semua mesin yang
  sudah terpasang.

## Lease v2: batas reward bertanda tangan, bound sesi, dan close watermark (B01b)

Sejak B01b worker mengumumkan `x-reloop-lease-protocol: 2` pada
`GET /api/machine-session/{code}`, dan server menjawab dengan **lease v2**
(kontrak bersama: `tests/fixtures/contracts/machine-lease.v2.json`, diverifikasi
oleh `tests/test_rvm_lease_contract.py` dan `tests/contracts/machine-lease-contract.test.ts`):

```json
{ "version": 2, "id": "lease-<sessionId>", "machineCode": "RLP-001", "sessionId": "…",
  "userRef": "…", "issuedAt": 1760342400, "expiresAt": 1760342700,
  "reservationId": "…", "policyVersion": "<sha256 hex>", "ceilingRupiah": 10000, "maxItems": 20,
  "policy": { "version": 1, "mode": "MONEY_REWARD", "multiplierBps": 15000,
              "wasteTypes": [ { "id": "…", "unit": "ITEM", "rewardPerUnit": 100, "maxRewardRupiah": 150 } ] },
  "signature": "<hex>" }
```

- **Tanda tangan.** `signature` = HMAC-SHA256(secret mesin, kanonik), kanonik =
  JSON UTF-8 kompak dari array dengan urutan tetap
  `[2,id,machineCode,sessionId,userRef,issuedAt,expiresAt,reservationId,policyVersion,ceilingRupiah,maxItems]`.
  Node `JSON.stringify(array)` dan Python `json.dumps(array, separators=(",",":"), ensure_ascii=False)`
  menghasilkan byte yang identik; semua angka bilangan bulat (bukan float),
  batas yang tidak ada bernilai `null`. Worker (`rvm/lease.py`) menolak lease
  dengan field bertipe salah, `machineCode` yang bukan mesin ini, tanda tangan
  salah, atau tanpa `version: 2` (lease v1 lama **ditolak**: cap yang tidak
  ditandatangani tidak diberi fallback permisif).
- **`policyVersion` mengikat snapshot admisi.** `policy` adalah snapshot tarif,
  multiplier (basis poin), mode reward, dan batas reward per item untuk setiap
  jenis sampah mesin, yang dibekukan server saat pengguna diterima
  (`lib/session-policy.ts`). `policyVersion` = SHA-256 dari kanonik
  `[1,mode,multiplierBps,[[wasteTypeId,unit,rewardPerUnit,maxRewardRupiah]…urut id]]`;
  worker menghitung ulang hash itu dan menolak lease yang snapshot-nya tidak
  cocok, sehingga cap per item yang ditegakkan lokal tidak dapat diubah tanpa
  merusak tanda tangan. Server menghargai setiap titik penerimaan sesi
  (termasuk batch offline/terlambat) dari snapshot yang sama: perubahan tarif
  atau multiplier setelah admisi tidak pernah menghargai ulang barang yang
  sudah masuk.
- **SQLite menyimpan field bertanda tangan** (`leases.version, machine_code,
  reservation_id, policy_version, ceiling_rupiah, max_items, policy_json`), dan
  counter konsumsi durable per sesi di `session_consumption`
  (`consumed_rupiah`, `consumed_items`): perpanjangan lease (sesi sama, expiry
  baru) dan restart **tidak pernah** mereset counter; penerimaan item dan
  kenaikan counter ditulis dalam satu transaksi SQLite.
- **Bound sesi.** Setiap `ITEM_ACCEPTED_POINT` mengonsumsi batas maksimal yang
  dapat dibayar server untuk jenis itu (ITEM: tarif x multiplier; KG: tarif x
  berat maksimal jenis, atau `max_item_weight_grams` mesin bila server tidak
  menetapkan). Sebelum conveyor bergerak, controller memeriksa bound: bila item
  berikutnya tidak tertutup `ceilingRupiah` atau `maxItems` sudah habis, item
  ditolak lewat jalur yang sama dengan penolakan interlock (`_safe_all_stop`,
  `ITEM_REJECTED {reason: SESSION_BOUND_REACHED, bound: SESSION_CEILING_REACHED|SESSION_MAX_ITEMS_REACHED}`,
  tanpa `ITEM_ACCEPTED_POINT`), state kembali `SESSION_ACTIVE` dan **gate tetap
  tertutup**. Saat bound habis, gate tidak dibuka lagi oleh aktivasi/perpanjangan
  lease, pembukaan ulang setelah item ditolak, `OPEN_GATE`, maupun
  `RESUME_OPERATION` (audit `ACTUATION_BLOCKED` dengan alasan bound). Bound
  bukan interlock: ia tidak pernah me-latch dan seluruh jaminan R01 tetap
  berlaku di atasnya (interlock tetap mengalahkan lease dan bound). Kiosk
  menampilkan sisa batas (`sessionBound` di `/api/state`) dan "Batas sesi
  tercapai" bila habis; pengguna melihat batas di aplikasi sebelum item pertama
  (`limits` pada respons scan).
- **Close watermark.** Saat poll sesi menunjukkan server tidak lagi menjalankan
  sesi (lease `null`, atau sesi lain), sesi ditandai `closed_at` lokal
  (`sessionConflict` bukan akhir sesi). Sebelum setiap flush, untuk sesi
  tertutup yang **semua** event-nya sudah `sent` (tidak ada `pending` maupun
  `dead_letter`), worker mengantrikan tepat satu event
  `SESSION_CLOSE_WATERMARK {eventCount, lastLocalEventId, consumedRupiah, consumedItems}`
  lewat outbox yang sama (ACK per event, retry dengan `localEventId` sama, urutan
  per sesi), sehingga tiba setelah semua yang dijaminnya. Server baru melepas
  sisa reservasi sesi setelah watermark itu (`lib/machine-events/watermark.ts`,
  pelepasan berkunci `session:<id>:close-watermark`: retry tidak melepas dua
  kali). Bagian sisa yang masih dapat ditarik item yang sudah melewati titik
  penerimaan tetapi masih menunggu peninjau (item tanpa jenis, item anomali
  yang bisa diklasifikasi ulang) **tetap ditahan**: hanya `sisa - eksposur`
  yang dilepas dan reservasi tetap aktif sampai keputusan peninjauan terakhir
  menutupnya (`session:<id>:review-close`). Koneksi hilang, event tertahan,
  atau event dead-letter berarti **tidak
  ada watermark**: sisa dana tetap ditahan dan dilaporkan
  (`SOURCE_CLOSED_AWAITING_WATERMARK`); hanya pelepasan eksplisit superadmin
  yang membebaskannya. Watermark untuk sesi yang masih berjalan di server
  dijawab `TEMPORARY_FAILURE` (dicoba lagi setelah poll berikutnya menutupnya);
  jumlah event yang tidak cocok dijawab `EVENT_REJECTED` (dead-letter, dana
  tetap ditahan, terlihat di panel maintenance).
- **Upgrade database.** Tabel `leases` tanpa kolom `version` di-backup lebih
  dulu ke `<database>.pre-lease-v2-<UTC>.bak` (SQLite backup API, termasuk WAL,
  diverifikasi) lalu kolom ditambahkan dalam satu transaksi; baris lama tetap
  `version 1` tanpa bound. `session_consumption` dibuat baru. Simpan file
  `.bak` sampai mesin terbukti sinkron normal.

### Urutan rollout lease v2

1. **Backend dulu.** Worker v1 (tanpa header) tetap mendapat lease v1 untuk
   sesi `COMPLIANCE_ONLY` dan, selama `REWARD_FUNDING_ENFORCED` belum `true`,
   untuk sesi berhadiah (mode bayangan, perilaku tidak berubah).
2. **Lalu worker mesin.** Worker v2 hanya menerima lease v2; terhadap backend
   lama ia tidak membuka sesi (lease v1 ditolak, tidak ada yang dihapus).
   Backup `leases` dibuat otomatis saat start pertama.
3. **Baru `REWARD_FUNDING_ENFORCED=true`** setelah semua mesin berhadiah
   menjalankan worker v2: sejak itu sesi berhadiah **ditolak** untuk worker v1
   (`lease: null`, `leaseRefused: LEASE_PROTOCOL_V2_REQUIRED`, log server),
   tidak pernah diberikan tanpa bound.

Perubahan perilaku mesin ini (penolakan pada bound, gate yang tidak dibuka
lagi, watermark) **belum diuji pada hardware**; prosedur penerimaan teknisi di
[`docs/kiosk-setup-guide.md`](../docs/kiosk-setup-guide.md#4-interlock-keselamatan-dan-uji-penerimaan-teknisi)
(langkah 10) wajib lulus sebelum rollout armada (gate Z01).

## Kamera, deteksi orang, dan bukti wajah

Runtime kamera memakai OpenCV sepenuhnya lokal. Haar cascade bawaan OpenCV
mendeteksi wajah untuk membuat crop, sedangkan HOG person detector memberi sinyal
kehadiran orang. Sistem tidak melakukan pengenalan atau pencocokan identitas.

Aktifkan pada mesin yang memiliki webcam:

```json
{
  "camera_enabled": true,
  "camera_index": 0,
  "camera_face_detection_enabled": true,
  "camera_person_detection_enabled": true,
  "camera_capture_session_start": true,
  "camera_capture_security_events": true,
  "camera_retention_days": 30,
  "camera_max_local_captures": 1000
}
```

Scene dan crop wajah disimpan di `camera_evidence_dir`, lalu masuk antrean
durable untuk upload HMAC ke server. Salinan server berada di storage privat dan
hanya dapat dibuka oleh SUPERADMIN melalui detail mesin. Frame startup diberi
masa pemanasan dan anomali harus muncul beberapa frame berturut-turut untuk
mencegah alarm kamera tertutup yang palsu.

## Menjalankan

```powershell
Copy-Item rvm\config.example.json rvm\config.local.json
# isi machine_secret dan maintenance_pin_hash
```

Secara default, aplikasi berjalan di environment `dev` (menggunakan konfigurasi standar):
```powershell
python -m rvm.main --config rvm/config.local.json
```

Untuk menjalankan di environment `prod`, set dahulu `RVM_SERVER_URL` dan
`RVM_MACHINE_SECRET` sebagai environment variable (jangan pernah menaruh
secret produksi di source code), lalu gunakan flag `--env prod`:

```powershell
$env:RVM_SERVER_URL="https://your-server.example.com"
$env:RVM_MACHINE_SECRET="<secret-mesin-dari-superadmin>"
python -m rvm.main --env prod
```

Atau set `RVM_ENV=prod` sekaligus kedua variabel di atas melalui secret
manager pada mesin deploy:

```powershell
$env:RVM_ENV="prod"
$env:RVM_SERVER_URL="https://your-server.example.com"
$env:RVM_MACHINE_SECRET="<secret-mesin-dari-superadmin>"
python -m rvm.main
```

Proses akan gagal start (`SystemExit`) jika `--env prod` dipakai tanpa kedua
variabel tersebut. Jika secret produksi lama pernah tercatat di source
control, rotasi melalui **Superadmin → Mesin → Detail → Rotate Secret**
sebelum melanjutkan deploy.

Kiosk: `http://127.0.0.1:8765`

Simulator trigger terpisah:

```powershell
python tools/rvm_trigger_simulator.py --scenario normal-bottle
python tools/rvm_trigger_simulator.py --scenario string-pull
python tools/rvm_trigger_simulator.py --scenario vandalism-impact
```

Simulator interaktif tersedia di panel maintenance jika
`hardware_driver` bernilai `mock`. Buka kiosk, tekan
`Ctrl+Alt+Shift+R`, masukkan PIN maintenance, lalu pilih skenario.
Kontrol simulator otomatis disembunyikan pada mesin GPIO fisik.

Lihat `deploy/` untuk service Windows/Linux dan launcher Chromium.


## Playlist iklan lokal

Superadmin dapat membuka detail mesin lalu memilih **Playlist Iklan RVM** untuk mengunggah JPG, PNG, WebP, MP4, atau WebM. Playlist terikat ke satu mesin dan dapat diaktifkan, dimatikan, atau diurutkan secara terpisah.

RVM memeriksa manifest bertanda tangan setiap `media_sync_seconds` (default 30 detik), mengunduh file ke `media_cache_dir`, lalu memverifikasi ukuran dan SHA-256 sebelum mengganti playlist aktif. Media tetap dapat diputar saat koneksi server terputus. Batas total cache diatur melalui `media_max_cache_mb`.

Iklan hanya diputar saat mesin berstatus IDLE tanpa sesi dan tanpa alert. Jika playlist kosong/nonaktif, layar kembali ke tampilan QR standar.
