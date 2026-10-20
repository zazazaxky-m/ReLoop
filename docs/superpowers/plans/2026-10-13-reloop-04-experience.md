# ReLoop Web and Mobile Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyelesaikan journey pencarian mesin, scan, pencairan dan aksesibilitas dengan recovery yang jelas.

**Architecture:** Pertahankan komponen dan tokens existing; tambahkan state dan API minimal untuk resume/receipt/pagination. Mobile cache memiliki boundary account yang eksplisit. Browser/device evidence menjadi kriteria selesai.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Prisma Client 6 + PostgreSQL, Flutter, Python RVM; gunakan subset yang relevan dengan task.

**Spec:** [../specs/2026-10-13-reloop-remediation-design.md](../specs/2026-10-13-reloop-remediation-design.md). Baca spec dan [rencana induk](2026-10-13-reloop-remediation-master.md), terutama kontrak test fixture dan urutan lock, sebelum task pertama.

## Global Constraints

Global constraints pada spec berlaku seluruhnya. Aturan yang paling relevan:
- Seluruh nilai uang disimpan sebagai integer rupiah; API menolak pecahan, negatif yang tidak sah, overflow dan nilai di luar batas database.
- Operasi jaringan, email, push dan transfer pembayaran tidak dijalankan di dalam transaksi database.
- Setiap efek finansial baru memiliki business key unik; retry request identik tidak menghasilkan uang atau side effect kedua.
- API lama tetap didukung melalui field tambahan selama migrasi client; field keamanan yang tidak aman tidak diberi fallback permisif.
- Migrasi memakai expand -> backfill/reconcile -> enforce -> contract. Jangan menulis ulang histori finansial atau checksum audit lama untuk membuat laporan terlihat cocok.
- Seluruh pesan pengguna menggunakan bahasa Indonesia dan tidak memuat simulator, acceptance point, token atau detail protokol internal.

## Review Focus

Lima lintas-domain cases beserta owner: response hilang setelah commit (M01/R02/U02), otorisasi berubah ketika proses masih berjalan (A02/A03/R04/U04), replay/out-of-order/double-submit (M02/M03/M04/R03), data lama tidak konsisten saat migrasi (A04/A05/B01/Z01), dan koneksi/perangkat gagal di tengah aksi (R01/R02/U01/U05). Cases yang dimiliki task di bawah harus menjadi test, bukan hanya checklist reviewer.

## Cara menjalankan

Task adalah unit PR/review; checkbox adalah unit langkah. Jalankan loop red -> implement -> green untuk setiap perilaku, bukan menulis seluruh subsistem sebelum test. Snippet test adalah regression minimal untuk diintegrasikan ke file test yang disebut; imports `it/expect` dari Vitest dan fixture `f` berasal dari F01 bila dipakai. Semua tambahan case pada checklist wajib mendapat assertion nyata. Commit hanya file task, jangan `git add .`.

## Task U01: Login kembali ke scan, resume dan receipt setoran

**Temuan:** UX-01, UX-02, UX-05. **Dependensi:** A01, R03, R02, F01.

**Files:**
- Modify: `lib/rbac.ts`, `proxy.ts`, `components/auth/AuthForm.tsx`, `components/scan/ScanPageClient.tsx`, `components/scan/QrScanner.tsx`, `app/scan/layout.tsx`, `app/api/sessions/[id]/route.ts`.
- Create: `lib/return-to.ts`, `app/api/sessions/active/route.ts`, `tests/browser/scan-recovery.spec.ts`, `lib/return-to.test.ts`.
- Modify mobile: `mobile/lib/core/router.dart`, `mobile/lib/features/auth/login_screen.dart`, `mobile/lib/features/scan/scan_screen.dart`, `docs/mobile-api.md`.

**Interfaces:**
Produces `safeReturnTo(value:string|null):string` (fallback /dashboard); owned GET `/api/sessions/active?machineCode=...` returns `{session:null|{id,status,machine,items,updatedAt},sessions:Array<{id,status,machine}>}`. Tanpa machineCode dan lebih dari satu sesi milik user, session=null dan UI meminta memilih dari sessions; jangan memilih latest secara diam-diam. GET session detail adds receipt `{acceptedCount,reviewCount,rejectedCount,availableReward,pendingReward}`. Resume endpoint reads owned session and never issues machine authorization to another user.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("rejects unsafe return destinations",()=>{
  for(const path of ["//evil.test","https://evil.test","/\\evil.test","/%2f%2fevil.test"])
    expect(safeReturnTo(path)).toBe("/dashboard");
  expect(safeReturnTo("/scan?m=MSN-001")).toBe("/scan?m=MSN-001");
});
// Browser test with F01 test fixture:
test("refresh restores an owned active session",async({page,fixture})=>{
  await fixture.login(page,"userA");
  await fixture.startDeposit();
  await page.goto("/scan"); await page.reload();
  await expect(page.getByText("Sesi setoran aktif")).toBeVisible();
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npx vitest run lib/return-to.test.ts
npm run test:browser -- tests/browser/scan-recovery.spec.ts
```

Expected red: Login membuang return destination dan scan refresh hanya mengandalkan komponen state.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Teruskan returnTo dari initial page request melalui login/register/MFA dengan allowlist internal path, decode dan normalisasi aman (reject encoded slash/backslash/control chars). Jangan gunakan returnTo ke endpoint API atau URL asing. Simpan machine context yang diperlukan dan tampilkan rescan jika QR expired; jangan memperpanjang token sebagai bypass bukti QR mesin.
```ts
const terminal=["COMPLETED","CANCELLED","EXPIRED"].includes(session.status);
const canFinish=!terminal && !finishing;
```
Mount scan memanggil owned active-session endpoint, selanjutnya polling memiliki abort+catch, lastUpdated dan status reconnect. Deduplicate startSession pending agar effect/remount tidak membuat request ganda. Finish menampilkan receipt dahulu dengan CTA Dompet; jumlah AVAILABLE dan PENDING terpisah. EXPPIRED/CANCELLED tidak punya tombol finish. Camera denied menawarkan instruksi izin dan link QR dari kamera bawaan, bukan query-token manual. Hilangkan copy simulator di user web/mobile; demo detail hanya simulator/kiosk diagnostic yang terpisah.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Signed-out QR ->login/MFA/register ->kembali machine context; expired QR meminta scan ulang.
  - [ ] Refresh/back/foreground app resume sesi milik sendiri; sesi user lain tetap403/404.
  - [ ] Polling network failure lalu recover tidak menghilangkan items; receipt tidak menjumlahkan pending sebagai saldo tersedia.
  - [ ] Finishing ketika acceptance in flight mengikuti state backend dan tidak memberikan sukses palsu.
  - [ ] Browser/mobile permission denied, tidak ada kamera, tab kembali aktif, terminal state dan empty state diuji.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(scan): preserve intent and recover deposit sessions`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task U02: Wallet jelas, retry aman dan histori lengkap

**Temuan:** UX-03, UX-04, UX-06. **Dependensi:** M01, M02, M05, F01.

**Files:**
- Modify: `components/wallet/WalletPanel.tsx`, `app/dashboard/user/wallet/page.tsx`, `app/dashboard/user/page.tsx`, `components/AppShell.tsx`, `app/api/wallet/route.ts`, `app/api/redemptions/route.ts`, `components/admin/RedemptionQueue.tsx`.
- Create: `lib/client-request.ts`, `tests/browser/wallet-flow.spec.ts`; extend `tests/api/wallet.test.ts`.
- Modify mobile: `mobile/lib/features/wallet/wallet_screen.dart`, `mobile/lib/features/wallet/redemption_screen.dart`, `mobile/lib/features/wallet/payout_account_form.dart`, `mobile/lib/core/models.dart` (WalletBalance), `mobile/lib/core/models/redemption.dart` (Redemption/PayoutAccountModel).

**Interfaces:**
Produces `requestJson<T>(url:string,init?:RequestInit):Promise<T>` with typed `{status:number;message:string;requestId?:string}` failure; helper does not auto-retry mutations. GET wallet/history supports cursor+limit max50, stable `(createdAt,id)` ordering, response `nextCursor`.
Payout form keeps stable idempotency key for one confirmed gross+destination; change input invalidates key. Amount label Rp is primary; optional point display is derived and nonspendable separately.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
test("failed cancellation is announced and retains the request",async({page,fixture})=>{
  await fixture.login(page,"userA");
  await fixture.requestRedemption();
  await page.route("**/api/redemptions/*",route=>route.fulfill({status:500,
    contentType:"application/json",body:JSON.stringify({error:"Coba lagi nanti"})}));
  await page.goto("/dashboard/user/wallet");
  page.once("dialog",dialog=>dialog.accept());
  await page.getByRole("button",{name:"Batal",exact:true}).first().click();
  await expect(page.getByRole("alert")).toContainText("Coba lagi nanti");
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:browser -- tests/browser/wallet-flow.spec.ts
npx vitest run tests/api/wallet.test.ts tests/api/redemptions.test.ts
```

Expected red: Cancellation lama tidak memeriksa res.ok dan hanya refresh.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Semua wallet mutation check response, catch network/JSON failure dan tampilkan error terfokus + success status. Busy per aksi bukan mengunci seluruh daftar tanpa konteks. Setelah add account pilih ID response; jika selected account hilang, pilih valid account berikutnya atau empty.
```ts
setPayoutAccountId(current => accounts.some(a=>a.id===current)
  ? current : accounts[0]?.id ?? "");
```
Tambah review sheet sebelum submit: masked destination, accountName, gross/fee/net (default fee0), minimum, estimasi proses dari config yang sah dan cancellation rule. Response tidak pasti mempertahankan key; retry memakai key sama. Timeline REQUESTED->APPROVED->PROCESSING->SUCCESS dengan FAILED/REVERSED alasan dan nomor pengajuan. B03 memasok snapshot fee/recipient berikutnya; U02 default amount/0/amount kompatibel.
Riwayat wallet dan redemptions dapat load more, filter status/tanggal dan buka detail+proof terotorisasi. Gunakan istilah Program, Kantong, Saldo tersedia, Menunggu pemeriksaan, Sedang dicairkan konsisten web/mobile. Poin sekunder memiliki kurs yang ditampilkan dan tidak dianggap wallet berbeda. Jangan menampilkan ciphertext/payout number penuh ke browser secara tidak sengaja.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] First account creation langsung dapat dipilih; disabled/deleted selection tidak tersangkut.
  - [ ] 500/422/401, offline dan response nonJSON memiliki pesan/tindakan yang tepat.
  - [ ] Double tap/retry setelah timeout menghasilkan satu redemption; changing amount membuat key baru setelah konfirmasi.
  - [ ] Histori lebih dari30 ledger/20 redemptions bisa diakses tanpa duplicate/missing page; cursor status filters dibatasi ownership.
  - [ ] Gross/fee/net menjumlah benar dan receipt cocok snapshot backend; tidak menjanjikan SLA yang belum dikonfigurasi.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `feat(wallet): add reliable feedback confirmation and history`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task U03: Pencarian mesin publik dengan freshness dan rute

**Temuan:** UX-07. **Dependensi:** F01, R03.

**Files:**
- Modify: `app/map/page.tsx`, `app/map/layout.tsx`, `components/map/MapView.tsx`, `lib/map.ts`, `lib/map-data.ts`, `app/api/public/machines/route.ts`, `proxy.ts`, `app/page.tsx`.
- Create: `components/map/MachineFinder.tsx`, `tests/browser/machine-finder.spec.ts`; extend `tests/api/public.test.ts`.
- Modify mobile: `mobile/lib/features/map/map_screen.dart`, `app/api/mobile/map/route.ts`.

**Interfaces:**
Produces public machine DTO `{id,name,machineCode,latitude,longitude,organizationName,status,lastHeartbeatAt,isStale,fillLevelPercent,supportedWasteTypes}` with whitelist (no secret, user, capture or private contact). `machineFreshness(lastHeartbeatAt:Date|null,now:Date):{isStale:boolean}` uses configurable stale threshold default120s, validated against actual heartbeat interval during rollout.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
test("guest can find an alternative usable machine",async({page,fixture})=>{
  await fixture.machinesForMap();
  await page.goto("/map");
  await expect(page.getByRole("heading",{name:"Cari mesin"})).toBeVisible();
  await page.getByLabel("Hanya mesin siap digunakan").check();
  await expect(page.getByTestId("machine-offline")).toHaveCount(0);
  await expect(page.getByRole("link",{name:"Petunjuk arah"}).first()).toBeVisible();
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:browser -- tests/browser/machine-finder.spec.ts
npx vitest run tests/api/public.test.ts
```

Expected red: Peta membutuhkan login dan tidak mempunyai filter/list alternatif.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Map memiliki guest shell dan authenticated shell tanpa menjalankan requirePageUser untuk guest. Tambahkan exact public API allowlist; DTO berasal whitelist explicit. List+map menampilkan status dan terakhir diperbarui; stale heartbeat tidak boleh ditampilkan siap hanya dari status ONLINE.
```ts
const usable=machine.status==="ONLINE" && !machine.isStale && machine.fillLevelPercent<95;
```
Pencarian nama/lokasi sederhana pada data yang sudah tersedia; geolocation opsional setelah klik pengguna dan fallback pemilihan wilayah. Hitung jarak client dari lokasi user; jangan mengirim precise location ke analytics. Directions link dibangun dari koordinat mesin ke layanan pilihan user dan tidak memuat account data. Tambahkan landing CTA Cari mesin. Rate-limit public map dan cap/cursor jika >500 mesin supaya alternatif tidak diam-diam hilang.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Guest/public API tidak mengekspos ingestSecret, signed lease, contacts private, capture atau owner IDs.
  - [ ] Denied geolocation tetap bisa mencari nama/wilayah; full/stale/offline memiliki alternatif.
  - [ ] Map marker dan list filter konsisten, keyboard dapat memilih mesin, mobile360px dapat membuka rute.
  - [ ] Heartbeat frequency nyata sesuai stale threshold; display freshness diuji dengan fake clock.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `feat(map): expose safe machine discovery and freshness`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task U04: Pisahkan cache mobile dan hentikan response akun lama

**Temuan:** SEC-06. **Dependensi:** A01, F01.

**Files:**
- Modify: `mobile/lib/services/offline_service.dart`, `mobile/lib/services/background_sync_service.dart`, `mobile/lib/core/auth_provider.dart`, `mobile/lib/core/api_client.dart`, `mobile/lib/main.dart`.
- Modify: `mobile/lib/features/dashboard/user_dashboard_screen.dart`, `mobile/lib/features/wallet/wallet_screen.dart`, `mobile/lib/features/superadmin/superadmin_reconciliation_screen.dart`.
- Create: `mobile/test/services/account_cache_test.dart`, `mobile/test/services/background_sync_account_test.dart`.

**Interfaces:**
Produces `OfflineService.bindUser(String? userId)`, `captureEpoch():int`, `cacheForUser(String userId,int epoch,String key,dynamic data):Future<void>`, `getForUser(String userId,String key):dynamic`, `clearUser(String userId):Future<void>`. Stored key format v2:userId:resource; no anonymous private cache. AuthProvider increments epoch synchronously on logout/change before awaiting network.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```dart
test('late account A response cannot write into account B cache', () async {
  final cache = OfflineService();
  await cache.init(encrypted: false);
  cache.bindUser('A');
  final oldEpoch = cache.captureEpoch();
  cache.bindUser('B');
  await cache.cacheForUser('A', oldEpoch, 'wallet', {'balance': 123});
  expect(cache.getForUser('B', 'wallet'), isNull);
  expect(cache.getForUser('A', 'wallet'), isNull);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
flutter test test/services/account_cache_test.dart test/services/background_sync_account_test.dart
```

Expected red: Cache global wallet tidak memiliki user identity/epoch; logout tidak clear.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

bindUser(null) invalidates epoch immediately, stop background timer, cancel in-flight Dio tokens, clear in-memory models/cached private UI, then clear account cache/cookies/token. logout remote failure tidak mencegah local isolation. Login baru bind verified user ID dari server, bukan email input.
```dart
if (_activeUserId != userId || _epoch != epoch) return;
await _box?.put('v2:$userId:$key', entry);
```
Tambahkan guard sekali lagi jika awaited encode/write bisa berpindah epoch; serialize writes dan clear pada service agar stale write tidak menang setelah clear. Upgrade menghapus legacy unscoped private entries sekali (tidak memigrasikannya ke user yang sedang login). Offline fallback hanya untuk network unavailable/timeout, tidak401/403/validation. Encryption Hive tetap dipertahankan, cache TTL untuk private wallet default24h dan timestamp terlihat.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] A login->load->logout->B login->offline tidak menampilkan A di wallet/dashboard/reconciliation.
  - [ ] 401/403 menghapus private display dan meminta autentikasi ulang; tidak mengambil cache.
  - [ ] Logout ketika request/background write berjalan; late response ditolak.
  - [ ] App restart, encrypted storage dan cache format upgrade tidak memulihkan unscoped data; expired cache tidak dirender.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(mobile): isolate offline data by account and session epoch`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task U05: Aksesibilitas form, dialog dan operasi pada layar kecil

**Temuan:** UX-08. **Dependensi:** U01, U02, U03, F01.

**Files:**
- Modify: `components/ui/FormField.tsx`, `components/AppShell.tsx`, `components/ui/DataTable.tsx`, `components/auth/AuthForm.tsx`, `components/wallet/WalletPanel.tsx`, `components/scan/ScanPageClient.tsx`, `components/trip/TripManager.tsx`, `components/admin/RedemptionQueue.tsx`.
- Create: `components/ui/AccessibleDialog.tsx`, `tests/browser/accessibility.spec.ts`.
- Modify: mobile affected screens, `mobile/test/shared/widgets/` relevant form/dialog tests.

**Interfaces:**
Produces shared `AccessibleDialog({open,onClose,title,children})`; prefers native HTML dialog with showModal()/close() and focus restoration, otherwise tested focus trap/inert. FormField contract `id`, `hintId`, `errorId`, passed to Input aria-describedby/aria-invalid. DataTable optional `renderMobileRow(row)` keeps existing desktop API.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
test("dialog traps keyboard focus and restores its trigger",async({page,fixture})=>{
  await fixture.login(page,"userA"); await page.setViewportSize({width:360,height:800});
  await page.goto("/dashboard/user");
  const trigger=page.getByRole("button",{name:"Lainnya",exact:true});
  await trigger.click();
  for(let i=0;i<20;i++) {
    await page.keyboard.press("Tab");
    await expect(page.getByRole("dialog")).toContainText("Menu lainnya");
    expect(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"],dialog'))).toBe(true);
  }
  await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:browser -- tests/browser/accessibility.spec.ts
```

Expected red: Menu lama memiliki aria-modal tetapi Tab dapat keluar ke background.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Hubungkan hint/error ke input dengan ID stabil, role alert hanya untuk error penting dan role status/aria-live polite untuk success/progress; focus first invalid field. Dialog menutup Escape dan restore focus; body scroll/inert dipulihkan saat unmount. Hindari menaruh dialog manual di luar tree yang tetap interaktif.
```tsx
<Input id={id} aria-invalid={Boolean(error)}
  aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} />
```
Task pickup/trip/payout pada mobile memakai list/card row dengan primary action terlihat; tabel desktop dapat horizontal scroll untuk data padat namun tugas inti tidak mengharuskan pengguna mencari aksi di ujung700px. Ukuran target desain44px, visible focus dan kontras diverifikasi pada rendered screen. Pertahankan design tokens existing dan semantic heading, jangan redesign visual seluruh aplikasi.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Keyboard-only login, scan, wallet, menu, trip checkout dan payout approval dapat selesai.
  - [ ] Axe scan pada360/768/1280 light/dark dan200% zoom; manual NVDA/VoiceOver pada error/status.
  - [ ] FormField hints terhubung, status nonwarna, reduced-motion dan tap targets diverifikasi.
  - [ ] Screenshot tiap flow healthy/error/offline disimpan dan diinspeksi; temuan visual audit awal tidak dianggap resolved sebelum evidence ini.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `feat(a11y): unify form feedback dialog focus and mobile actions`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

