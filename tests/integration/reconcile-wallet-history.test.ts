import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { createEarnEntry } from "@/lib/ledger";
import { collectWalletInventory } from "@/scripts/reconcile-wallet-history";
import { f } from "../support/audit-fixture";

const ROOT = path.resolve(__dirname, "../..");
const ENFORCE_SQL = readFileSync(
  path.join(ROOT, "prisma/migrations/20261013122400_wallet_keys_enforce/migration.sql"), "utf8");
const ENFORCE_GUARD = ENFORCE_SQL.match(/DO \$\$[\s\S]*?END \$\$;/)![0];
const TRIP_ENFORCE_SQL = readFileSync(
  path.join(ROOT, "prisma/migrations/20261013151919_trip_reward_keys_enforce/migration.sql"), "utf8");
const TRIP_ENFORCE_GUARD = TRIP_ENFORCE_SQL.match(/DO \$\$[\s\S]*?END \$\$;/)![0];
const ENFORCE_INDEXES = [
  "RewardLedger_one_earn_per_deposit_item", "RewardLedger_one_earn_per_trip", "RewardLedger_one_reserve_per_redemption"];

class Rollback extends Error {}

async function readOnlyInventory() {
  return f.db.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return collectWalletInventory(tx);
  }, { isolationLevel: "RepeatableRead" });
}

async function depositItem(tx: Prisma.TransactionClient) {
  const wasteType = await tx.wasteType.findFirstOrThrow();
  const session = await tx.depositSession.create({
    data: { userId: f.ids.userA, machineId: f.ids.machineA, status: "COMPLETED", completedAt: new Date() },
  });
  return tx.depositItem.create({ data: { sessionId: session.id, wasteTypeId: wasteType.id, status: "ACCEPTED" } });
}

function earn(depositItemId: string, status: "AVAILABLE" | "REVERSED" = "AVAILABLE") {
  return { userId: f.ids.userA, depositItemId, entryType: "EARN" as const, amount: 2_000, status,
    reasonCode: "ITEM_ACCEPTED", referenceType: "DepositItem", referenceId: depositItemId };
}

function reserve(userId: string, redemptionId: string, amount: number, status: "PENDING" | "REJECTED" = "PENDING") {
  return { userId, entryType: "REDEEM" as const, amount: -amount, status,
    reasonCode: "REDEMPTION_RESERVE", referenceType: "Redemption", referenceId: redemptionId };
}

function tripEarn(tripId: string, campaignId: string, status: "AVAILABLE" | "REVERSED" = "AVAILABLE") {
  return { userId: f.ids.userA, entryType: "EARN" as const, amount: 2_000, status, campaignId,
    reasonCode: "TRASH_BAG_RETURN", referenceType: "Trip", referenceId: tripId };
}

/**
 * A non-return EARN that also references a trip (prisma/seed.ts writes these
 * for travel-agent users). Credited to a user no balance assertion looks at.
 */
function tripBonus(tripId: string, campaignId: string) {
  return { ...tripEarn(tripId, campaignId), userId: f.ids.collectorB, amount: 7_800, reasonCode: "TOURISM_COMPLIANCE_BONUS" };
}

function runCli() {
  const result = spawnSync(path.join(ROOT, "node_modules/.bin/tsx"), ["scripts/reconcile-wallet-history.ts"], {
    cwd: ROOT, env: process.env, encoding: "utf8", timeout: 60_000,
  });
  return { status: result.status, report: result.stdout ? JSON.parse(result.stdout) : null, stderr: result.stderr };
}

describe("scripts/reconcile-wallet-history.ts (read-only inventory)", () => {
  it("reports a healthy history as clean from a read-only snapshot", async () => {
    await f.seedBalance(30_000);
    await f.redeemAndSettle(10_000);
    await f.processingRedemption(15_000);

    const inventory = await readOnlyInventory();
    expect(inventory.snapshot).toEqual({ readOnly: true, isolation: "repeatable read" });
    expect(inventory.clean).toBe(true);
    expect(Object.values(inventory.summary).every((count) => count === 0)).toBe(true);

    // Expected database errors go through an independent client (no error logging).
    const db = await f.connection();
    await expect(db.$transaction(async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await collectWalletInventory(tx);
      await tx.$executeRaw`UPDATE "RewardLedger" SET status = status`;
    }, { isolationLevel: "RepeatableRead" })).rejects.toThrow(/25006|read-only/);
  });

  it("inventories duplicates, orphan reserves and negative balances, and the enforce guard refuses them", async () => {
    const ledgerBefore = await f.db.rewardLedger.count();
    let inventory: Awaited<ReturnType<typeof collectWalletInventory>> | undefined;
    let guardError: unknown;
    let tripGuardError: unknown;
    const ids: Record<string, string> = {};

    const db = await f.connection();
    await expect(db.$transaction(async (tx) => {
      // Simulate a legacy database from before the enforce migration (rolled back below).
      for (const index of ENFORCE_INDEXES) await tx.$executeRawUnsafe(`DROP INDEX "${index}"`);

      await tx.rewardLedger.create({ data: { userId: f.ids.userA, entryType: "EARN", amount: 40_000, status: "AVAILABLE",
        reasonCode: "AUDIT_FIXTURE", referenceType: "AuditFixture", referenceId: `audit-fixture:${randomUUID()}` } });
      const item = await depositItem(tx);
      ids.item = item.id;
      await tx.rewardLedger.create({ data: earn(item.id) });
      await tx.rewardLedger.create({ data: earn(item.id) });
      await tx.rewardLedger.create({ data: earn(item.id, "REVERSED") }); // already neutralized: not counted

      const redemption = await tx.redemption.create({ data: {
        userId: f.ids.userA, amount: 10_000, provider: "DANA", payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `dup-${randomUUID()}` } });
      ids.redemption = redemption.id;
      await tx.rewardLedger.create({ data: reserve(f.ids.userA, redemption.id, 10_000) });
      await tx.rewardLedger.create({ data: reserve(f.ids.userA, redemption.id, 10_000) });

      const unreserved = await tx.redemption.create({ data: {
        userId: f.ids.userA, amount: 12_000, provider: "DANA", payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `nores-${randomUUID()}` } });
      ids.unreserved = unreserved.id;
      const mismatched = await tx.redemption.create({ data: {
        userId: f.ids.userA, amount: 11_000, provider: "DANA", payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `mis-${randomUUID()}` } });
      ids.mismatched = mismatched.id;
      await tx.rewardLedger.create({ data: reserve(f.ids.userA, mismatched.id, 9_000) });

      await tx.rewardLedger.create({ data: reserve(f.ids.userB, "missing-redemption", 5_000) });

      const campaign = await tx.campaign.findFirstOrThrow({ where: { campaignType: "TRASH_BAG", organizationId: f.ids.orgA } });
      const trip = await tx.trip.create({ data: { campaignId: campaign.id, userId: f.ids.userA, status: "COMPLETED" } });
      ids.trip = trip.id;
      for (let i = 0; i < 2; i += 1) await tx.rewardLedger.create({ data: tripEarn(trip.id, campaign.id) });
      await tx.rewardLedger.create({ data: tripEarn(trip.id, campaign.id, "REVERSED") }); // neutralized: not counted
      await tx.rewardLedger.create({ data: tripBonus(trip.id, campaign.id) }); // not a return earning: not counted

      // Earliest code paid once per CHECK_OUT validation (referenceType ManualValidation).
      const legacyTrip = await tx.trip.create({ data: { campaignId: campaign.id, userId: f.ids.userA, status: "COMPLETED" } });
      ids.legacyTrip = legacyTrip.id;
      for (let i = 0; i < 2; i += 1) {
        const validation = await tx.manualValidation.create({ data: { tripId: legacyTrip.id, validationStage: "CHECK_OUT" } });
        await tx.rewardLedger.create({ data: { ...tripEarn(legacyTrip.id, campaign.id),
          referenceType: "ManualValidation", referenceId: validation.id } });
      }

      // A legacy bag row counting for several units (one QR is not automatically N units).
      const bagTrip = await tx.trip.create({ data: { campaignId: campaign.id, userId: f.ids.userA, status: "ACTIVE" } });
      ids.bagTrip = bagTrip.id;
      const multi = await tx.trashBagAssignment.create({ data: { tripId: bagTrip.id, bagQrCode: `LEGACY-${randomUUID()}`, bagCount: 3 } });
      ids.multiBag = multi.id;
      await tx.trashBagAssignment.create({ data: { tripId: bagTrip.id, bagQrCode: `LEGACY-${randomUUID()}`, bagCount: 1 } });
      // tripReturnEarnings uses the duplicateTripEarn predicate: live, return reason, either reference.
      await tx.rewardLedger.create({ data: tripEarn(bagTrip.id, campaign.id, "REVERSED") });
      await tx.rewardLedger.create({ data: tripBonus(bagTrip.id, campaign.id) });
      const bagTripCheckout = await tx.manualValidation.create({ data: { tripId: bagTrip.id, validationStage: "CHECK_OUT" } });
      await tx.rewardLedger.create({ data: { ...tripEarn(bagTrip.id, campaign.id),
        referenceType: "ManualValidation", referenceId: bagTripCheckout.id } });

      // EX-02 victims: ACTIVE reward trips whose bags are all reviewed, never closed or paid.
      const reviewedTrip = async (input: { campaignId: string; userId: string | null; statuses: Array<"GOOD" | "POOR" | null> }) => {
        const created = await tx.trip.create({ data: { campaignId: input.campaignId, userId: input.userId, status: "ACTIVE" } });
        for (const status of input.statuses) {
          await tx.trashBagAssignment.create({ data: { tripId: created.id, bagQrCode: `LEGACY-${randomUUID()}`, status } });
        }
        return created.id;
      };
      ids.stuckTrip = await reviewedTrip({ campaignId: campaign.id, userId: f.ids.userA, statuses: ["GOOD", "POOR"] });
      ids.bonusOnlyTrip = await reviewedTrip({ campaignId: campaign.id, userId: f.ids.userA, statuses: ["GOOD"] });
      await tx.rewardLedger.create({ data: tripBonus(ids.bonusOnlyTrip, campaign.id) });
      const paidTrip = await reviewedTrip({ campaignId: campaign.id, userId: f.ids.userA, statuses: ["GOOD"] });
      await tx.rewardLedger.create({ data: tripEarn(paidTrip, campaign.id) });
      await reviewedTrip({ campaignId: campaign.id, userId: f.ids.userA, statuses: ["GOOD", null] }); // not fully reviewed
      await reviewedTrip({ campaignId: campaign.id, userId: null, statuses: ["GOOD"] }); // no recipient
      const complianceOnly = await tx.campaign.create({ data: { organizationId: f.ids.orgA, name: "Program Kepatuhan Audit",
        campaignType: "TRASH_BAG", rewardMode: "COMPLIANCE_ONLY", status: "ACTIVE" } });
      await reviewedTrip({ campaignId: complianceOnly.id, userId: f.ids.userA, statuses: ["GOOD"] });

      inventory = await collectWalletInventory(tx);
      // A raised guard aborts the transaction: run the trip guard inside a savepoint.
      await tx.$executeRawUnsafe("SAVEPOINT trip_guard");
      tripGuardError = await tx.$executeRawUnsafe(TRIP_ENFORCE_GUARD).then(() => null, (error: unknown) => error);
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT trip_guard");
      guardError = await tx.$executeRawUnsafe(ENFORCE_GUARD).then(() => null, (error: unknown) => error);
      throw new Rollback();
    }, { timeout: 30_000 })).rejects.toBeInstanceOf(Rollback);

    expect(inventory!.duplicateEarnPerDepositItem).toEqual([
      expect.objectContaining({ key: ids.item, rows: 2, amount: 4_000, userIds: [f.ids.userA] }),
    ]);
    expect(inventory!.duplicateEarnPerDepositItem[0].ledgerIds).toHaveLength(2);
    expect(inventory!.duplicateReservePerRedemption).toEqual([
      expect.objectContaining({ key: ids.redemption, rows: 2, amount: -20_000 }),
    ]);
    expect(inventory!.duplicateTripEarn.map((group) => [group.key, group.rows, group.amount, group.ledgerIds.length]).sort())
      .toEqual([[ids.legacyTrip, 2, 4_000, 2], [ids.trip, 2, 4_000, 2]].sort());
    expect(inventory!.legacyBagUnits).toEqual([{
      tripId: ids.bagTrip, tripStatus: "ACTIVE", bagIds: [ids.multiBag], bagRows: 1, bagCountTotal: 3, tripReturnEarnings: 1 }]);
    const byTrip = <T extends { tripId: string }>(rows: T[]) => [...rows].sort((a, b) => a.tripId.localeCompare(b.tripId));
    expect(byTrip(inventory!.unclosedReviewedTrips)).toEqual(byTrip([
      // app 30 + all returned 40 + POOR 0 = 70: 1 rewardable x 2.000 x 70%; without the app 40%.
      { tripId: ids.stuckTrip, userId: f.ids.userA, campaignId: expect.any(String), bagRows: 2, returnedCount: 2,
        rewardableCount: 1, conditionStatus: "POOR", recomputedRewardAmount: { appCompleted: 1_400, appNotCompleted: 800 } },
      // A bonus row referencing the trip is not its return earning.
      { tripId: ids.bonusOnlyTrip, userId: f.ids.userA, campaignId: expect.any(String), bagRows: 1, returnedCount: 1,
        rewardableCount: 1, conditionStatus: "GOOD", recomputedRewardAmount: { appCompleted: 2_000, appNotCompleted: 1_400 } },
    ]));
    expect(inventory!.summary.unclosedReviewedTrips).toBe(2);
    expect(inventory!.reservesWithoutRequest.map((r) => [r.referenceId, r.problem, r.userId]).sort()).toEqual([
      [ids.mismatched, "AMOUNT_MISMATCH", f.ids.userA],
      ["missing-redemption", "REQUEST_NOT_FOUND", f.ids.userB],
    ]);
    expect(inventory!.requestsWithoutMatchingReserve).toEqual([
      expect.objectContaining({ redemptionId: ids.unreserved, problem: "RESERVE_MISSING", reserveStatuses: [] }),
    ]);
    expect(inventory!.negativeBalances).toEqual([
      expect.objectContaining({ userId: f.ids.userB, available: -5_000, reserved: 5_000 }),
    ]);
    expect(inventory!.summary.blocksEnforcement).toBe(4);
    expect(inventory!.summary.legacyBagUnits).toBe(1);
    expect(inventory!.clean).toBe(false);

    expect(String((guardError as Error)?.message)).toMatch(
      /wallet_keys_enforce aborted: 1 deposit item\(s\) with more than one EARN row, 1 redemption\(s\) with more than one reserve row/);
    expect(String((guardError as Error).message)).toContain("scripts/reconcile-wallet-history.ts");
    expect(String((tripGuardError as Error)?.message)).toMatch(
      /trip_reward_keys_enforce aborted: 2 trip\(s\) with more than one trip return earning\. Nothing was changed\./);
    expect(String((tripGuardError as Error).message)).toContain("scripts/reconcile-wallet-history.ts");

    // Nothing was deleted, deduplicated or left behind; the enforce indexes are intact.
    expect(await f.db.rewardLedger.count()).toBe(ledgerBefore);
    const indexes = await f.db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'RewardLedger' AND indexname LIKE 'RewardLedger_one_%' ORDER BY indexname`;
    expect(indexes.map((row) => row.indexname)).toEqual(ENFORCE_INDEXES);
  });

  it("lists REJECTED deposit items that still carry money (M04 fix round 2, A4)", async () => {
    const [flipped, forged, settled, corrected] = await f.db.$transaction(async (tx) =>
      [await depositItem(tx), await depositItem(tx), await depositItem(tx), await depositItem(tx)]);
    // Pre-M04 ungated ITEM_REJECTED flipped an ACCEPTED item while its EARN stayed AVAILABLE.
    const flippedEarn = await f.db.rewardLedger.create({ data: earn(flipped.id) });
    // A machine-forged "REVIEW_REJECTED" (before the C1 namespace) stranded a PENDING hold.
    const forgedHold = await f.db.rewardLedger.create({ data: { ...earn(forged.id), status: "PENDING", amount: 1_000 } });
    // Settled correctly: the hold was rejected, or the earning was reversed (net 0).
    await f.db.rewardLedger.create({ data: { ...earn(settled.id), status: "REJECTED" } });
    await f.db.rewardLedger.create({ data: earn(corrected.id) });
    await f.db.rewardLedger.create({ data: { ...earn(corrected.id), entryType: "REVERSE", amount: -2_000 } });
    await f.db.rewardReconciliationCase.create({ data: {
      businessKey: `fraud:${flipped.id}:hold:v1`, userId: f.ids.userA, depositItemId: flipped.id, amount: 2_000,
      entryType: "EARN", reasonCode: "ANOMALY_ALREADY_PAID_OUT" } });
    for (const [item, validationReasonCode] of [
      [flipped, "ACTUATION_BLOCKED"], [forged, "REVIEW_REJECTED"], [settled, "REVIEW_REJECTED"], [corrected, "REVIEW_REJECTED"],
    ] as const) {
      await f.db.depositItem.update({ where: { id: item.id }, data: { status: "REJECTED", validationReasonCode } });
    }

    const inventory = await readOnlyInventory();
    expect(inventory.rejectedItemsWithMoney).toEqual([
      { depositItemId: flipped.id, userId: f.ids.userA, validationReasonCode: "ACTUATION_BLOCKED", netAvailable: 2_000,
        pending: 0, ledgerIds: [flippedEarn.id], reconciliationCaseKeys: [`fraud:${flipped.id}:hold:v1`] },
      { depositItemId: forged.id, userId: f.ids.userA, validationReasonCode: "REVIEW_REJECTED", netAvailable: 0,
        pending: 1_000, ledgerIds: [forgedHold.id], reconciliationCaseKeys: [] },
    ].sort((a, b) => (a.depositItemId < b.depositItemId ? -1 : 1)));
    expect(inventory.summary).toMatchObject({ rejectedItemsWithMoney: 2, blocksEnforcement: 0 });
    expect(inventory.clean).toBe(false);
    expect(inventory.snapshot.readOnly).toBe(true);
  });

  it("inventories review and accepted items outside the acceptance contract, and recorded-rate drift (M04 fix round 4)", async () => {
    const wasteType = await f.db.wasteType.findFirstOrThrow();
    const DAY = 86_400_000;
    const acceptedAt = new Date(Date.now() - DAY);
    const session = async (status: "ACTIVE" | "COMPLETED") => f.db.depositSession.create({
      data: { userId: f.ids.userA, machineId: f.ids.machineA, status, completedAt: status === "ACTIVE" ? null : new Date() } });
    const item = async (sessionId: string, data: Partial<Prisma.DepositItemUncheckedCreateInput>) => f.db.depositItem.create({
      data: { sessionId, wasteTypeId: wasteType.id, status: "REVIEW", measuredWeightGrams: 25, ...data } });
    const rate = (data: Partial<Prisma.RewardRateUncheckedCreateInput>) => f.db.rewardRate.create({
      data: { organizationId: f.ids.orgA, wasteTypeId: wasteType.id, unit: "ITEM", pointsPerItem: 900, active: true, ...data } });
    const hold = (depositItemId: string, amount: number, status: "PENDING" | "AVAILABLE" = "PENDING") =>
      f.db.rewardLedger.create({ data: { ...earn(depositItemId), amount, status } });

    const ended = await session("COMPLETED");
    const open = await session("ACTIVE");
    // Legacy review rows: no acceptance event (ended and open sessions), and an event without a time.
    const legacyHeld = await item(ended.id, { validationReasonCode: "ANOMALY_REVIEW" });
    const legacyHold = await hold(legacyHeld.id, 1_000);
    const stillOpen = await item(open.id, { validationReasonCode: "UNKNOWN_WASTE_TYPE" });
    const noTime = await item(ended.id, { acceptanceEventId: "evt-no-time", acceptedAt: null, validationReasonCode: "STRING_PULL" });
    await f.db.rewardReconciliationCase.create({ data: {
      businessKey: `fraud:${noTime.id}:hold:v1`, userId: f.ids.userA, depositItemId: noTime.id, amount: 2_000,
      entryType: "EARN", reasonCode: "ANOMALY_ALREADY_PAID_OUT" } });
    // Accepted rows: legacy (no event, fraud exposure) and legacy-approved (marker), plus a contract row.
    const legacyAccepted = await item(ended.id, { status: "ACCEPTED", acceptedAt, validationReasonCode: "ACCEPTED" });
    const legacyEarn = await hold(legacyAccepted.id, 2_000, "AVAILABLE");
    const resolved = await item(ended.id, { status: "ACCEPTED", acceptedAt, acceptanceEventId: "legacy-approval:sa1", validationReasonCode: "REVIEW_APPROVED" });
    await hold(resolved.id, 2_000, "AVAILABLE");
    await item(ended.id, { status: "ACCEPTED", acceptedAt, acceptanceEventId: "evt-ok", validationReasonCode: "ACCEPTED" });
    // Recorded-rate drift: the window closed before acceptance (active or not) vs a covering, deactivated rate.
    const expired = await rate({ effectiveFrom: new Date(Date.now() - 30 * DAY), effectiveTo: new Date(Date.now() - 10 * DAY) });
    const notYet = await rate({ active: false, effectiveFrom: new Date() });
    const covering = await rate({ active: false, effectiveFrom: new Date(Date.now() - 30 * DAY), effectiveTo: new Date(Date.now() - 1_000) });
    const drifted = await item(ended.id, { acceptanceEventId: "evt-drift", acceptedAt, rewardRateId: expired.id, rewardAmount: 450 });
    const driftHold = await hold(drifted.id, 450);
    const early = await item(ended.id, { acceptanceEventId: "evt-early", acceptedAt, rewardRateId: notYet.id });
    await item(ended.id, { acceptanceEventId: "evt-covered", acceptedAt, rewardRateId: covering.id });
    // Not in review any more: never listed as drift.
    await item(ended.id, { status: "ACCEPTED", acceptanceEventId: "evt-done", acceptedAt, rewardRateId: expired.id, validationReasonCode: "REVIEW_APPROVED" });

    const inventory = await readOnlyInventory();
    const byItem = <T extends { depositItemId: string }>(rows: T[]) => [...rows].sort((a, b) => (a.depositItemId < b.depositItemId ? -1 : 1));
    expect(byItem(inventory.reviewItemsWithoutAcceptance)).toEqual(byItem([
      { depositItemId: legacyHeld.id, userId: f.ids.userA, sessionId: ended.id, sessionStatus: "COMPLETED", sessionEnded: true,
        problem: "NO_ACCEPTANCE_EVENT", validationReasonCode: "ANOMALY_REVIEW", rewardAmount: 0, netAvailable: 0, pending: 1_000,
        ledgerIds: [legacyHold.id], reconciliationCaseKeys: [] },
      { depositItemId: stillOpen.id, userId: f.ids.userA, sessionId: open.id, sessionStatus: "ACTIVE", sessionEnded: false,
        problem: "NO_ACCEPTANCE_EVENT", validationReasonCode: "UNKNOWN_WASTE_TYPE", rewardAmount: 0, netAvailable: 0, pending: 0,
        ledgerIds: [], reconciliationCaseKeys: [] },
      { depositItemId: noTime.id, userId: f.ids.userA, sessionId: ended.id, sessionStatus: "COMPLETED", sessionEnded: true,
        problem: "NO_ACCEPTANCE_TIME", validationReasonCode: "STRING_PULL", rewardAmount: 0, netAvailable: 0, pending: 0,
        ledgerIds: [], reconciliationCaseKeys: [`fraud:${noTime.id}:hold:v1`] },
    ]));
    expect(inventory.acceptedItemsWithoutAcceptance).toEqual([
      { depositItemId: legacyAccepted.id, userId: f.ids.userA, sessionId: ended.id, sessionStatus: "COMPLETED",
        validationReasonCode: "ACCEPTED", rewardAmount: 0, netAvailable: 2_000, pending: 0, ledgerIds: [legacyEarn.id] },
    ]);
    expect(byItem(inventory.reviewItemsWithRateOutsideAcceptance)).toEqual(byItem([
      { depositItemId: drifted.id, userId: f.ids.userA, rewardRateId: expired.id, acceptedAt, effectiveFrom: expired.effectiveFrom,
        effectiveTo: expired.effectiveTo, rateActive: true, rewardAmount: 450, pending: 450, ledgerIds: [driftHold.id] },
      { depositItemId: early.id, userId: f.ids.userA, rewardRateId: notYet.id, acceptedAt, effectiveFrom: notYet.effectiveFrom,
        effectiveTo: null, rateActive: false, rewardAmount: 0, pending: 0, ledgerIds: [] },
    ]));
    expect(inventory.summary).toMatchObject({
      reviewItemsWithoutAcceptance: 3, acceptedItemsWithoutAcceptance: 1, reviewItemsWithRateOutsideAcceptance: 2, blocksEnforcement: 0 });
    expect(inventory.clean).toBe(false);
    expect(inventory.snapshot.readOnly).toBe(true);
  });

  it("CLI prints the JSON report and exits 0 when clean, 3 with findings, without writing", async () => {
    const clean = runCli();
    expect(clean.status, clean.stderr).toBe(0);
    expect(clean.report).toMatchObject({ clean: true, snapshot: { readOnly: true, isolation: "repeatable read" } });

    await f.db.rewardLedger.create({ data: reserve(f.ids.userB, "missing-redemption", 5_000) });
    const fingerprint = () => f.db.$queryRaw<{ n: number; latest: Date }[]>`
      SELECT count(*)::int AS n, max("updatedAt") AS latest FROM "RewardLedger"`;
    const before = await fingerprint();
    const dirty = runCli();
    expect(dirty.status, dirty.stderr).toBe(3);
    expect(dirty.report.summary).toMatchObject({ reservesWithoutRequest: 1, negativeBalances: 1, blocksEnforcement: 0 });
    expect(await fingerprint()).toEqual(before);
  });
});

describe("wallet enforce indexes (database backstop)", () => {
  it("allow one live return earning per trip, excluding a neutralized legacy row", async () => {
    const db = await f.connection();
    const rejects = (write: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      db.$transaction(write).then(() => null, (error: { code?: string }) => error.code);
    const trip = await f.trip({ bagCount: 1 });
    const { campaignId } = await f.db.trip.findUniqueOrThrow({ where: { id: trip.id } });
    // Only the return reason takes the trip's slot: a bonus referencing the trip does not.
    expect(await rejects((tx) => tx.rewardLedger.create({ data: tripBonus(trip.id, campaignId) }))).toBeNull();
    expect(await rejects((tx) => tx.rewardLedger.create({ data: tripEarn(trip.id, campaignId) }))).toBeNull();
    expect(await rejects((tx) => tx.rewardLedger.create({ data: tripEarn(trip.id, campaignId) }))).toBe("P2002");
    expect(await rejects((tx) => tx.rewardLedger.create({ data: tripEarn(trip.id, campaignId, "REVERSED") }))).toBeNull();
    // The guard of the enforce migration passes on a reconciled history.
    expect(await rejects((tx) => tx.$executeRawUnsafe(TRIP_ENFORCE_GUARD))).toBeNull();
  });

  it("allow one EARN per deposit item and one reserve per redemption, excluding neutralized legacy rows", async () => {
    // Expected constraint errors go through an independent client (no error logging).
    const db = await f.connection();
    const rejects = (write: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
      db.$transaction(write).then(() => null, (error: { code?: string }) => error.code);
    const item = await f.db.$transaction((tx) => depositItem(tx));
    const created = await createEarnEntry({ userId: f.ids.userA, depositItemId: item.id, amount: 2_000, status: "AVAILABLE" });
    expect(created.businessKey).toBe(`deposit-item:${item.id}:earn`);
    expect(await rejects((tx) => tx.rewardLedger.create({ data: earn(item.id) }))).toBe("P2002");
    expect(await rejects((tx) => tx.rewardLedger.create({ data: earn(item.id, "REVERSED") }))).toBeNull();

    const redemption = await f.db.redemption.create({ data: {
      userId: f.ids.userA, amount: 10_000, provider: "DANA", payoutAccountId: f.ids.payoutAccountA, idempotencyKey: `idx-${randomUUID()}` } });
    expect(await rejects((tx) => tx.rewardLedger.create({ data: reserve(f.ids.userA, redemption.id, 10_000) }))).toBeNull();
    expect(await rejects((tx) => tx.rewardLedger.create({ data: reserve(f.ids.userA, redemption.id, 10_000) }))).toBe("P2002");
    expect(await rejects((tx) => tx.rewardLedger.create({ data: reserve(f.ids.userA, redemption.id, 10_000, "REJECTED") }))).toBeNull();

    // Idempotency keys are unique per user, not globally.
    expect(await rejects((tx) => tx.redemption.create({ data: {
      userId: f.ids.userA, amount: 10_000, idempotencyKey: redemption.idempotencyKey } }))).toBe("P2002");
    expect(await rejects((tx) => tx.redemption.create({ data: {
      userId: f.ids.userB, amount: 10_000, idempotencyKey: redemption.idempotencyKey } }))).toBeNull();
  });
});
