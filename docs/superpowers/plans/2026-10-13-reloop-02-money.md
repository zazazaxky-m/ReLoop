# ReLoop Wallet and Reward Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuktikan saldo tidak double-spend, reward sesuai policy dan laporan kewajiban sesuai ledger.

**Architecture:** Service transaksi kecil mengunci user dan aggregate domain, seluruh efek uang memiliki key unik. Constraint database menjadi backstop; PostgreSQL integration tests membuktikan race dan rollback.

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

## Task M01: Transaksi wallet dan idempotency yang benar

**Temuan:** LOG-01. **Dependensi:** F01.

**Files:**
- Modify: `lib/ledger.ts`, `app/api/redemptions/route.ts`, `prisma/schema.prisma`.
- Create: `lib/wallet-service.ts`, `lib/db-locks.ts`, `prisma/migrations/2026101305_wallet_keys/migration.sql`, `scripts/reconcile-wallet-history.ts`, `tests/integration/redemption-race.test.ts`.
- Test: `tests/api/redemptions.test.ts`, `lib/ledger.test.ts`, `tests/lib/ledger.test.ts`.

**Interfaces:**
Produces: `lockUser(tx:Prisma.TransactionClient,userId:string):Promise<void>`; `getWalletBalance(userId:string,tx?:Prisma.TransactionClient):Promise<WalletBalance>`.
`requestRedemption(actor:CurrentUser,input:{amount:number;payoutAccountId:string;idempotencyKey:string}):Promise<{redemption:Redemption;idempotent:boolean}>` owns transaction. HTTP clients may omit key temporarily; server returns generated key. New clients must persist a key per logical request.
`RewardLedger.businessKey String? @unique`, `Redemption.requestHash String?`; replace global idempotency uniqueness with `(userId,idempotencyKey)`. Add DB uniqueness for one EARN per depositItem and one reserve per redemption after legacy diagnostics.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("two different requests cannot reserve the same money", async () => {
  await f.seedBalance(50_000);
  const results = await Promise.all(["one","two"].map(idempotencyKey =>
    f.json("userA","POST","/api/redemptions",{
      amount:50_000,payoutAccountId:f.ids.payoutAccountA,idempotencyKey,
    })));
  expect(results.map(r=>r.status).sort()).toEqual([201,422]);
  expect((await getWalletBalance(f.ids.userA)).available).toBe(0);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/redemption-race.test.ts
```

Expected red: Dua koneksi yang disinkronkan dapat menerima kedua request. F01 menyediakan probe ordering agar test memaksa read bersamaan sebelum patch dan memeriksa blocking setelah patch.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Ekstrak service; load identity IDs, lalu lock User sebelum membaca saldo, account ownership/status dan idempotency. Semua read/write memakai tx. Body canonical amount+accountId menjadi requestHash; existing key milik actor dengan hash berbeda ->409. Key actor lain tidak mengembalikan data mereka.
```ts
await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`;
const balance = await getWalletBalance(userId, tx);
if (balance.available < amount) throw new HttpError(422,"Saldo tersedia tidak mencukupi");
```
Transaction isolation ReadCommitted eksplisit untuk Prisma6. Lock helper melempar404 jika row tidak ada. Seluruh writer EARN/ADJUST/REDEEM (mesin, fraud, review, trip) harus mengikuti lock User yang sama; M03/M04 merapikan caller dan tests. Sampai seluruh writer sudah compliant, monetary rollout tetap tertahan di Z01. Buat reserve businessKey `redemption:<id>:reserve`; DB unique adalah backstop.
Script rekonsiliasi dry-run menginventarisasi saldo negatif, duplicate keys dan reserve tanpa request. Jangan deduplicate/delete histori otomatis. Data konflik harus diselesaikan lewat adjustment/case yang terlacak sebelum unique constraint enforced. Audit/notification setelah commit; kegagalannya tidak membuat user menerima500 untuk transaksi yang sudah committed.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Minimal 20 competing requests dengan jumlah total di atas saldo; available tidak negatif dan aggregate reserve <= saldo awal.
  - [ ] Same key/body concurrent menghasilkan satu redemption; same key/different body ->409; same key dari akun lain tidak membocorkan request.
  - [ ] Response terputus setelah commit, retry key sama mengembalikan request lama.
  - [ ] Payout account dinonaktifkan di tengah request: recheck di transaction menolak akun yang sudah disabled.
  - [ ] Pecahan, integer overflow dan amount negatif ditolak sebelum DB.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(wallet): reserve balance under a user lock`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task M02: Transisi pencairan dan settlement atomik

**Temuan:** LOG-02. **Dependensi:** M01.

**Files:**
- Modify: `lib/wallet-service.ts`, `lib/ledger.ts`, `app/api/redemptions/[id]/route.ts`, `app/api/redemptions/[id]/proof/route.ts`.
- Create: `tests/integration/payout-transitions.test.ts`.
- Test: `tests/api/redemptions-id.test.ts`, `tests/api/redemptions-proof.test.ts`, `tests/lib/ledger.test.ts`.

**Interfaces:**
Produces: `transitionRedemption(actor:CurrentUser,id:string,input:{action:"approve"|"process"|"success"|"fail"|"cancel";note?:string;providerReference?:string}):Promise<{redemption:Redemption;idempotent:boolean}>`.
`settleRedeemLedger(redemptionId,outcome,tx)` wajib membuktikan existing matching settlement atau melakukan tepat satu mutation; inconsistent/missing reserve ->409 dan rollback. Tidak boleh no-op sukses untuk opposite terminal outcome.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("opposite terminal actions leave payout and ledger consistent", async () => {
  const id = await f.processingRedemption(20_000);
  const results = await Promise.all([
    f.json("superadmin","PATCH",`/api/redemptions/${id}`,{action:"fail"}),
    f.json("superadmin","PATCH",`/api/redemptions/${id}`,{action:"success",providerReference:"TEST-REF"}),
  ]);
  expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  const payout = await f.db.redemption.findUniqueOrThrow({where:{id}});
  const reserve = await f.db.rewardLedger.findFirstOrThrow({where:{referenceId:id,entryType:"REDEEM"}});
  expect(reserve.status).toBe(payout.status === "SUCCESS" ? "REDEEMED" : "REVERSED");
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/payout-transitions.test.ts
```

Expected red: Snapshot lama memungkinkan dua outcome yang tidak sesuai dengan ledger.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Lock User kemudian Redemption; recheck status/ownership dan proof dalam transaction. Same terminal outcome idempotent hanya jika ledger juga sudah sesuai. Gunakan CAS:
```ts
const changed = await tx.redemption.updateMany({
  where:{id,status:current.status},data:{status:target},
});
if(changed.count !== 1) throw new HttpError(409,"Status pencairan sudah berubah");
```
Reserve transition juga conditional PENDING; jika count !=1 dan belum matching completed, throw rollback. Approval/cancel race tidak boleh melepaskan reserve lalu menghidupkan request. Transfer eksternal tetap manual; bila operator tidak yakin transfer berhasil, request tetap PROCESSING dengan reconciliation flag/note, bukan fail yang mengembalikan saldo. Snapshot tujuan dibuat saat request dan digunakan dalam queue, bukan akun mutable saat operator menekan success.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Race approve vs cancel; fail vs success pada dua urutan; repeated same terminal ->idempotent200.
  - [ ] Missing reserve, amount mismatch atau ownership berubah ->409 tanpa perubahan parsial.
  - [ ] Notification/audit failure setelah commit tidak menduplikasi settlement; proof tidak dapat dipasang ke request akun/org lain.
  - [ ] Simulasi transfer tidak pasti tetap menahan reserve dan meminta rekonsiliasi.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(payout): commit request and ledger transitions together`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task M03: Kantong valid, checkout dan aggregate trip serial

**Temuan:** LOG-03, EX-02. **Dependensi:** M01.

**Files:**
- Modify: `app/api/manual-validations/route.ts`, `app/api/trash-bags/route.ts`, `lib/trip.ts`, `prisma/schema.prisma`.
- Create: `lib/trip-validation.ts`, `prisma/migrations/2026101306_trip_reward_keys/migration.sql`, `tests/integration/trip-validation.test.ts`.
- Test: `tests/api/manual-validations.test.ts`, `tests/api/trash-bags.test.ts`.

**Interfaces:**
Produces: `validateTripBags(tx,tripId:string,bags:Array<{id:string;status:ConditionStatus}>):Promise<{returnedCount:number;rewardableCount:number}>`; `refreshTripOutcome(tx,tripId:string):Promise<{completed:boolean;rewardAmount:number}>` in lib/trip-validation.ts.
Transaction caller locks reward User (if any), then Trip, then bag rows. Earning uses businessKey `trip:<tripId>:return`; count-only fallback accepts only explicit bounded existing bags with deterministic selection, never arbitrary count for money.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("rejects duplicate and foreign bag IDs without changing any bag", async () => {
  const own = await f.trip({bagCount:1});
  const foreign = await f.trip({bagCount:1,organization:"B"});
  for (const ids of [[own.bagIds[0],own.bagIds[0]],[foreign.bagIds[0]]]) {
    const res=await f.json("adminA","POST","/api/manual-validations",{
      tripId:own.id,validationStage:"CHECK_OUT",appCompleted:true,
      bags:ids.map(id=>({id,status:"GOOD"})),
    });
    expect(res.status).toBe(422);
  }
  expect(await f.db.rewardLedger.count({where:{referenceId:own.id}})).toBe(0);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/trip-validation.test.ts
```

Expected red: Array duplicate dihitung ulang dan foreign IDs diperbarui oleh handler lama.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Sesudah lock, ambil record kantong dengan where tripId+id in uniqueIDs; reject duplicates, missing/foreign IDs dan kondisi tidak sah. Update memakai id+tripId; count dari rows terverifikasi. `bagCount` legacy yang bukan1 harus diaudit karena satu QR bukan otomatis satu unit; normalisasi tercatat atau hitung logical units sesuai policy sebelum constraint.
```ts
const ids=bags.map(b=>b.id);
if(new Set(ids).size!==ids.length) throw new HttpError(422,"Kantong dipindai lebih dari sekali");
const owned=await tx.trashBagAssignment.findMany({where:{tripId,id:{in:ids}}});
if(owned.length!==ids.length) throw new HttpError(422,"Kantong tidak sesuai trip");
```
Jalur progressive scan dan bulk checkout memanggil refreshTripOutcome setelah mutation dalam lock Trip, menghitung ulang semua bags, bukan siblings snapshot sebelum transaction. MONEY_REWARD count-only tanpa IDs tidak boleh mencetak reward; UI/mobile harus mengirim IDs. COMPLIANCE_ONLY legacy count dibatasi jumlah issued. Unique trip earning backfill memakai dry-run M01. Tidak otomatis menambah adjustment hanya karena retry checkout.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Trip satu kantong dengan returnedBagCount500 ditolak; 0 assigned bags tidak boleh mendapat reward.
  - [ ] Dua kantong terakhir dipindai paralel -> seluruhnya reviewed, Trip COMPLETED dan tepat satu earning.
  - [ ] Progressive scan bersamaan bulk checkout -> satu outcome/reward; wrong-org admin/collector ditolak.
  - [ ] Repeated same bag state boleh idempotent; perubahan setelah closed perlu correction workflow yang tidak mencetak reward kedua.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(trips): validate owned bags and serialize checkout`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task M04: Kebijakan reward, sensor review dan koreksi satu kali

**Temuan:** LOG-04, LOG-05, EX-01, EX-03. **Dependensi:** M01, M03.

**Files:**
- Modify: `lib/reward.ts`, `lib/machine-events/acceptance.ts`, `lib/machine-events/ingest.ts`, `lib/machine-events/side-effects.ts`, `app/api/deposit-reviews/[id]/route.ts`, `app/api/scan/route.ts`, trip earning callers.
- Create: `lib/reward-policy.ts`, `lib/reward-credit.ts`, `tests/integration/reward-policy.test.ts`, `tests/integration/review-race.test.ts`.
- Test: `lib/reward.test.ts`, `tests/lib/machine-events/acceptance.test.ts`, `tests/api/deposit-reviews-id.test.ts`.

**Interfaces:**
Produces `decideReward(input:{mode:"MONEY_REWARD"|"COMPLIANCE_ONLY";baseAmount:number;weightValid:boolean;typeMatch:boolean;hasAnomaly:boolean}):{status:"ACCEPTED"|"REVIEW"|"REJECTED";amount:number;ledgerStatus:"AVAILABLE"|"PENDING";reason:string}`.
`creditReward(tx,input:{businessKey:string;userId:string;organizationId:string;campaignId:string|null;amount:number;status:"AVAILABLE"|"PENDING";reasonCode:string;referenceType:string;referenceId:string}):Promise<RewardLedger|null>`; amount0 -> no money entry. Policy decision tidak memiliki DB/network side effect.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("never mints money in a compliance-only campaign",()=>{
  const decision=decideReward({mode:"COMPLIANCE_ONLY",baseAmount:2000,
    weightValid:true,typeMatch:true,hasAnomaly:false});
  expect(decision.amount).toBe(0);
});
it("holds AI mismatches for review",()=>{
  const decision=decideReward({mode:"MONEY_REWARD",baseAmount:2000,
    weightValid:true,typeMatch:false,hasAnomaly:false});
  expect(decision.status).toBe("REVIEW");
  expect(decision.ledgerStatus).toBe("PENDING");
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/reward-policy.test.ts tests/integration/review-race.test.ts
```

Expected red: Kebijakan belum terpusat; COMPLIANCE_ONLY/mismatch lama dapat earning AVAILABLE.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Gunakan mode/type guard pada scan dan setiap jalur pemberian uang, termasuk review yang tidak lewat scan. Campaign mesin yang dibolehkan: MACHINE_DEPOSIT, EVENT, SCHOOL_PROGRAM bila policy menyatakan supportsMachine; TRASH_BAG/TOURISM_PROGRAM tidak masuk scan mesin. No campaign memakai mode MONEY_REWARD organisasi yang explicit.
```ts
where: {wasteTypeId,AND:[activeRateWindow(now),{OR:scopeOr}]}
```
Perbaiki query rate supaya effectiveTo tidak tertimpa. Type classification dibandingkan dengan taxonomy jenis sampah yang dipilih; tambahkan accepted AI labels per waste type dengan migrasi seed PET/can dan admin config. Missing AI pada mesin yang membutuhkan AI ->REVIEW; mesin tanpa AI mengikuti policy barcode+weight yang eksplisit, bukan fallback diam-diam.
Review locks User->Machine/Session/Item; baca ulang item REVIEW dan earning. CAS status, adjustment sebesar target reward dikurangi cumulative committed earning/adjust, unique businessKey `review:<itemId>:decision:v1`. Duplicate approve sama ->idempotent; opposite outcome ->409. Positive/negative adjustment mengikuti budget/funding pada B01. Saldo anomaly yang sudah dicairkan tidak diperbaiki dengan debit paksa; buka reconciliation case.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Mode matrix untuk mesin, manual checkout, progressive bag, approval review: COMPLIANCE_ONLY selalu money0.
  - [ ] AI paper/lowconfidence/wrong selected material ->PENDING; weightinvalid ->REJECTED; unavailable classifier sesuai policy.
  - [ ] Two approvals parallel ->satu adjustment; approve/reject race ->satu outcome konsisten.
  - [ ] Rate active=true tetapi effectiveTo lampau tidak terpilih; boundary effectiveFrom/To dengan UTC diuji.
  - [ ] Retry event setelah DB commit tidak membuat EARN kedua; exception side-effect dalam transaction rollback event dan ledger.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(rewards): enforce campaign and review policy across entry points`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task M05: Rekonsiliasi saldo global dan kesiapan allocation

**Temuan:** LOG-07. **Dependensi:** M01, M02, M04.

**Files:**
- Modify: `lib/ledger.ts`, `app/api/reports/reconciliation/route.ts`, `app/dashboard/superadmin/reconciliation/page.tsx`, `app/api/mobile/overview/route.ts`, `mobile/lib/features/superadmin/superadmin_reconciliation_screen.dart`.
- Create: `tests/integration/reconciliation.test.ts`.
- Modify: `docs/database-ledger-guide.md`; later B01 adds per-organization source allocations.

**Interfaces:**
Produces report fields `availableLiability`, `pendingLiability`, `reservedLiability`, `paidTotal`, `totalObligation`, `unallocatedLegacyAmount`, `hasDiscrepancy`. Keep `totalOutstanding` compatibility alias to availableLiability, documented.
Global totalObligation = available + reserved + pending; paid is reported separately. Org report cannot claim net allocation before B01 backfill finishes: show UNALLOCATED_LEGACY with explicit amount.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("fully redeemed earnings no longer appear as spendable liability", async()=>{
  const id=await f.processingRedemption(100_000);
  await f.json("superadmin","PATCH",`/api/redemptions/${id}`,{
    action:"success",providerReference:"PAID-TEST",
  });
  const report=await getReconciliationReport();
  expect(report.availableLiability).toBe(0);
  expect(report.reservedLiability).toBe(0);
  expect(report.paidTotal).toBe(100_000);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/reconciliation.test.ts
```

Expected red: Report lama tetap menghitung available earning sebelum pengurangan payout.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Gunakan semantics computeBalance, hanya AVAILABLE ADJUST masuk spendable; PENDING ADJUST tampil pending terpisah. Baca aggregates dalam snapshot transaction agar request settlement di tengah query tidak membuat false discrepancy. Jangan menjumlahkan signed discrepancy berbeda untuk menghilangkan selisih yang saling menutup.
```ts
const totalObligation = availableLiability + reservedLiability + pendingLiability;
const hasDiscrepancy = redeemedDiscrepancy !== 0 || reservedDiscrepancy !== 0;
```
Payout-vs-ledger mismatch dilaporkan per request dan status, bukan hanya total. Phase M05 memperbaiki global report; finding LOG-07 baru CLOSED sesudah B01 menambahkan allocation per organisasi dan backfill. UI label Indonesia: Saldo tersedia, Menunggu pemeriksaan, Sedang dicairkan, Sudah dibayar; jelaskan data legacy yang belum teralokasi.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] EARN100k ->reserve40k ->success40k menghasilkan available60k/reserved0/paid40k.
  - [ ] Pending adjust tidak menaikkan spendable; reversal reserve mengembalikan available.
  - [ ] Dua discrepancy +100/-100 tidak menghasilkan indikator sehat palsu.
  - [ ] Snapshot report saat transition parallel konsisten; sum organization allocations +legacy bucket = global.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(reconciliation): report net liabilities and explicit discrepancies`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

