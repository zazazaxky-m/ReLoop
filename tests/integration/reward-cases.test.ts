import { describe, expect, it } from "vitest";
import { f, type ActorKey } from "../support/audit-fixture";

/**
 * Operator resolution of a reward reconciliation case (deferred review minor):
 * a SUPERADMIN closes an OPEN case with a written outcome. The ledger is never
 * touched; an ANOMALY_ALREADY_PAID_OUT case stops holding the user's
 * withdrawals once resolved.
 */

type Json = Record<string, any>;

async function call(actor: ActorKey, method: string, path: string, body?: unknown) {
  const response = await f.json(actor, method, path, body);
  return { status: response.status, body: (await response.json().catch(() => null)) as Json };
}

async function openDebitCase(amount: number) {
  return f.db.rewardReconciliationCase.create({ data: {
    businessKey: `review:manual-${amount}:decision:v1`, userId: f.ids.userA, depositItemId: null, amount,
    entryType: "ADJUST", reasonCode: "ANOMALY_ALREADY_PAID_OUT" } });
}

const resolve = (actor: ActorKey, id: string, body: unknown) =>
  call(actor, "POST", `/api/reward-cases/${id}/resolve`, body);
const NOTE = "Dana dikembalikan pengguna lewat transfer 17/10, bukti di tiket FIN-12";

describe("POST /api/reward-cases/[id]/resolve (real PostgreSQL)", () => {
  it("a superadmin closes an open debit case with a written outcome, lifting the withdrawal hold", async () => {
    await f.seedBalance(20_000);
    const open = await openDebitCase(5_000);
    const request = (key: string) => call("userA", "POST", "/api/redemptions", {
      amount: 20_000, payoutAccountId: f.ids.payoutAccountA, idempotencyKey: key });
    expect((await request("before")).status).toBe(422);

    const resolved = await resolve("superadmin", open.id, { note: NOTE });

    expect(resolved.status).toBe(200);
    expect(resolved.body.idempotent).toBe(false);
    expect(await f.db.rewardReconciliationCase.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({
      status: "RESOLVED", resolvedById: f.ids.superadmin, note: NOTE });
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA, entryType: "ADJUST" } })).toBe(0);
    const audit = await f.db.auditLog.findFirstOrThrow({ where: { action: "REWARD_CASE_RESOLVED", entityId: open.id } });
    expect(audit.metadataJson).toMatchObject({ reasonCode: "ANOMALY_ALREADY_PAID_OUT", amount: 5_000, hasNote: true });
    expect(JSON.stringify(audit.metadataJson)).not.toContain("FIN-12");
    expect((await request("after")).status).toBe(201);
  });

  it("the reconciliation report tells the operator whose money it is and what resolving releases", async () => {
    await f.seedBalance(20_000);
    const open = await openDebitCase(5_000);

    const report = await call("superadmin", "GET", "/api/reports/reconciliation");

    expect(report.status).toBe(200);
    const row = report.body.report.rewardCases.recent.find((c: Json) => c.id === open.id);
    expect(row).toMatchObject({
      ownerName: expect.any(String),
      itemStatus: null,
      withdrawableIfResolved: 5_000,
    });
  });

  it("a repeated resolution is idempotent and keeps the first outcome", async () => {
    const open = await openDebitCase(1_000);
    expect((await resolve("superadmin", open.id, { note: NOTE })).status).toBe(200);
    const again = await resolve("superadmin", open.id, { note: "Catatan lain yang berbeda sekali" });
    expect(again.status).toBe(200);
    expect(again.body.idempotent).toBe(true);
    expect((await f.db.rewardReconciliationCase.findUniqueOrThrow({ where: { id: open.id } })).note).toBe(NOTE);
  });

  it("only a superadmin may resolve, with a real note, an existing case", async () => {
    const open = await openDebitCase(2_000);
    for (const actor of ["userA", "adminA", "collectorA"] as const) {
      expect((await resolve(actor, open.id, { note: NOTE })).status, actor).toBe(403);
    }
    expect((await resolve("superadmin", open.id, { note: "pendek" })).status).toBe(422);
    expect((await resolve("superadmin", open.id, {})).status).toBe(422);
    expect((await resolve("superadmin", "missing-case", { note: NOTE })).status).toBe(404);
    expect((await f.db.rewardReconciliationCase.findUniqueOrThrow({ where: { id: open.id } })).status).toBe("OPEN");
  });
});
