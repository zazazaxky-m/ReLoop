# ReLoop Security and Privacy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menutup boundary autentikasi, ownership identitas, penghapusan parsial dan audit chain.

**Architecture:** Token dibedakan berdasarkan purpose; identitas privileged membutuhkan proof baru. Privasi dan audit menggunakan transaksi serta job durable dengan migrasi additive.

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

## Task A01: Pisahkan session dan MFA challenge

**Temuan:** SEC-01. **Dependensi:** tidak ada.

**Files:**
- Modify: `lib/auth.ts`, `lib/mfa.ts`, `lib/rbac.ts`, `proxy.ts`, `app/api/auth/login/route.ts`, `app/api/auth/mfa/verify/route.ts`, `app/api/auth/me/route.ts`, `app/api/internal/ws-session/route.ts`, `realtime/server.mjs` (fallback verifier).
- Test: `lib/auth.test.ts`, `lib/mfa.test.ts`, `tests/proxy.test.ts`, `tests/api/auth/mfa.test.ts`, `tests/api/internal/ws-session.test.ts`.

**Interfaces:**
Consumes: `SessionPayload`, user `tokenVersion` existing.
Produces: `signSession(payload: SessionPayload): Promise<string>` dan `verifySessionToken(token: string): Promise<SessionPayload | null>` dengan strict claims; `signMfaChallenge(userId: string, tokenVersion: number): Promise<string>`; `verifyMfaChallenge(token: string): Promise<{userId: string; tokenVersion: number; challengeId: string} | null>`.
Tambahkan helper single-use `consumeMfaChallenge(challengeId: string, expiresAt: number): Promise<boolean>` di `lib/mfa.ts`, memakai Redis rate-limit infrastructure yang tersedia. Consume hanya setelah TOTP dan tokenVersion lolos.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("rejects a valid MFA challenge as a session", async () => {
  const token = await signMfaChallenge("audit-user", 0);
  expect(await verifySessionToken(token)).toBeNull();
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npx vitest run lib/auth.test.ts lib/mfa.test.ts tests/proxy.test.ts tests/api/auth/mfa.test.ts tests/api/internal/ws-session.test.ts
```

Expected red: Verifier lama menerima challenge; sesudah signature baru ditambahkan, test harus gagal karena assertion behavior, bukan hanya import.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Session signer wajib `.setIssuer("reloop").setAudience("reloop-session")`; challenge audience `reloop-mfa`. Validasi claim setelah `jwtVerify` dengan Zod dan jangan default tokenVersion yang hilang. Sertakan iat/exp finite dan sub nonempty, role enum, string name/email, organizationId nullable.
```ts
const { payload } = await jwtVerify(token, getJwtSecret(), {
  algorithms: ["HS256"], issuer: "reloop", audience: "reloop-session",
});
if (payload.purpose !== "session") return null;
```
Gunakan schema identik di proxy dan internal websocket; fallback JWT websocket juga strict atau dihapus jika tidak bisa memenuhi pemeriksaan. Sebelum consume challenge, baca status/user tokenVersion aktual. Redis unavailable dalam production menolak penyelesaian challenge dengan 503, bukan melewati pemeriksaan. Session yang lama tidak diterima: dokumentasikan satu kali login ulang; jangan memasukkan compatibility path yang menghidupkan bypass.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Session valid diterima; purpose hilang/mfa, wrong audience/issuer/alg, versi hilang, claim rusak dan expired ditolak.
  - [ ] Login MFA akun tokenVersion=0: cookie challenge mendapat 401 di /me dan API admin; TOTP benar menghasilkan session.
  - [ ] Replay challenge setelah sukses ditolak; reset password/suspension di tengah challenge menolak tokenVersion lama.
  - [ ] Deployment web dan realtime serentak menolak legacy JWT, dan mobile menangani 401 lewat login ulang.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(auth): separate session and MFA token purposes`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task A02: Penggantian faktor MFA tanpa mematikan faktor aktif

**Temuan:** SEC-04. **Dependensi:** A01, F01.

**Files:**
- Modify: `prisma/schema.prisma`, `lib/mfa.ts`, `app/api/auth/mfa/setup/route.ts`, `app/api/auth/mfa/enable/route.ts`, `app/api/auth/mfa/disable/route.ts`, `components/security/MfaManager.tsx`.
- Create: `prisma/migrations/2026101301_mfa_pending_setup/migration.sql`, `tests/integration/mfa-replacement.test.ts`.
- Test: `tests/api/auth/mfa.test.ts`, `lib/mfa.test.ts`; update mobile MFA call sites discovered by `rg "/api/auth/mfa" mobile/lib`.

**Interfaces:**
Produces: pending MFA fields `pendingTotpSecret String?`, `pendingTotpExpiresAt DateTime?`, `pendingTotpTokenVersion Int?`; setup body `{currentPassword:string,currentCode?:string}`. Active replacement requires currentCode; first setup still requires password. Enable body `{code:string}` confirms pending setup; disable body `{currentPassword:string,code:string}`.
`beginMfaSetup(userId,email,proof): Promise<{secret:string;otpauthUrl:string}>`, with proof `{currentPassword:string;currentCode?:string}`. Existing secret never included in responses.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("does not disable an active factor when setup lacks fresh proof", async () => {
  const before = await f.db.user.findUniqueOrThrow({where:{id:f.ids.adminA}});
  const res = await f.json("adminA", "POST", "/api/auth/mfa/setup", {});
  expect(res.status).toBe(422);
  const after = await f.db.user.findUniqueOrThrow({where:{id:f.ids.adminA}});
  expect(after.totpSecret).toBe(before.totpSecret);
  expect(after.mfaEnabled).toBe(before.mfaEnabled);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/mfa-replacement.test.ts
```

Expected red: Setup lama menerima session saja dan mengganti secret aktif.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Di bawah User lock, verify password dan TOTP lama bila enabled, buat pending secret encrypted berlaku 10 menit. Jangan mengubah `mfaEnabled` atau `totpSecret` aktif. Saat enable, lock user, cek pending expiry/tokenVersion/kode dan atomik pindahkan pending ke aktif, kosongkan pending, naikkan tokenVersion dan terbitkan session baru untuk pemohon setelah commit. Disable juga menaikkan tokenVersion.
```ts
// Setelah proof dan pending code diverifikasi dalam transaction.
await tx.user.update({where:{id:userId},data:{
  totpSecret: user.pendingTotpSecret, mfaEnabled: true,
  pendingTotpSecret: null, pendingTotpExpiresAt: null,
  pendingTotpTokenVersion: null, tokenVersion: {increment:1},
}});
```
Rate-limit per user+IP pada setup/confirm/disable. UI membedakan setup awal dan penggantian; abort hanya membuang pending. Jangan menambah recovery bypass; kehilangan faktor menggunakan prosedur operator dengan identitas tervalidasi.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Secret pending kedaluwarsa ditolak; membatalkan setup menjaga faktor lama aktif.
  - [ ] Dua konfirmasi replacement paralel hanya satu berhasil; session lain dicabut; password change membatalkan pending.
  - [ ] Kode lama/baru tidak tercatat di audit/log; error salah password/TOTP tidak membuka secret.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(auth): require fresh proof for MFA replacement`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task A03: Verifikasi kepemilikan email dan claim undangan

**Temuan:** SEC-03. **Dependensi:** A01, F01.

**Files:**
- Modify: `prisma/schema.prisma`, `app/api/auth/register/route.ts`, `app/api/auth/me/route.ts`, `app/api/travel-agents/route.ts`, `lib/mailer.ts`, `components/travel-agent/TravelAgentManager.tsx`.
- Create: `lib/invitations.ts`, `app/api/travel-agent-invitations/accept/route.ts`, `app/api/auth/verify-email/route.ts`, `app/(auth)/accept-invitation/page.tsx`, `prisma/migrations/2026101302_verified_invitations/migration.sql`, `tests/integration/invitations.test.ts`.
- Modify guards: `app/api/trips/[id]/route.ts`, `app/api/trips/route.ts`, `app/api/trash-bags/route.ts`, mobile tourism endpoints using travelAgentUser.

**Interfaces:**
Produces: `User.emailVerifiedAt DateTime?`; invite `tokenHash String? @unique`, `expiresAt DateTime?`, `acceptedAt DateTime?`, `acceptedById String?`; membership `verifiedAt DateTime?`.
`acceptTravelAgentInvite(userId:string,token:string):Promise<{travelAgentId:string;organizationId:string}>`; accept POST body `{token:string}`. `verifyEmailToken(userId:string,token:string):Promise<void>` uses hashed purpose-specific EmailVerificationToken with userId, emailLookup snapshot, expiresAt, consumedAt.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("registration alone never claims a pending invitation", async () => {
  const invited = await f.pendingInvite("invited@example.test");
  const res = await f.json("guest", "POST", "/api/auth/register", {
    name:"Unverified",email:"invited@example.test",phone:"081234567890",
    password:"Audit-pass-12345!",
  });
  expect(res.status).toBe(201);
  expect(await f.db.travelAgentUser.count({where:{travelAgentId:invited.travelAgentId}})).toBe(0);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/invitations.test.ts
```

Expected red: Registrasi lama menautkan OWNER berdasarkan email.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Hapus auto-upsert membership dari register dan invitation creation. Token random 32 bytes, simpan SHA-256 saja, expiry 24 jam. Email dikirim setelah transaksi via durable delivery job; test transport menangkap email tanpa SMTP nyata. Claim memeriksa login, normalized email snapshot, expiry, belum used, agent/org aktif, lalu consume token + buat membership atomik. Token mailbox yang cocok dapat sekaligus menandai email verified.
```ts
const consumed = await tx.travelAgentInvite.updateMany({
  where:{id:invite.id,acceptedAt:null,expiresAt:{gt:new Date()}},
  data:{acceptedAt:new Date(),acceptedById:userId},
});
if (consumed.count !== 1) throw new HttpError(409,"Undangan sudah digunakan");
```
Perubahan email akun menghapus emailVerifiedAt dan verified membership eligibility sampai reverify. Backfill existing membership tidak boleh otomatis verified; keluarkan daftar dampak, beri UI verifikasi dan kirim ulang undangan saat rollout yang terotorisasi. Single-use acceptance endpoint tidak menerima email bebas dari body.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Pre-registration attacker tidak mendapat akses saat admin mengundang alamatnya.
  - [ ] Wrong user/email, expired/replayed token, concurrent accept dan suspended organization ditolak.
  - [ ] User tanpa membership verified tidak bisa membaca trip melalui web maupun API mobile.
  - [ ] Perubahan email di antara terbit dan accept token menolak claim; token tidak muncul dalam analytics/referrer/log.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(identity): verify mailbox before granting travel agent access`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task A04: Erasure yang konsisten dan dapat dilanjutkan

**Temuan:** SEC-05. **Dependensi:** A01, M01, F01.

**Files:**
- Modify: `lib/gdpr.ts`, `app/api/user/data/route.ts`, `app/api/account-deletion-requests/route.ts`, `prisma/schema.prisma`, `components/legal/AccountDeletionForm.tsx`, `mobile/lib/features/profile/profile_screen.dart`.
- Create: `lib/erasure-jobs.ts`, `scripts/process-erasure-jobs.ts`, `tests/integration/erasure.test.ts`, `prisma/migrations/2026101303_erasure_jobs/migration.sql`.
- Modify docs: `app/(legal)/privacy/page.tsx`, `app/(legal)/account-deletion/page.tsx`, `app/(legal)/data-deletion/page.tsx`.

**Interfaces:**
Produces: `requestErasure(userId:string):Promise<{requestId:string;status:"PROCESSING"|"PENDING_RECONCILIATION"}>`; `runErasureJob(requestId:string):Promise<void>`. Add PENDING_RECONCILIATION/RETRYABLE_FAILED to deletion status; durable cleanup job with unique requestId+step, attempts, nextAttemptAt, completedAt. DELETE /api/user/data returns202 plus job status; existing clients accept every 2xx and are updated to display pending vs completed.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("keeps real foreign keys after erasing a user with deposit history", async () => {
  await f.depositHistory();
  const response = await f.json("userA","DELETE","/api/user/data");
  expect(response.status).toBe(202);
  const body = await response.json();
  await runErasureJob(body.requestId);
  const session = await f.db.depositSession.findFirstOrThrow({where:{userId:f.ids.userA}});
  const user = await f.db.user.findUniqueOrThrow({where:{id:session.userId}});
  expect(user.status).toBe("INACTIVE");
  expect(user.passwordHash).toBeNull();
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/erasure.test.ts
```

Expected red: Jalur lama menulis FK [REDACTED] dan gagal; endpoint/job baru belum ada.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Jangan mengubah userId pada session/ledger/redemption. Pertahankan user pseudonymous dengan ID sama; di transaction User lock, redact name/email/phone memakai encryption extension, kosongkan auth secret/pending MFA/reset tokens/device tokens, increment tokenVersion, disable payout accounts lalu hapus PII akun setelah memastikan snapshot transaksi aman. Audit tidak boleh memuat email lama.
```ts
await tx.user.update({where:{id:userId},data:{
  name:"Pengguna dihapus",email:`erased-${userId}@invalid.reloop`,phone:null,
  passwordHash:null,totpSecret:null,mfaEnabled:false,status:"INACTIVE",
  tokenVersion:{increment:1},
}});
```
Sebelum anonymization, jika saldo tersedia/pending/reserved atau payout aktif ada, simpan PENDING_RECONCILIATION dan beri langkah penyelesaian saldo; jangan menghilangkan hak atas saldo atau mengunci login sebelum bisa diselesaikan. API publik hanya membuat permintaan, bukan mengeksekusi erasure tanpa verifikasi pemohon. External file cleanup dan PII di metadata yang relevan memakai job idempotent; COMPLETED hanya setelah seluruh langkah wajib selesai. Tulis matriks data yang dipertahankan dan alasan bisnis; lama retensi mengikuti kebijakan yang disetujui, tidak mengarang periode hukum.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] FK nyata PostgreSQL lulus untuk session, ledger, redemption dan trip.
  - [ ] Injected exception tengah transaction me-rollback seluruh perubahan; repeated job tidak menghapus data lain.
  - [ ] Pending payout menahan anonymization dengan status jelas; setelah settlement selesai job bisa diteruskan.
  - [ ] Pembersihan file gagal -> RETRYABLE_FAILED, identitas tetap tidak bocor, tidak menampilkan sukses palsu.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(privacy): make erasure atomic and resumable`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task A05: Canonical audit chain versi baru

**Temuan:** SEC-08. **Dependensi:** F01.

**Files:**
- Modify: `lib/audit.ts`, `prisma/schema.prisma`, `app/api/audit/verify/route.ts`, `components/security/AuditChainVerifier.tsx`.
- Create: `prisma/migrations/2026101304_audit_chain_v2/migration.sql`, `scripts/checkpoint-audit-chain.ts`, `tests/integration/audit-chain.test.ts`.
- Test: `tests/lib/audit.test.ts`, `tests/api/audit-verify.test.ts`.

**Interfaces:**
Produces: `canonicalAuditPayload(entry):string` dengan input `{createdAt:Date;actorId:string|null;action:string;entityType:string;entityId:string|null;metadataJson:unknown}`; `AuditLog.chainVersion Int @default(2)`, `chainSequence BigInt? @unique`; verifier menambah `{legacyStatus:"not-present"|"unverifiable"|"valid",checkedVersion:2}`. Existing rows di migration diberi version1 secara eksplisit sebelum default diubah.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("verifies a stored row even when insert is delayed and fields are null", async () => {
  await logAudit({action:"AUDIT_TEST",entityType:"Test",actorId:null,metadata:null});
  expect((await verifyAuditChain()).valid).toBe(true);
  const row = await f.db.auditLog.findFirstOrThrow({where:{action:"AUDIT_TEST"}});
  await f.db.auditLog.update({where:{id:row.id},data:{action:"ALTERED"}});
  expect((await verifyAuditChain()).valid).toBe(false);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/audit-chain.test.ts
```

Expected red: Writer dan verifier lama memakai timestamp/null serialization berbeda.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Gunakan satu canonicalizer write/read yang menormalisasi null dan recursive object keys; timestamp dibuat sekali dan ikut disimpan. Sequence dialokasikan di bawah advisory transaction lock yang sudah ada; urutan verifikasi chainSequence, bukan hanya timestamp.
```ts
const createdAt = new Date();
const row = {createdAt,actorId:input.actorId ?? null,action:input.action,
  entityType:input.entityType,entityId:input.entityId ?? null,
  metadataJson:redactAuditMetadata(input.metadata ?? undefined) ?? null};
const canonical = canonicalAuditPayload(row);
```
Archive v1 immutable, simpan count+digest snapshot dan chain boundary event pada v2. Status v1 yang checksum-nya tidak dapat divalidasi harus jujur unverifiable. Checkpoint script default dry-run dan memerlukan explicit apply dengan digest yang sudah ditinjau; tidak re-sign histori lama. Secret/version key tidak keluar ke report.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Optional fields omitted dan explicit null menghasilkan canonical yang sama.
  - [ ] Timestamp sama, nested metadata key order berbeda, delayed insert dan concurrent writers tetap membentuk satu chain.
  - [ ] Rollback insert tidak meninggalkan link phantom; perubahan payload/checksum/urutan terdeteksi.
  - [ ] API/UI menampilkan legacy unverifiable terpisah dari validitas chain baru.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(audit): persist canonical chain inputs and version history`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

