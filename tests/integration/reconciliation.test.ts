import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { LedgerStatus, RedemptionStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { getWalletBalance } from "@/lib/ledger";
import type { CurrentUser } from "@/lib/rbac";
import { getReconciliationReport } from "@/lib/reconciliation-report";
import type { AppRole } from "@/lib/roles";
import { transitionRedemption } from "@/lib/wallet-service";
import { f, type ActorKey } from "../support/audit-fixture";
import { reconciliationReportContractV1, reconciliationReportResponseV1 } from "../support/contracts";
import { deferred, isStillPending } from "../support/race-probe";

type Json = Record<string, any>;

async function patch(id: string, body: Record<string, unknown>) {
  const response = await f.json("superadmin", "PATCH", `/api/redemptions/${id}`, body);
  const json = (await response.json()) as Json;
  expect(response.status, JSON.stringify(json)).toBe(200);
  return json;
}

const settle = (id: string) => patch(id, { action: "success", providerReference: `PAID-${randomUUID().slice(0, 8)}` });

async function getJson(actor: ActorKey, url: string) {
  const response = await f.json(actor, "GET", url);
  return { status: response.status, body: (await response.json()) as Json };
}

/** The service's actor, as requireApiUser would build it (in-process calls). */
async function actorFor(id: string): Promise<CurrentUser> {
  const user = await f.db.user.findUniqueOrThrow({ where: { id } });
  return { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role as AppRole,
    organizationId: user.organizationId, organizationName: null, payoutEligible: user.payoutEligible, status: user.status };
}

/**
 * A payout request written straight into the test database, as legacy data or
 * a corrupted history would look: the reserve may be in any state or amount.
 */
async function legacyRequest(input: {
  userId?: string; status: RedemptionStatus; amount: number;
  reserve: { status: LedgerStatus; amount?: number } | null;
}) {
  const userId = input.userId ?? f.ids.userA;
  const redemption = await f.db.redemption.create({
    data: { userId, provider: "DANA", amount: input.amount, status: input.status, idempotencyKey: `m05-${randomUUID()}` },
  });
  if (input.reserve) {
    await f.db.rewardLedger.create({
      data: { userId, entryType: "REDEEM", amount: -(input.reserve.amount ?? input.amount), status: input.reserve.status,
        reasonCode: "REDEMPTION_RESERVE", referenceType: "Redemption", referenceId: redemption.id },
    });
  }
  return redemption.id;
}

async function ledgerRow(input: { userId?: string; entryType: "EARN" | "ADJUST"; status: LedgerStatus; amount: number }) {
  return f.db.rewardLedger.create({
    data: { userId: input.userId ?? f.ids.userA, entryType: input.entryType, amount: input.amount, status: input.status,
      reasonCode: "M05_TEST", referenceType: "AuditFixture", referenceId: `m05:${randomUUID()}` },
  });
}

const byRedemption = <T extends { redemptionId: string | null }>(rows: T[]) =>
  [...rows].sort((a, b) => String(a.redemptionId).localeCompare(String(b.redemptionId)));

describe("reconciliation report: net liabilities (M05, LOG-07)", () => {
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

  it("keeps totalOutstanding as a compatibility alias of the net spendable liability", async () => {
    const id = await f.processingRedemption(100_000);
    await settle(id);

    const report = await getReconciliationReport();
    // Before M05 this was the gross AVAILABLE earning (100.000) although all of it was paid out.
    expect(report.totalOutstanding).toBe(0);
    expect(report.totalOutstanding).toBe(report.availableLiability);
    // Gross issuance stays visible as information, never as liability.
    expect(report.totalEarnAvailable).toBe(100_000);
  });

  it("EARN 100k -> reserve 40k -> success 40k leaves 60k available, nothing reserved and 40k paid", async () => {
    await f.seedBalance(100_000);
    const id = await f.processingRedemption(40_000);

    const reserved = await getReconciliationReport();
    expect(reserved).toMatchObject({
      availableLiability: 60_000, pendingLiability: 0, reservedLiability: 40_000, paidTotal: 0,
      totalObligation: 100_000, hasDiscrepancy: false, redeemedDiscrepancy: 0, reservedDiscrepancy: 0,
    });

    await settle(id);
    const paid = await getReconciliationReport();
    expect(paid).toMatchObject({
      availableLiability: 60_000, pendingLiability: 0, reservedLiability: 0, paidTotal: 40_000,
      totalObligation: 60_000, hasDiscrepancy: false, redeemedDiscrepancy: 0, reservedDiscrepancy: 0,
      payoutMismatches: [], payoutMismatchCount: 0,
    });
    expect(paid.totalObligation).toBe(paid.availableLiability + paid.reservedLiability + paid.pendingLiability);
    // Same semantics as the wallet the user sees (lib/ledger.ts computeBalance).
    const wallet = await getWalletBalance(f.ids.userA);
    expect([wallet.available, wallet.reserved, wallet.redeemed]).toEqual([60_000, 0, 40_000]);
  });

  it("reports a pending adjustment as pending and never as spendable", async () => {
    await f.seedBalance(50_000);
    await ledgerRow({ entryType: "ADJUST", status: "PENDING", amount: 7_000 });
    await ledgerRow({ entryType: "EARN", status: "PENDING", amount: 3_000 });

    const pending = await getReconciliationReport();
    expect(pending).toMatchObject({ availableLiability: 50_000, pendingLiability: 10_000, totalObligation: 60_000 });

    // Only an AVAILABLE adjustment is spendable.
    await ledgerRow({ entryType: "ADJUST", status: "AVAILABLE", amount: 2_000 });
    const released = await getReconciliationReport();
    expect(released).toMatchObject({ availableLiability: 52_000, pendingLiability: 10_000, totalObligation: 62_000 });
    const wallet = await getWalletBalance(f.ids.userA);
    expect([wallet.available, wallet.pending]).toEqual([52_000, 10_000]);
  });

  it("restores the available liability when a reserve is reversed", async () => {
    await f.seedBalance(100_000);
    const id = await f.processingRedemption(40_000);
    expect(await getReconciliationReport()).toMatchObject({ availableLiability: 60_000, reservedLiability: 40_000 });

    await patch(id, { action: "fail", note: "Rekening tujuan ditolak bank" });
    const reversed = await getReconciliationReport();
    expect(reversed).toMatchObject({
      availableLiability: 100_000, reservedLiability: 0, paidTotal: 0, totalObligation: 100_000,
      hasDiscrepancy: false, payoutMismatches: [],
    });
  });

  it("reports an overdrawn legacy balance separately instead of netting it against other users", async () => {
    await f.seedBalance(10_000);
    // userB was paid 5.000 that its ledger never earned (a legacy duplicate payout).
    await legacyRequest({ userId: f.ids.userB, status: "SUCCESS", amount: 5_000, reserve: { status: "REDEEMED" } });

    const report = await getReconciliationReport();
    expect(report.availableLiability).toBe(10_000);
    expect(report.overdrawn).toEqual({ users: 1, availableShortfall: 5_000, pendingShortfall: 0 });
    expect(report.paidTotal).toBe(5_000);
    expect(report.hasDiscrepancy).toBe(false);
  });
});

describe("reconciliation report: explicit payout discrepancies", () => {
  it("does not report a +100/-100 pair of mismatched requests as healthy", async () => {
    await f.seedBalance(1_000);
    // Paid request whose reserve is still held, and an in-flight request whose reserve says paid.
    const paidButHeld = await legacyRequest({ status: "SUCCESS", amount: 100, reserve: { status: "PENDING" } });
    const heldButPaid = await legacyRequest({ status: "PROCESSING", amount: 100, reserve: { status: "REDEEMED" } });

    const report = await getReconciliationReport();
    // The totals cancel out: a net comparison would call this history healthy.
    expect(report.ledgerRedeemed - report.redemptionSuccessTotal).toBe(0);
    expect(report.ledgerReserved - report.redemptionInFlightTotal).toBe(0);

    expect(report.hasDiscrepancy).toBe(true);
    expect(report.redeemedDiscrepancy).toBe(200);
    expect(report.reservedDiscrepancy).toBe(200);
    expect(report.payoutMismatchCount).toBe(2);
    expect(byRedemption(report.payoutMismatches)).toEqual(byRedemption([
      { redemptionId: paidButHeld, userId: f.ids.userA, requestStatus: "SUCCESS", requestAmount: 100,
        reserveStatuses: ["PENDING"], ledgerIds: [expect.any(String)], paidDifference: -100, reservedDifference: 100,
        problem: "RESERVE_STATE_MISMATCH" },
      { redemptionId: heldButPaid, userId: f.ids.userA, requestStatus: "PROCESSING", requestAmount: 100,
        reserveStatuses: ["REDEEMED"], ledgerIds: [expect.any(String)], paidDifference: 100, reservedDifference: -100,
        problem: "RESERVE_STATE_MISMATCH" },
    ]));
  });

  it("does not net opposite amount mismatches within one status, and lists reserves that back no request", async () => {
    await f.seedBalance(1_000);
    const overpaid = await legacyRequest({ status: "SUCCESS", amount: 300, reserve: { status: "REDEEMED", amount: 400 } });
    const underpaid = await legacyRequest({ status: "SUCCESS", amount: 200, reserve: { status: "REDEEMED", amount: 100 } });
    const unreserved = await legacyRequest({ status: "APPROVED", amount: 50, reserve: null });
    const settledFailed = await legacyRequest({ status: "FAILED", amount: 70, reserve: { status: "REVERSED" } });
    const orphan = await f.db.rewardLedger.create({
      data: { userId: f.ids.userB, entryType: "REDEEM", amount: -5_000, status: "PENDING", reasonCode: "REDEMPTION_RESERVE",
        referenceType: "Redemption", referenceId: "missing-redemption" },
    });

    const report = await getReconciliationReport();
    expect(report.ledgerRedeemed - report.redemptionSuccessTotal).toBe(0);
    expect(report.redeemedDiscrepancy).toBe(200);
    expect(report.reservedDiscrepancy).toBe(5_050);
    expect(report.hasDiscrepancy).toBe(true);
    expect(report.payoutMismatches).toHaveLength(4);
    expect(report.payoutMismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ redemptionId: overpaid, requestStatus: "SUCCESS", paidDifference: 100, reservedDifference: 0,
        problem: "AMOUNT_MISMATCH" }),
      expect.objectContaining({ redemptionId: underpaid, requestStatus: "SUCCESS", paidDifference: -100, reservedDifference: 0,
        problem: "AMOUNT_MISMATCH" }),
      expect.objectContaining({ redemptionId: unreserved, requestStatus: "APPROVED", reserveStatuses: [], ledgerIds: [],
        paidDifference: 0, reservedDifference: -50, problem: "RESERVE_MISSING" }),
      { redemptionId: "missing-redemption", userId: f.ids.userB, requestStatus: null, requestAmount: null,
        reserveStatuses: ["PENDING"], ledgerIds: [orphan.id], paidDifference: 0, reservedDifference: 5_000,
        problem: "REQUEST_NOT_FOUND" },
    ]));
    // A settled request whose reserve was released has nothing to reconcile.
    expect(report.payoutMismatches.map((row) => row.redemptionId)).not.toContain(settledFailed);
  });
});

describe("reconciliation report: one snapshot", () => {
  it("is not fooled by a settlement that commits between its ledger and payout reads", async () => {
    await f.seedBalance(100_000);
    const id = await f.processingRedemption(40_000);
    let committedMidReport = false;

    const report = await getReconciliationReport({
      async afterLedgerRead() {
        // A parallel settlement runs to COMMIT on the Next server's own connection.
        await settle(id);
        const row = await f.db.redemption.findUniqueOrThrow({ where: { id } });
        committedMidReport = row.status === "SUCCESS";
      },
    });

    expect(committedMidReport).toBe(true);
    // Every figure describes the state before the settlement: still held, nothing paid, no false alarm.
    expect(report).toMatchObject({
      availableLiability: 60_000, reservedLiability: 40_000, paidTotal: 0,
      ledgerReserved: 40_000, redemptionInFlightTotal: 40_000, ledgerRedeemed: 0, redemptionSuccessTotal: 0,
      hasDiscrepancy: false, payoutMismatches: [],
    });
    expect(report.snapshot).toEqual({ readOnly: true, isolation: "repeatable read" });

    expect(await getReconciliationReport()).toMatchObject({
      availableLiability: 60_000, reservedLiability: 0, paidTotal: 40_000,
      ledgerRedeemed: 40_000, redemptionSuccessTotal: 40_000, hasDiscrepancy: false, payoutMismatches: [],
    });
  });

  it("neither waits for nor sees a payout transition that holds its locks", async () => {
    await f.seedBalance(100_000);
    const id = await f.processingRedemption(40_000);
    const locked = deferred();
    const release = deferred();

    const transition = transitionRedemption(await actorFor(f.ids.superadmin), id,
      { action: "success", providerReference: "PAID-LOCKED" },
      { afterLock: async () => { locked.resolve(); await release.promise; } });
    try {
      await locked.promise;
      const during = getReconciliationReport();
      expect(await isStillPending(during, 10_000)).toBe(false);
      expect(await during).toMatchObject({
        availableLiability: 60_000, reservedLiability: 40_000, paidTotal: 0, hasDiscrepancy: false });
    } finally {
      release.resolve();
    }
    await transition;
    expect(await getReconciliationReport()).toMatchObject({
      availableLiability: 60_000, reservedLiability: 0, paidTotal: 40_000, hasDiscrepancy: false });
  });
});

describe("reconciliation report: organizations before B01", () => {
  it("keeps organization allocations plus the legacy bucket equal to the global liability", async () => {
    await f.seedCredit({ organization: "A", amount: 30_000 });
    await f.seedCredit({ organization: "B", amount: 20_000 });
    await f.seedBalance(10_000);
    const id = await f.processingRedemption(40_000);

    const check = async (expected: { available: number; reserved: number; paid: number }) => {
      const report = await getReconciliationReport();
      expect(report).toMatchObject({
        availableLiability: expected.available, reservedLiability: expected.reserved, paidTotal: expected.paid,
        allocationStatus: "NOT_ALLOCATED_UNTIL_B01", unallocatedLegacyAmount: expected.available,
      });
      // No organization claims a net allocation it was never given.
      expect(report.organizations.every((org) => org.outstanding === 0 && org.allocationStatus === "UNALLOCATED_LEGACY"))
        .toBe(true);
      expect(report.organizations.reduce((sum, org) => sum + org.outstanding, 0) + report.unallocatedLegacyAmount)
        .toBe(report.availableLiability);
      // Gross issuance per organization stays visible as information.
      const gross = Object.fromEntries(report.organizations.map((org) => [org.organizationId ?? "none", org.earnAvailable]));
      expect(gross).toEqual({ [f.ids.orgA]: 30_000, [f.ids.orgB]: 20_000, none: 10_000 });
    };

    await check({ available: 20_000, reserved: 40_000, paid: 0 });
    await settle(id);
    await check({ available: 20_000, reserved: 0, paid: 40_000 });
  });

  it("keeps open M04 reward cases in the same report, outside the obligation figures", async () => {
    await f.seedBalance(10_000);
    await f.db.rewardReconciliationCase.create({
      data: { businessKey: `review:m05-${randomUUID()}:decision:v1`, userId: f.ids.userA, amount: 2_500,
        entryType: "REVERSE", reasonCode: "ANOMALY_ALREADY_PAID_OUT" },
    });
    const report = await getReconciliationReport();
    expect(report.rewardCases).toMatchObject({ open: 1, openAmount: 2_500 });
    expect(report.rewardCases.recent).toEqual([expect.objectContaining({ reasonCode: "ANOMALY_ALREADY_PAID_OUT", amount: 2_500 })]);
    expect(report.totalObligation).toBe(10_000);
  });
});

describe("reconciliation report over HTTP", () => {
  it("serves SUPERADMIN only, in the shape of the v1 contract fixture", async () => {
    await f.seedBalance(100_000);
    const id = await f.processingRedemption(40_000);
    await settle(id);

    const live = await getJson("superadmin", "/api/reports/reconciliation");
    expect(live.status).toBe(200);
    const parsed = reconciliationReportResponseV1.parse(live.body);
    expect(parsed.report).toMatchObject({ availableLiability: 60_000, paidTotal: 40_000, totalOutstanding: 60_000 });

    const contract = reconciliationReportContractV1.parse(JSON.parse(readFileSync(
      path.resolve(__dirname, "../fixtures/contracts/reconciliation-report.v1.json"), "utf8")));
    expect(Object.keys(live.body.report).sort()).toEqual(Object.keys(contract.response.report).sort());

    for (const actor of ["adminA", "userA", "collectorA"] as const) {
      expect((await getJson(actor, "/api/reports/reconciliation")).status).toBe(403);
    }
  });

  it("keeps the mobile overview additive: rewardAvailable is the net figure and the breakdown is new", async () => {
    await f.seedBalance(100_000);
    const id = await f.processingRedemption(40_000);
    await settle(id);

    const overview = await getJson("superadmin", "/api/mobile/overview");
    expect(overview.status).toBe(200);
    expect(overview.body.rewardAvailable).toBe(60_000);
    expect(overview.body.rewardLiability).toEqual({
      availableLiability: 60_000, pendingLiability: 0, reservedLiability: 0, paidTotal: 40_000, totalObligation: 60_000,
    });
    // Old fields stay.
    expect(overview.body).toMatchObject({ role: "SUPERADMIN", pendingRedemptions: 0 });
  });
});
