# ReLoop Validation and Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyediakan test nyata, dependency triage dan bukti penutupan yang diperlukan untuk seluruh remediasi.

**Architecture:** Environment test terisolasi membuktikan transaksi dan client contracts; release bertahap memakai migration gates, evidence registry dan rollback yang menjaga data finansial.

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

## Task F00: Triage dependency dan upgrade yang dapat diverifikasi

**Temuan:** SEC-07. **Dependensi:** tidak ada.

**Files:**
- Modify: `package.json`, `package-lock.json`, `rvm/requirements.txt`, `.github/workflows/ci.yml`, `.github/workflows/security-scan.yml`, `Dockerfile`, `Dockerfile.realtime` bila runtime membutuhkan patch.
- Create: `docs/security/dependency-triage.md`, `scripts/check-dependency-advisories.mjs`, `tests/dependency-gate.test.mjs`, `tests/fixtures/audit-runtime-critical.json`, `tests/fixtures/audit-empty.json`, `tests/fixtures/triage-empty.json`.
- Review: `.github/renovate.json`, `mobile/pubspec.yaml`, `mobile/pubspec.lock` untuk dependency yang benar-benar terdampak; tidak melakukan upgrade massal tanpa alasan.

**Interfaces:**
Produces advisory triage rows `{package,installed,advisory,scope,runtimeReachable,fixedVersion,decision,owner,expiresAt}`. Gate script accepts npm audit JSON file and triage path; exit1 bila reachable high/critical belum fixed atau exception expired; unresolved reachability diperlakukan blocking untuk runtime. Scope dev tetap memiliki mitigasi dan batas waktu, bukan otomatis diabaikan.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```js
// scripts/check-dependency-advisories.mjs must fail for an untriaged runtime critical.
import {spawnSync} from "node:child_process";
import {strict as assert} from "node:assert";
const result=spawnSync(process.execPath,["scripts/check-dependency-advisories.mjs",
  "tests/fixtures/audit-runtime-critical.json","tests/fixtures/triage-empty.json"]);
assert.equal(result.status,1);
const safe=spawnSync(process.execPath,["scripts/check-dependency-advisories.mjs",
  "tests/fixtures/audit-empty.json","tests/fixtures/triage-empty.json"]);
assert.equal(safe.status,0);
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
node --test tests/dependency-gate.test.mjs
npm audit --json > artifacts/npm-audit-current.json
```

Expected red: Audit baseline melaporkan advisory; gate belum ada. Tambahkan fixtures satu advisory critical runtime, audit kosong dan triage kosong. Positive assertion exit0 memastikan script yang hilang tidak membuat test false-green.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Jalankan audit fresh pada saat implementasi; baseline 28 package entries tidak dianggap inventory terbaru. Pisahkan production dependency, build chain dan UI test/dev server. Periksa advisory maintainer dan preconditions. Pilih patched release kompatibel, pin lockfile, update Next+eslint-config-next sejalan, Vitest+coverage sejalan. Jangan memakai npm audit fix --force.
```bash
npm audit --json > artifacts/npm-audit-current.json
npm audit --omit=dev --json > artifacts/npm-audit-runtime.json
npm ls next prisma @prisma/client vitest @vitest/coverage-v8
```
Exit audit nonzero di atas adalah evidence, bukan alasan melewatkan file output. Node runtime CI/container dipilih dari supported release yang kompatibel dengan target dependency dan disamakan. Prisma6 tetap untuk patch invariant; jika advisory Prisma tidak punya patch6 dan reachable, buka migration task eksplisit dengan service API compatibility sebelum mengaktifkan monetary rollout. Jangan mengikuti dokumentasi ORM8 tanpa migration plan. Tambahkan direct JS advisory-check fixtures+node test pada security CI; upgrade tidak boleh menghapus security assertions untuk memperoleh green.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Production/build/dev exposure tiap high/critical memiliki evidence dan owner; expiry exception diperiksa.
  - [ ] npm ci reproducible; prisma generate, test, typecheck, lint dan production build lulus setelah upgrade.
  - [ ] Render/QR/map/auth smoke pada Next patched; default dev servers tidak dibuka publik.
  - [ ] Python OpenCV dipasang pada venv test, Flutter lockfile diaudit sesuai tools tersedia; tidak mengklaim semua ecosystem aman hanya dari npm audit.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `chore(security): patch and gate dependency advisories`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task F01: Harness integration, browser, mobile dan RVM

**Temuan:** TEST-FOUNDATION. **Dependensi:** tidak ada.

**Files:**
- Modify: `package.json`, `vitest.config.ts`, `.github/workflows/ci.yml`, `.gitignore`.
- Create: `docker-compose.audit.yml`, `scripts/run-audit-tests.mjs`, `vitest.integration.config.ts`, `vitest.realtime.config.ts`, `playwright.config.ts`, `tests/support/audit-fixture.ts`, `tests/support/browser-fixture.ts`, `tests/integration/harness.test.ts`.
- Create: `tests/support/realtime-harness.ts`, `tests/fixtures/` contract data. Install dev-only `@playwright/test`, `@axe-core/playwright` with compatible lockfile; install Python requirements in isolated venv during test execution.

**Interfaces:**
Produces npm scripts `test:integration` -> node scripts/run-audit-tests.mjs integration; `test:browser` -> same runner browser; `test:realtime` -> same runner realtime; runner forwards arguments after --.
Vitest fixture contract and BrowserFixture methods are fully specified in master. Integration uses PostgreSQL16+Redis test-only, real Next HTTP process and actual auth/session; no mock Prisma/role guard. Test mail/push use in-process fake transport injected only by test environment.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("rolls back real PostgreSQL writes and enforces foreign keys",async()=>{
  const before=await f.db.user.count();
  await expect(f.db.$transaction(async tx=>{
    await tx.user.create({data:{name:"Rollback",email:"rollback@example.test"}});
    throw new Error("ROLLBACK_PROBE");
  })).rejects.toThrow("ROLLBACK_PROBE");
  expect(await f.db.user.count()).toBe(before);
  await expect(f.db.depositSession.create({data:{
    userId:"missing-user",machineId:f.ids.machineA,status:"ACTIVE",
  }})).rejects.toMatchObject({code:"P2003"});
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/harness.test.ts
```

Expected red: Harness belum ada; pastikan kegagalan berubah dari setup error menjadi behavioral test sebelum task domain dinilai red.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Runner wajib memvalidasi database test terpisah sebelum migrate/reset: host loopback atau service CI dedicated, database bernama reloop_audit_test, explicit AUDIT_TEST_RUN=1 dan URL bukan DATABASE_URL user yang sudah ada. Compose project khusus test dengan database/Redis ephemeral; tidak memakai volume reloop-db-data. Runner membuat secret acak per run untuk AUTH_JWT_SECRET/ENCRYPTION_KEY/AUDIT_CHECKSUM_SECRET/REALTIME_INTERNAL_SECRET dan tidak mencetak nilainya. npx prisma migrate deploy hanya pada database test; environment startup server dan client db identik.
```ts
// vitest.integration.config.ts
export default defineConfig({test:{environment:"node",
  include:["tests/integration/**/*.test.ts"],fileParallelism:false,
  setupFiles:["tests/support/audit-fixture.ts"]},
  resolve:{alias:{"@":path.resolve(__dirname,".")}}});
```
Unit config exclude tests/integration dan tests/realtime; browser menggunakan *.spec.ts, tidak masuk Vitest. Fixture cleanup terbatas database disposable dan namespace test. Race tests minimal dua koneksi, deterministic barrier/probe lewat dependency-injected service hooks dalam test process, tidak menambah endpoint test/admin backdoor ke production. Jangan menunggu kedua transaksi mencapai checkpoint setelah lock karena akan deadlock; buktikan transaksi kedua blocked, kemudian release pertama. Tambahkan fault injection setelah DB commit untuk lost response.
Install cv2 dari rvm/requirements.txt pada .venv audit dan jalankan test Python; Flutter test dari direktori mobile. Browser screenshots diperiksa pada360/768/1280 light/dark; artifact secrets/token dimasking. CI jobs DB/browser/Python/Flutter menggunakan environment dedicated, bukan production URL. Production build tetap gate tersendiri.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Safety guard runner menolak URL production/remote tak dikenal sebelum satu mutation pun.
  - [ ] Missing DB/Redis membuat test fail jelas, tidak otomatis mengganti dengan mock.
  - [ ] SQL row lock test membuktikan blocking/rollback; tests cleanup tidak menghapus row di DB operasional.
  - [ ] Backend dan Flutter DTO contract fixtures memiliki version dan diuji dua pihak.
  - [ ] CI menangkap screenshot/log tanpa cookie, password, token atau nomor payout penuh.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `test: add real database and cross-client regression harness`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task Z01: Penutupan temuan, migrasi bertahap dan rollout

**Temuan:** RELEASE-GATE. **Dependensi:** F00, F01, A01, A02, A03, A04, A05, M01, M02, M03, M04, M05, R01, R02, R03, R04, U01, U02, U03, U04, U05, B01, B02, B03, B04, B05.

**Files:**
- Create: `docs/runbooks/reloop-remediation-rollout.md`, `scripts/verify-remediation-coverage.mjs`, `tests/remediation-coverage.test.mjs`, `tests/fixtures/coverage-without-hardware.json`, `tests/fixtures/coverage-complete-evidence.json`.
- Update: `docs/superpowers/plans/2026-10-13-reloop-remediation-coverage.json`, `.github/workflows/deploy.yml`, `docs/mobile-api.md`, `docs/kiosk-setup-guide.md`.
- Produce reviewed artifacts under `artifacts/remediation/` for test results, migration dry-run, protocol versions, screenshots and hardware acceptance; do not store secrets.

**Interfaces:**
Produces finding statuses PLANNED -> IMPLEMENTED -> VERIFIED -> RELEASED with evidence path, commit, migration state, release version and owner. Release gates per phase can run before all tasks, but global closure requires all34 finding rows. `verify-remediation-coverage.mjs --phase <phase>` checks only applicable rows and exits1 for missing proof; no automatic marking verified from passing mock suite.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```js
import {strict as assert} from "node:assert";
import {spawnSync} from "node:child_process";
const result=spawnSync(process.execPath,["scripts/verify-remediation-coverage.mjs",
  "--phase","all","--manifest","tests/fixtures/coverage-without-hardware.json"]);
assert.equal(result.status,1); // SEC-02 cannot close without physical acceptance evidence.
const complete=spawnSync(process.execPath,["scripts/verify-remediation-coverage.mjs",
  "--phase","all","--manifest","tests/fixtures/coverage-complete-evidence.json"]);
assert.equal(complete.status,0);
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
node --test tests/remediation-coverage.test.mjs
node scripts/verify-remediation-coverage.mjs --phase all
```

Expected red: Saat plan dibuat seluruh finding PLANNED; close gate harus menolak penutupan tanpa evidence. Fixture positive berisi34 rows lengkap dengan temporary evidence files yang dibuat test; bukan bukti rollout nyata. Uji positif mencegah missing script dianggap hasil penolakan yang benar.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Jalankan dry-run migrations pada restored staging copy yang telah diminimalkan datanya. Backup DB/SQLite dan uji restore sebelum enforcement constraints. Migrasi satu owner; jangan merge dua perubahan schema tanpa regenerate Prisma dan test ulang keseluruhan. Expand fields -> deploy compatible writers/readers -> backfill with digest -> reconcile totals -> enable constraints/feature flag -> remove compatibility setelah client fleet diperbarui.
```bash
npm run typecheck
npm run lint
npm test -- --maxWorkers=2 --minWorkers=1
npm run test:integration
npm run test:realtime
npm run test:browser
npm run build
python3 -m unittest discover -s tests -p 'test_rvm*.py'
```
Python command berjalan dalam venv audit dengan cv2; Flutter commands `flutter analyze` dan `flutter test` dijalankan dari mobile. Cek unit/browser config tidak menghitung suite dua kali atau melewatkan tests.
Rollout order: A01 web+realtime force re-login; R01 limited safe machine canary; server R02 additive contract sebelum edge; wallet/trip locks dan DBconstraints sebelum UI uang; invitation/mailbox verification sebelum akses membership diperluas; mobile cache purge v2 pada upgrade; B01 funding expand kemudian B02 backfill lalu enforcement; B03 snapshots dan B04 settlement setelah kebijakan dikonfirmasi.
Rollback mempertahankan additive schema. Tidak downgrade kembali ke token bypass, worker yang membuang event, atau controller yang mengabaikan interlock; gunakan disable affected feature/maintenance dan forward fix. Financial backfill apply tidak di-undo lewat delete/history rewrite; koreksi memakai compensating entry yang direview. Task ini menyiapkan deployment yang reviewable; execution production memerlukan instruksi deploy dari pengguna/pemilik environment.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Seluruh34 finding punya task+test+status+evidence; UX-05 dan EX-01..04 tidak hilang dari coverage.
  - [ ] Rehearsal migration old snapshot menjaga saldo tiap user, total liabilities, FK, old payout snapshots dan audit history.
  - [ ] Canary test machine tidak mengirim reward uang production tanpa skenario yang diotorisasi; teknisi menandatangani interlock evidence.
  - [ ] Monitoring selama satu siklus operasional penuh mencakup closed-session outbox, dead-letter, negative balances, inconsistent payout, funding gap, expired sockets dan failed erasure jobs.
  - [ ] Rollback drill membuktikan fitur dapat dipause tanpa kehilangan queue/ledger; owner untuk setiap alert dan discrepancy tercatat.
  - [ ] Build/security scan/test hasil baru disimpan; baseline audit lama tidak digunakan sebagai bukti release.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `docs(release): verify remediation evidence and rollout gates`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

