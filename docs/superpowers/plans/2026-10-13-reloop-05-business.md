# ReLoop Funding and Bulk Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menutup gap sumber dana reward, alokasi kewajiban, kebijakan komersial dan pembayaran material bulk.

**Architecture:** Funding dan settlement manual ditambahkan sebagai ledger/domain terpisah yang terhubung ke transaksi pengguna. Kebijakan baru disnapshot; data lama direkonsiliasi tanpa mengarang kas atau pembayaran.

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

## Task B01: Funding reward dan budget sebelum menerima setoran

**Temuan:** BIZ-02. **Dependensi:** M01, M03, M04, R01, R03, F01.

**Files:**
- Modify: `prisma/schema.prisma`, `lib/reward-credit.ts`, `lib/deposit-session-service.ts`, `lib/trip-validation.ts`, `app/api/trash-bags/route.ts`, `lib/machine-events/acceptance.ts`, `app/api/deposit-reviews/[id]/route.ts`, `app/api/machine-session/[code]/route.ts`, `rvm/controller.py`, `rvm/database.py`.
- Create: `lib/reward-funding.ts`, `app/api/organizations/[id]/funding/route.ts`, `components/admin/RewardFundingPanel.tsx`, `prisma/migrations/2026101308_reward_funding/migration.sql`, `tests/integration/reward-funding.test.ts`.
- Modify: campaign/organization manager UI, `app/api/campaigns/route.ts`, `app/api/campaigns/[id]/route.ts`, `docs/database-ledger-guide.md`.

**Interfaces:**
Produces models: RewardFundingAccount(id,organizationId unique,confirmedRupiah,heldRupiah,version), FundingEntry(id,accountId,businessKey unique,kind,amount,reference,verifiedById,createdAt), RewardBudgetReservation(id,businessKey unique,accountId,campaignId?,userId,sourceType,sourceId,ceilingRupiah,remainingRupiah,status), Campaign.rewardBudgetRupiah/heldRupiah/spentRupiah nullable during expand.
`reserveRewardBudget(tx,input:{businessKey:string;organizationId:string;campaignId:string|null;userId:string;ceilingRupiah:number;sourceType:"SESSION"|"TRIP";sourceId:string}):Promise<string>`; `commitRewardAgainstBudget(tx,reservationId:string,businessKey:string,amount:number):Promise<void>`; `releaseUnusedRewardBudget(tx,reservationId:string,amount:number):Promise<void>`.
FundingEntry kinds CONFIRMED_TOPUP, PAYOUT, CORRECTION; holds are reservations, not fictional cash. All functions require User->funding account->Campaign locks before domain locks.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("cannot admit two reward obligations beyond funded capacity",async()=>{
  await f.confirmFunding(10_000);
  const attempts=await Promise.allSettled(["admission-a","admission-b"].map(businessKey=>
    f.reserveBudget({businessKey,amount:8_000})));
  expect(attempts.filter(x=>x.status==="fulfilled")).toHaveLength(1);
  const account=await f.db.rewardFundingAccount.findUniqueOrThrow({where:{organizationId:f.ids.orgA}});
  expect(account.heldRupiah).toBe(8_000);
  expect(account.confirmedRupiah).toBe(10_000);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/reward-funding.test.ts
```

Expected red: Existing earning tidak memiliki funded capacity atau campaign cap.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Expand models dan admin view lebih dahulu dengan feature flag `REWARD_FUNDING_ENFORCED=false`; flag tidak berarti finding closed. Operator mengonfirmasi funding dengan bukti/reference unik dan verified actor; tidak mengirim uang otomatis. Sebelum flag true, B02 backfill opening obligations dan confirmation funding nyata harus selesai.
Reserve maksimum kewajiban sebelum barang diterima: sesi mesin memakai configured `maxRewardPerSessionRupiah` dan max item/weight bound pada signed lease; issuance bag/trip mereservasi jumlah issued x rate snapshot x maximum multiplier. Nilai cap wajib dikonfigurasi saat mengaktifkan program, bukan arbitrary nominal yang di-hardcode. Lease protocol v2 wajib mengikat cap ke HMAC: canonical JSON array `[2,id,machineCode,sessionId,userRef,issuedAt,expiresAt,reservationId,policyVersion,ceilingRupiah,maxItems]`, UTF-8 compact JSON dengan urutan tetap; Node JSON.stringify array dan Python json.dumps(...,separators=(",",":"),ensure_ascii=False) menghasilkan bytes identik. SQLite menyimpan field bertanda tangan. Worker yang belum mendukung v2 tidak menerima sesi berhadiah setelah funding enforcement aktif. Renew lease mempertahankan reservation/ceiling dan consumed counter durable, tidak mereset budget. Tambahkan fixture signature lintas Node/Python dan test tampering terhadap setiap cap field. RVM berhenti menerima barang jika bound sesi habis; user melihat batas sebelum mulai.
```ts
if(account.confirmedRupiah-account.heldRupiah < ceilingRupiah)
  throw new HttpError(409,"Program sementara tidak menerima setoran berhadiah");
if(campaign && campaign.rewardBudgetRupiah-campaign.heldRupiah-campaign.spentRupiah < ceilingRupiah)
  throw new HttpError(409,"Kuota reward program tidak mencukupi");
```
Earning accepted mengubah admission hold menjadi obligation hold tanpa mengurangi kas. PENDING review menahan ceiling yang mungkin disetujui; review final/reject melepaskan selisih. Commit transaction mengikat budget event dengan unique businessKey, sehingga retry tidak memakai budget dua kali. Rate/multiplier snapshot admission membatasi late/offline event; jangan mereprice barang yang sudah masuk berdasarkan konfigurasi baru. Sisa hold baru dilepas setelah close watermark dari RVM memastikan semua event sudah tersinkron; koneksi hilang ->retain hold dan rekonsiliasi, bukan timeout yang membebaskan dana untuk dibelanjakan dua kali.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Campaign dan global organization budget diuji pada dua user/concurrent credits, termasuk review dari pending ke available.
  - [ ] Insufficient funding menolak admission sebelum input gate/trip bag issuance; material yang sudah diterima tidak diam-diam kehilangan reward.
  - [ ] Offline batch setelah rate change memakai snapshot; duplicate localEventId tidak memakai dana lagi.
  - [ ] COMPLIANCE_ONLY tidak perlu money reservation dan tidak menciptakan funding entry uang.
  - [ ] Topup idempotent berdasarkan reference, hanya actor berwenang dan evidence tervalidasi; rollback credit juga rollback consumption.
  - [ ] Monitoring reserved ceiling yang lama menggantung mempunyai owner dan alasan rekonsiliasi.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `feat(funding): reserve reward capacity before deposit admission`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task B02: Alokasi earning dan migrasi kewajiban per organisasi

**Temuan:** LOG-07, BIZ-02. **Dependensi:** M05, B01.

**Files:**
- Modify: `prisma/schema.prisma`, `lib/wallet-service.ts`, `lib/ledger.ts`, `lib/reward-credit.ts`, `lib/reward-funding.ts`, report endpoints/web/mobile reconciliation.
- Create: `lib/ledger-allocation.ts`, `scripts/backfill-ledger-allocations.ts`, `prisma/migrations/2026101309_reward_allocations/migration.sql`, `tests/integration/ledger-allocation.test.ts`.

**Interfaces:**
Produces RewardAllocation(redemptionId,creditLedgerId,organizationId?,amount,status RESERVED/PAID/RELEASED, unique redemptionId+creditLedgerId); CreditLot ledgerId unique, availableRupiah, reservedRupiah, paidRupiah.
`allocateRedemption(tx,userId:string,redemptionId:string,amount:number):Promise<void>`; `settleAllocations(tx,redemptionId:string,outcome:"success"|"failed"):Promise<void>`.
Backfill script default dry-run; `--apply --expected-digest <digest>` requires matching diagnostics of the same DB snapshot/run. Source attribution missing ->LEGACY_UNALLOCATED, never invent organization.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("FIFO allocation keeps organization totals equal to global balance",async()=>{
  await f.seedCredit({organization:"A",amount:30_000});
  await f.seedCredit({organization:"B",amount:20_000});
  const id=await f.redeemAndSettle(40_000);
  const rows=await f.db.rewardAllocation.findMany({where:{redemptionId:id},orderBy:{amount:"desc"}});
  expect(rows.map(r=>r.amount)).toEqual([30_000,10_000]);
  const report=await getReconciliationReport();
  expect(report.availableLiability).toBe(10_000);
  expect(report.organizations.reduce((n,o)=>n+o.outstanding,0)+report.unallocatedLegacyAmount).toBe(10_000);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/ledger-allocation.test.ts
```

Expected red: Global report phaseM05 belum dapat menurunkan liability per org karena reserve tidak membawa sumber earning.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Reserve di wallet mengalokasikan FIFO `(createdAt,id)` ke kredit AVAILABLE; lock User lalu account organisasi sorted sebelum allocate. Cancel melepas allocation ke available lot; success mengubah RESERVED->PAID, mengurangi funding confirmed dan obligation held sesuai source. Payout cancellation tidak mengembalikan budget campaign karena obligation user masih ada.
```ts
// Seluruh angka di bawah diperiksa non-negative dan di-update bersama reserve ledger.
const take=Math.min(remaining,lot.availableRupiah);
remaining-=take;
```
ADJUST positif menjadi lot baru dengan source yang sama; ADJUST negatif menyerap sisa available lot terkait, tidak mengubah paid history. Jika tidak cukup, buat reconciliation case dan freeze issuance/affected payout sampai keputusan operator, bukan saldo negatif baru.
Backfill chronological earning+reserve+settlement dari snapshot; output rows count, sum credit/debit, legacy bucket, funding gap dan digest. Apply idempotent melalui unique keys dalam maintenance window monetary writes paused. Saldo user before/after harus identik. Historical obligations dimasukkan held/opening obligation; confirmed cash hanya dari bukti pendanaan nyata. Funding gap tidak diisi dengan fake topup. Flag enforcement B01 aktif hanya setelah owner menyetujui pendanaan/policy dan negative gaps diselesaikan atau menjadi managed exception dengan cap issuance0.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Cross-org partial reserve/paid/reversal, signed adjustment dan pending earning tidak dialokasikan sebagai available.
  - [ ] Sum lot balances sama ledger; sum org+unallocated sama global pada setiap state.
  - [ ] Dry-run tidak menulis; second apply tidak menggandakan; snapshot berubah membuat digest mismatch abort.
  - [ ] Payout dan new earning selama backfill diblok atau memakai mode dual-write yang teruji; tidak terjadi missed window.
  - [ ] Legacy funds missing/negative balances menghasilkan daftar kasus, bukan auto-write saldo atau attribution palsu.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `feat(ledger): allocate payouts to funded earning sources`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task B03: Policy reward partisipasi, recipient dan fee snapshot

**Temuan:** BIZ-03, BIZ-05, UX-04. **Dependensi:** M03, M04, U02, B01.

**Files:**
- Modify: `prisma/schema.prisma`, `lib/trip.ts`, `lib/trip-validation.ts`, `components/trip/TripManager.tsx`, `components/admin/CampaignManager.tsx`, trip/campaign/redemption APIs, `components/wallet/WalletPanel.tsx`.
- Create: `lib/commercial-policy.ts`, `app/api/trips/[id]/recipient-confirmation/route.ts`, `prisma/migrations/2026101310_policy_snapshots/migration.sql`, `tests/integration/commercial-policy.test.ts`.
- Modify mobile trip/wallet DTO/screens; docs `business_logic_and_roles.md`, `tourism-compliance-user-manual.md`, `database-ledger-guide.md`, `mobile-api.md`.

**Interfaces:**
Produces Campaign policyVersion, rewardBasis PARTICIPATION, rewardPerBagRupiah default2000, maxBagsPerParticipant, maxBagsPerTrip; TrashBagAssignment.contentConfirmed; Trip.rewardPolicySnapshot, recipientConfirmedAt/byId, recipientUserId snapshot (existing userId source); immutable redemption payout destination encrypted snapshot and grossAmount/feeAmount/netAmount/policyVersion.
`quotePayout(grossAmount:number,feeAmount:number):{grossAmount:number;feeAmount:number;netAmount:number}` validates 0<=fee<=gross; production fee config default0 and only revised after policy approval. Add `confirmTripRecipient(actor:CurrentUser,tripId:string):Promise<void>` requiring actor.id=trip.userId and pre-check-in state.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("keeps payout arithmetic explicit with zero default fee",()=>{
  expect(quotePayout(10_000,0)).toEqual({grossAmount:10_000,feeAmount:0,netAmount:10_000});
  expect(()=>quotePayout(10_000,10_001)).toThrow();
});
it("rejects money trip check-in before recipient confirms",async()=>{
  const trip=await f.trip({bagCount:0,recipientConfirmed:false,status:"PLANNED"});
  const res=await f.json("adminA","POST","/api/manual-validations",{
    tripId:trip.id,validationStage:"CHECK_IN",appCompleted:true,
  });
  expect(res.status).toBe(409);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/commercial-policy.test.ts
```

Expected red: Reward docs menyatakan timbangan, fee/destination tidak tersnapshot dan recipient belum memiliki konfirmasi eksplisit.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Reward partisipasi ditampilkan sebelum join/check-in. Satu issued bag mendapat reward hanya jika contentConfirmed dan GOOD/PARTIAL; batas issuance dipakai bersama participantCount sehingga tidak bisa menerbitkan tak terbatas. Operator scan+konfirmasi material, bukan tombol default semua kantong dianggap berisi. Berat dicatat untuk inventory dan settlement, tidak dipakai menampilkan janji reward berbasis kilogram.
```ts
const rewardable = bags.filter(b=>b.contentConfirmed && isRewardableCondition(b.status));
const reward = Math.floor(rewardable.length * snapshot.rewardPerBagRupiah *
  snapshot.multiplier * complianceScore / 100);
```
Policy snapshot immutable setelah admission; perubahan berlaku ke trip/sesi baru. Existing completed trips tidak direprice, active legacy trip diberi label policy lama dan selesai pada kontrak yang sudah dijanjikan. Trip baru MONEY_REWARD memerlukan confirmed recipient, perubahan recipient reset confirmation sebelum check-in dan dilarang sesudah earning.
Snapshot payout encrypted memastikan penghapusan/ubah akun tidak mengganti tujuan transfer existing. Migrasi historical gross=amount/fee0/net=amount; jika destination sudah hilang, tandai unavailable legacy dan jangan menebak nomor. Docs membedakan biaya aktif0 dari model subscription/fee potensial; tidak membangun auto-billing atau mengaktifkan charge saat remediasi.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Empty/extra/unissued bags tidak menambah reward; partial compliance dihitung floor sesuai snapshot.
  - [ ] Recipient lain tidak bisa confirm, admin tidak menyamar confirm user; change recipient menghapus consent dan blocked setelah check-in.
  - [ ] Historical balances/tarif tetap; fee0 everywhere backend/mobile/web receipt cocok.
  - [ ] Destination account diubah/dihapus setelah request tidak mengubah snapshot payout; snapshot akses dibatasi owner/superadmin dan dimasking.
  - [ ] Policy cap belum dikonfigurasi menahan aktivasi campaign baru, dengan pesan operator yang jelas.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `feat(policy): snapshot participation rewards recipients and payout terms`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task B04: Settlement pembelian material bulk

**Temuan:** BIZ-01. **Dependensi:** F01, A05.

**Files:**
- Modify: `prisma/schema.prisma`, `components/pickup/PickupManager.tsx`, `components/pickup/PickupTaskList.tsx`, `components/travel-agent/TourismPickupManager.tsx`.
- Create: `lib/bulk-settlement.ts`, `app/api/pickups/[id]/settlement/route.ts`, `components/pickup/BulkSettlementPanel.tsx`, `prisma/migrations/2026101311_bulk_settlements/migration.sql`, `tests/integration/bulk-settlement.test.ts`.
- Modify mobile: `mobile/lib/features/pickup/pickup_screen.dart`, `mobile/lib/features/pickup/tourism_pickups_screen.dart`; docs business flow.

**Interfaces:**
Produces BulkSettlement unique pickupRequestId, version, status DRAFT/PROPOSED/AGREED/PAYMENT_REPORTED/PAID/DISPUTED/VOID, grossRupiah,deductionsRupiah,netRupiah,paymentReference?,confirmedById?, timestamps; BulkSettlementLine wasteTypeId, verifiedWeightGrams Int, pricePerKgRupiah Int, lineAmountRupiah Int; approvals per actor/side/version unique.
`quoteBulk(lines:Array<{weightGrams:number;pricePerKgRupiah:number}>,deductionsRupiah:number):{grossRupiah:number;netRupiah:number}`; `transitionBulkSettlement(actor,pickupId,input:{action:"propose"|"agree"|"report-payment"|"confirm-payment"|"dispute"|"void";expectedVersion:number;reference?:string;reason?:string})` uses optimistic version under pickup lock.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("rounds integer bulk quote and never permits negative net",()=>{
  expect(quoteBulk([{weightGrams:1250,pricePerKgRupiah:3000}],250))
    .toEqual({grossRupiah:3750,netRupiah:3500});
  expect(()=>quoteBulk([{weightGrams:1000,pricePerKgRupiah:1000}],1001)).toThrow();
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/bulk-settlement.test.ts
```

Expected red: Model pickup belum memiliki quote, approvals atau settlement.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Harga/berat terverifikasi per material dan deductions dijelaskan per alasan. Kalkulasi integer memakai BigInt intermediate:
```ts
const lineAmount=(BigInt(weightGrams)*BigInt(pricePerKgRupiah)+500n)/1000n;
```
Tolak weight/rate negatif, overflow Int dan deductions>gross. Admin/collector assigned mengonfirmasi proposal version yang sama; user yang sama tidak boleh mewakili dua sisi. Edit setelah proposal bump version dan reset approvals. Collector melaporkan payment reference/proof lalu admin organisasi mengonfirmasi penerimaan; PAID memerlukan proof/reference serta persetujuan pihak penerima. SUPERADMIN override membutuhkan alasan/audit tersendiri dan terlihat pada receipt. Tidak ada bank transfer otomatis.
Logistics COMPLETED tidak otomatis PAID. Tourism BANK_SAMPAH_PICKUP membuat/menghubungkan PickupRequest canonical supaya settlement memakai model sama dan tidak menggandakan pickup. Completed historical pickups ditandai LEGACY_UNRECORDED bila pembayaran belum ada; jangan backfill PAID tanpa bukti. Dispute mempertahankan quote/proof dan status riwayat; correction setelah PAID memakai credit/debit note tersendiri, tidak mengedit nilai lama.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Cross-org admin, collector bukan assigned dan inactive partner tidak dapat quote/approve/proof.
  - [ ] Dua approvals berbeda version tidak menghasilkan AGREED; doubleconfirm payment idempotent.
  - [ ] Logistics complete unpaid, partial/contaminated material, rate change dan rounding grams diuji.
  - [ ] Same actor kedua sisi ditolak; proof access private, upload divalidasi menggunakan pola redemption-proof existing.
  - [ ] Tourism pickup dan machine pickup memiliki satu settlement canonical, legacy status tidak mengklaim telah dibayar.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `feat(pickup): record agreed bulk value and payment settlement`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task B05: Dispatch admin konsisten dan tugas punya pemilik

**Temuan:** BIZ-04. **Dependensi:** F01.

**Files:**
- Modify: `lib/pickup.ts`, `app/api/pickups/[id]/route.ts`, `app/api/pickups/route.ts`, `components/pickup/PickupManager.tsx`, `components/pickup/PickupTaskList.tsx`, `prisma/schema.prisma`.
- Create: `prisma/migrations/2026101312_pickup_version/migration.sql`, `tests/integration/pickup-dispatch.test.ts`.
- Modify: `mobile/lib/features/admin/admin_pickups_screen.dart`, `mobile/lib/features/pickup/pickup_screen.dart`, `docs/business_logic_and_roles.md`.

**Interfaces:**
Produces PickupRequest.version Int default0, assignedAt?, expectedStartAt?, lastEscalatedAt?; PATCH body adds expectedVersion. Admin assignment remains policy; no public collector self-claim endpoint.
`assignPickup(actor:CurrentUser,pickupId:string,input:{collectorId:string;expectedVersion:number;expectedStartAt?:string}):Promise<PickupRequest>` verifies live partnership then CAS. Reassignment only REQUESTED/ASSIGNED; field work already started needs fail/cancel and explicit replacement task.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("a stale dispatch cannot replace a newer assignment",async()=>{
  const pickup=await f.pickup();
  const first=await f.json("adminA","PATCH",`/api/pickups/${pickup.id}`,{
    action:"assign",collectorUserId:f.ids.collectorA,expectedVersion:0,
  });
  expect(first.status).toBe(200);
  const stale=await f.json("adminA","PATCH",`/api/pickups/${pickup.id}`,{
    action:"assign",collectorUserId:f.ids.collectorB,expectedVersion:0,
  });
  expect(stale.status).toBe(409);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/pickup-dispatch.test.ts
```

Expected red: API assignment lama tidak membawa version untuk menolak keputusan operator dari snapshot lama.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Dokumentasi menyatakan admin dispatch, notification dikirim hanya kepada collector yang assigned dan admin terkait. Update conditional version+state dan increment version. Pertahankan field request existing `collectorUserId`; petakan ke `assignedCollectorId` pada DB. Tambahkan expectedVersion pada web/mobile sebelum endpoint mewajibkannya; client lama menerima409 dengan petunjuk upgrade/muat ulang pada stale mutation, bukan bypass CAS.
```ts
const changed=await tx.pickupRequest.updateMany({where:{id,version:expectedVersion,
  status:{in:["REQUESTED","ASSIGNED"]}},data:{assignedCollectorId:collectorId,
  status:"ASSIGNED",version:{increment:1},assignedAt:new Date()}});
if(changed.count!==1) throw new HttpError(409,"Tugas telah diperbarui; muat ulang");
```
UI menampilkan PIC, status berikutnya, assignedAt dan tenggat yang diatur operator. Bila expectedStartAt terlewati tanpa start, tandai overdue dan kirim escalation satu kali per version kepada admin; tidak auto-reassign tanpa memastikan collector sebelumnya berhenti. Cancel/fail menuntut reason dan membuka jalur penugasan ulang yang tercatat. Jangan mengarang default SLA eksternal; deadline operasional dipilih saat dispatch.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Dua admin assign bersamaan hanya satu expectedVersion menang; task satu owner.
  - [ ] Collector lama tidak dapat start/complete setelah reassignment; partnership revoked sebelum action ditolak.
  - [ ] Overdue alert idempotent, notifikasi actor dan user relevan saja, cancellation reason tercatat.
  - [ ] Web/mobile empty state mengatakan menunggu penugasan admin dan tidak menjanjikan self-assign.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(dispatch): version assignments and align collector workflow`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

