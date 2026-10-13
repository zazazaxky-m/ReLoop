# ReLoop RVM and Realtime Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mempertahankan keselamatan output, event durable, sesi eksklusif dan otorisasi realtime.

**Architecture:** Interlock lokal memutus aktivasi yang tidak aman; protokol ACK per event menjaga outbox. Lock dan partial index menegakkan sesi tunggal; websocket memakai capability dengan masa berlaku dan scope.

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

## Task R01: Interlock output dan safety latch mesin

**Temuan:** SEC-02. **Dependensi:** tidak ada.

**Files:**
- Modify: `rvm/controller.py`, `rvm/hardware.py`, `rvm/remote.py`, `rvm/states.py`.
- Create: `tests/test_rvm_safety.py`.
- Modify: `tests/test_rvm.py`, `tests/test_rvm_extra.py`, `docs/kiosk-setup-guide.md`, `rvm/README.md`.

**Interfaces:**
Produces `RvmController.actuation_block_reason(snapshot:SensorSnapshot)->str|None` dan `RvmController.try_open_input_gate(reason:str)->bool`. Semua pembukaan gate/conveyor/compactor melalui guard yang sesuai output, di bawah RLock controller; `all_stop` selalu dapat dijalankan tanpa menunggu operasi jaringan. `activate_lease` tetap bool dan tidak mengubah latch pada kegagalan.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```python
import hashlib, hmac, tempfile, time, unittest
from pathlib import Path
from rvm.config import RvmConfig
from rvm.controller import RvmController, MachineState

class SafetyTest(unittest.TestCase):
    def test_valid_lease_cannot_clear_open_service_panel(self):
        with tempfile.TemporaryDirectory() as tmp:
            controller = RvmController(RvmConfig(machine_code="TEST-001",
                machine_secret="test-secret",database_path=str(Path(tmp)/"rvm.db"),
                server_url="http://127.0.0.1:1",hardware_driver="mock"))
            try:
                controller.hardware.patch(service_panel_open=True)
                controller.enter_safe_state("SERVICE_PANEL_FORCED_OPEN", {})
                now = int(time.time())
                lease = {"id":"lease-test","sessionId":"session-test",
                         "issuedAt":now,"expiresAt":now+60}
                canonical = ".".join(str(lease[k]) for k in
                                     ("id","sessionId","issuedAt","expiresAt"))
                lease["signature"] = hmac.new(b"test-secret",canonical.encode(),hashlib.sha256).hexdigest()
                self.assertFalse(controller.activate_lease(lease))
                self.assertEqual(controller.state, MachineState.SAFE_STATE)
                self.assertFalse(controller.hardware.input_gate_open)
            finally:
                controller.db.close()
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
python3 -m unittest discover -s tests -p test_rvm_safety.py
```

Expected red: Dengan fixture signed lease, controller lama membuka gate. Snippet menggunakan field/method MockHardware existing; jangan mengganti interface hardware agar test lolos.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Guard memeriksa snapshot terbaru: service/collection door closed, temperature/vibration aman, camera requirement terpenuhi, state bukan SAFE_STATE/MAINTENANCE/FULL, dan latch tidak aktif. Check dan write output harus atomik terhadap sensor loop. Pemeriksaan pintu level-triggered di setiap tick, bukan hanya rising edge.
```python
with self._state_lock:
    snapshot = self.hardware.read()
    if self.actuation_block_reason(snapshot):
        self.hardware.all_stop()
        return False
    self.hardware.set_input_gate(True)
    return True
```
`activate_lease` hanya save ACTIVE lease/set SESSION_ACTIVE sesudah guard. Session-ended/lease renewal tidak mengubah SAFE_STATE menjadi IDLE dan tidak menghapus active safety alert. CLOSE/STOP tetap diperbolehkan; RESET_ALERT hanya clear jika semua kondisi aman dan aksi operator sah. Boot/crash state default outputs off.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Panel tetap terbuka pada beberapa tick; camera occluded/offline; collection door; full; maintenance; overtemperature.
  - [ ] Lease renew/new session/cancel/expiry pada SAFE_STATE tidak membuka output atau membersihkan latch.
  - [ ] Sensor membuka panel di antara permintaan gate dan output write; synchronized thread test membuktikan tidak lolos interlock.
  - [ ] STOP_ALL saat polling/jaringan gagal tetap efektif.
  - [ ] Hardware acceptance oleh teknisi: gate, conveyor, compactor di fixture aman; simpan evidence output dan reset behavior sebelum fleet rollout.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(rvm): enforce safety interlocks on every actuator path`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task R02: ACK event per item dan durable retry

**Temuan:** LOG-06. **Dependensi:** F01.

**Files:**
- Modify: `rvm/sync.py`, `rvm/database.py`, `app/api/machine-events/route.ts`, `lib/machine-events/ingest.ts`.
- Create: `tests/test_rvm_sync_contract.py`, `tests/contracts/machine-events.fixture.json`, `tests/api/machine-events-contract.test.ts`.
- Modify: `rvm/web/app.js`, `components/machine/MachineActivityPanel.tsx`, `rvm/README.md`.

**Interfaces:**
Produces response `{protocolVersion:2,received:number,results:Array<{localEventId:string;status:"accepted"|"duplicate"|"error";eventId?:string;error?:string;retryable?:boolean}>}`. Valid batch retains HTTP200. Add SQLite `delivery_status`; pertahankan `last_error` dan `next_attempt_at` yang sudah ada serta seluruh pending data saat upgrade.
`SyncWorker.apply_event_results(rows:list[dict],payload:dict)->bool` ACKs matching IDs only; `EdgeDatabase.mark_dead_letter(ids:list[int],reason:str)` retains records.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```python
import tempfile, unittest
from pathlib import Path
from rvm.config import RvmConfig
from rvm.database import EdgeDatabase
from rvm.sync import SyncWorker

class SyncContractTest(unittest.TestCase):
    def test_http_200_error_does_not_ack_event(self):
        with tempfile.TemporaryDirectory() as tmp:
            db = EdgeDatabase(str(Path(tmp)/"edge.db"))
            try:
                db.enqueue("HEARTBEAT", {"status":"ONLINE"}, "2026-10-13T00:00:00Z")
                row = db.pending(1)[0]
                worker = SyncWorker(RvmConfig(machine_secret="test-secret"),db)
                payload = {"protocolVersion":2,"received":1,"results":[{
                    "localEventId":row["localEventId"],"status":"error",
                    "error":"TEMPORARY_FAILURE","retryable":True}]}
                worker.apply_event_results([row],payload)
                self.assertEqual(db.queue_depth(),1)
            finally:
                db.close()
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
python3 -m unittest discover -s tests -p test_rvm_sync_contract.py
npx vitest run tests/api/machine-events-contract.test.ts
```

Expected red: Worker lama menandai semua event sent pada setiap 2xx.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Parse JSON, periksa protocolVersion/results structure, reject duplicate ACK IDs/foreign IDs. Hanya accepted/duplicate yang matched ACK; error transient tetap pending dengan backoff exponential capped60s+jitter; error permanent masuk dead-letter yang dapat dilihat operator dan tidak dihapus. Error tanpa retryable diperlakukan transient pada fase compatibility. Missing/malformed item tetap pending; flush success hanya jika seluruh batch durable ACK.
```python
acked = {r["localEventId"] for r in results
         if r.get("status") in {"accepted", "duplicate"}}
ids = [r["db_id"] for r in rows if r["localEventId"] in acked]
self.db.mark_sent(ids)
```
Backend bedakan schema/permanent rejection dari database availability/transient; error detail tidak membuka stack/secret. Duplikasi concurrent event yang gagal unique insert harus dibaca ulang dan dikembalikan duplicate jika commit event terdahulu sudah lengkap. Server tidak menandai accepted sebelum event+reward transaction commit. Deploy backend response additive dahulu, kemudian worker; worker baru boleh menolak legacy response tanpa menghapus antrean. Database outbox backup sebelum migration dan retry memakai localEventId yang sama.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Batch accepted+duplicate+error: hanya dua ACK hilang dari pending.
  - [ ] Response hilang setelah commit ->retry menjadi duplicate tanpa tambahan reward; broken JSON/unknown IDs tidak menghapus data.
  - [ ] Restart saat retry/dead-letter mempertahankan event dan attempts; queue tidak stuck karena satu poison event.
  - [ ] Fixture JSON yang sama dipakai test Python dan TS untuk mendeteksi perubahan kontrak.
  - [ ] Operator dapat melihat pending/dead-letter/last-success dan retry terotorisasi tanpa mengubah payload historis.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(sync): acknowledge only durably accepted machine events`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task R03: Replay window dan sesi mesin eksklusif

**Temuan:** SEC-09, EX-04. **Dependensi:** F01, M01.

**Files:**
- Modify: `lib/machine-auth.ts`, `lib/machine-nonce.ts`, `app/api/scan/route.ts`, `app/api/machine-session/[code]/route.ts`, `app/api/sessions/[id]/route.ts`, `prisma/schema.prisma`.
- Create: `lib/machine-auth-constants.ts`, `lib/deposit-session-service.ts`, `prisma/migrations/2026101307_one_active_machine_session/migration.sql`, `scripts/reconcile-active-sessions.ts`, `tests/integration/machine-session-race.test.ts`.
- Test: `lib/machine-auth.test.ts`, `tests/lib/machine-nonce.test.ts`, `tests/api/scan.test.ts`.

**Interfaces:**
Produces shared constants `MACHINE_SIG_MAX_SKEW_SECONDS=300`, `MACHINE_NONCE_TTL_MS=660000`.
`startOrResumeDeposit(actor:CurrentUser,input:{machineCode:string;token:string;campaignId?:string}):Promise<{session:DepositSession;resumed:boolean}>` uses User->Machine lock, rereads state/token/campaign before create. `getActiveDepositForUser(userId:string,machineCode?:string)` returns owned active session summary, no new lease.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("only one user gets a session on one machine",async()=>{
  const body={machineCode:f.ids.machineCode,token:await f.machineQrToken()};
  const responses=await Promise.all([
    f.json("userA","POST","/api/scan",body),
    f.json("userB","POST","/api/scan",body),
  ]);
  expect(responses.map(r=>r.status).sort()).toEqual([201,409]);
  expect(await f.db.depositSession.count({where:{machineId:f.ids.machineA,
    status:{in:["RESERVED","ACTIVE","PROCESSING_ITEM","REVIEW"]}}})).toBe(1);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:integration -- tests/integration/machine-session-race.test.ts
npx vitest run lib/machine-auth.test.ts tests/lib/machine-nonce.test.ts
```

Expected red: Check-then-create saat ini tidak eksklusif; nonce TTL juga habis pada360s meski signature bisa valid600s.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Gunakan TTL 2*skew+60 dari konstanta tunggal, Redis tetap fail-closed production. Dalam transaksi scan lock User lalu Machine; same owner resume, other owner409. Old expired active sessions hanya dapat ditutup menurut timeout policy sesudah memeriksa pending item/edge lease, bukan menimpa sesi.
```sql
CREATE UNIQUE INDEX "DepositSession_one_active_per_machine"
ON "DepositSession" ("machineId")
WHERE "status" IN ('RESERVED','ACTIVE','PROCESSING_ITEM','REVIEW');
```
Dry-run daftar duplicate active sessions dan bukti event/owner sebelum migration index. Konflik existing tidak diselesaikan dengan memilih sesi terbaru secara sembarang; operator reconcile, lease dihentikan, affected item masuk review. Error unique race ->409/resume yang tepat. Nonce rollout TTL naik aman terhadap signed requests yang ada; tidak memerlukan secret rotation. Pertimbangan signature method/path binding dicatat sebagai upgrade protokol terpisah, tidak diam-diam memutus client lama.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Signature timestamp +300 ditolak pada replay t+361 sampai signature expired; batas ±300 diuji dengan fake clock.
  - [ ] Redis down production ->fail-closed; nonce fresh accepted once di dua server.
  - [ ] Dua request user sama resume satu sesi; user lain tidak memperoleh detail pemilik.
  - [ ] Late acceptance event dari sesi sebelumnya tetap milik sesi/item yang benar; server lease tidak memilih newest ambigu.
  - [ ] Timeout/finish/cancel tidak melepaskan sesi saat item masih pada state yang tidak aman tanpa mekanisme close yang jelas.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(machine): retain replay protection and enforce exclusive sessions`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

## Task R04: Otorisasi websocket selama koneksi hidup

**Temuan:** SEC-10. **Dependensi:** A01, F01.

**Files:**
- Modify: `realtime/server.mjs`, `app/api/internal/ws-session/route.ts`, `lib/realtime.ts`, `lib/machine-events/fraud.ts`, `app/api/machine-events/route.ts` dan seluruh caller publishRealtime.
- Create: `tests/realtime/session-scope.test.ts`; Test `tests/api/internal/ws-session.test.ts`, `tests/lib/realtime.test.ts`.

**Interfaces:**
Produces internal verifier `{userId:string;role:AppRole;organizationId:string|null;tokenVersion:number;expiresAt:number}|null` and realtime event `organizationId?:string` required for restricted topic.
Gateway socket metadata stores identity/expiry and `lastValidatedAt`; revalidates every30s and before restricted broadcast if stale. Close at exact expiry; revocation propagation bound <=30s. Publish with missing org for security-alert is rejected, never treated global.

- [ ] **1. Tambahkan regression test berikut pada file Test yang disebut.**

```ts
it("drops restricted delivery after expiry and across organizations",async()=>{
  const gateway=await f.gateway();
  const a=await gateway.connect("adminA",{ttlSeconds:1});
  const b=await gateway.connect("adminB");
  await gateway.advanceClock(2_000);
  await gateway.publish({topic:"security-alert",organizationId:f.ids.orgA,
    machineCode:f.ids.machineCode,eventType:"FRAUD"});
  expect(await a.receivedCount()).toBe(0);
  expect(await b.receivedCount()).toBe(0);
});
```

- [ ] **2. Jalankan test tersebut sebelum perbaikan dan catat kegagalannya.**

```bash
npm run test:realtime -- tests/realtime/session-scope.test.ts
```

Expected red: Gateway lama menyimpan role saja dan tetap broadcast sesudah token expired.

- [ ] **3. Implementasikan perubahan dengan kontrak berikut.**

Reuse internal live DB guard; raw token disimpan hanya in-memory bila dibutuhkan revalidation dan tidak dicatat. Timer expire menutup socket; revalidation error sementara memblokir restricted delivery sampai identitas valid lagi. Role downgrade/tokenVersion/status/org change memperbarui capability atau close.
```js
if (restricted && (Date.now() >= meta.expiresAt * 1000 ||
    (meta.role !== "SUPERADMIN" && meta.organizationId !== data.organizationId))) continue;
```
Publisher backend mengisi organizationId dari DB trusted; client tidak memilih org yang memberi hak. Public topics whitelist hanya state mesin nonprivate; jangan memasukkan PII/refund/owner payload ke broadcast anonim. UI reconnect normal setelah login baru.

- [ ] **4. Lengkapi cases berikut, lalu jalankan ulang perintah test di langkah 2 sampai lulus.**

  - [ ] Expiry, suspended account, tokenVersion changed dan role downgrade menghentikan restricted event dalam bound30s.
  - [ ] AdminA tidak menerima alert orgB; SUPERADMIN menerima semua; guest hanya public-safe schema.
  - [ ] Internal verifier unavailable ->restricted withheld; anonymous connection tidak dipromosikan oleh event client.
  - [ ] Shutdown gateway membersihkan timers; reconnect tidak mewarisi metadata socket lama.

- [ ] **5. Review diff, jalankan typecheck/lint atau analyzer yang relevan, perbarui dokumen kontrak terkait, lalu commit.**

Pesan commit: `fix(realtime): enforce expiry revocation and organization scope`. Expected deliverable: perilaku task dan seluruh cases di atas lulus; migration/backfill dicatat jika ada. Jangan menandai finding RELEASED sebelum gate Z01.

---

