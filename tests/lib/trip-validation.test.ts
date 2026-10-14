import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  BAG_NOT_IN_TRIP,
  BAG_SCANNED_TWICE,
  INVALID_BAG_CONDITION,
  RETURNED_COUNT_EXCEEDS_ISSUED,
  TRIP_CHANGED,
  assertCountWithinIssued,
  lockTripAggregate,
  markUnreviewedBagsNotReturned,
  refreshTripOutcome,
  tripNotificationRecipients,
  tripReturnKey,
  validateTripBags,
} from "@/lib/trip-validation";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    travelAgentUser: { findMany: vi.fn() },
    travelAgentOrganization: { findMany: vi.fn() },
  },
}));

type Bag = { id: string; bagQrCode: string; status: string | null };

interface TripRow {
  id: string;
  status: string;
  userId: string | null;
  campaignId: string;
  travelAgentId: string | null;
  groupName: string | null;
  complianceScore: number;
  complianceStatus: string;
  campaign: { organizationId: string; campaignType: string; rewardMode: string; rewardMultiplier: number | null; name: string };
  bagAssignments: Bag[];
}

function tripRow(overrides: Partial<TripRow> = {}): TripRow {
  return {
    id: "t1", status: "ACTIVE", userId: "u1", campaignId: "c1", travelAgentId: null, groupName: null,
    complianceScore: 0, complianceStatus: "CHECKED_IN",
    campaign: { organizationId: "org1", campaignType: "TRASH_BAG", rewardMode: "MONEY_REWARD", rewardMultiplier: 1, name: "Camp" },
    bagAssignments: [{ id: "b1", bagQrCode: "Q1", status: "GOOD" }, { id: "b2", bagQrCode: "Q2", status: "GOOD" }],
    ...overrides,
  };
}

/** A fake TransactionClient that records lock SQL and writes in order. */
function fakeTx(state: {
  trip: TripRow | null;
  /** Re-read result after the locks (defaults to `trip`). */
  locked?: TripRow | null;
  rewards?: Array<{ id: string; amount: number; status: string }>;
  validations?: Array<{ id: string }>;
  latestCheckout?: { appCompleted: boolean } | null;
  lockRows?: { user?: number; trip?: number };
}) {
  const log: string[] = [];
  let reads = 0;
  const tx = {
    // B01: the funding account row is created on first use (conflict-free insert, no lock).
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join("?");
      const table = /FROM "(\w+)"/.exec(sql)![1];
      log.push(`lock ${table} ${values.join(",")}${/ORDER BY id/.test(sql) ? " ordered" : ""}`);
      if (table === "User") return Array.from({ length: state.lockRows?.user ?? 1 }, () => ({ id: values[0] }));
      if (table === "RewardFundingAccount") return [{ id: "acct1" }];
      if (table === "Campaign") return [{ id: values[0] }];
      if (table === "Trip") return Array.from({ length: state.lockRows?.trip ?? 1 }, () => ({ id: values[0] }));
      return (state.trip?.bagAssignments ?? []).map((bag) => ({ id: bag.id }));
    }),
    rewardFundingAccount: {
      findUniqueOrThrow: vi.fn(async () => ({ id: "acct1", organizationId: "org1", confirmedRupiah: 0, heldRupiah: 0, version: 0 })),
    },
    // No issuance reservation: a legacy trip, so no funding commit or release.
    rewardBudgetReservation: { findUnique: vi.fn(async () => null) },
    trip: {
      findUnique: vi.fn(async () => {
        reads += 1;
        log.push(reads === 1 ? "read ref" : "read locked");
        if (reads === 1) {
          return state.trip
            ? { userId: state.trip.userId, campaignId: state.trip.campaignId, campaign: { organizationId: state.trip.campaign.organizationId } }
            : null;
        }
        return state.locked === undefined ? state.trip : state.locked;
      }),
      updateMany: vi.fn(async () => {
        log.push("trip updateMany");
        return { count: 1 };
      }),
    },
    trashBagAssignment: {
      findMany: vi.fn(async ({ where }: any) =>
        (state.trip?.bagAssignments ?? [])
          .filter((bag) => where.id.in.includes(bag.id))
          .map((bag) => ({ id: bag.id, status: bag.status }))),
      updateMany: vi.fn(async () => {
        log.push("bag updateMany");
        return { count: 1 };
      }),
    },
    manualValidation: {
      findMany: vi.fn(async () => state.validations ?? []),
      findFirst: vi.fn(async () => state.latestCheckout ?? null),
    },
    rewardLedger: {
      findMany: vi.fn(async () => state.rewards ?? []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => {
        log.push("ledger create");
        return { id: "l1", ...data };
      }),
    },
    // lib/reward-credit.ts (M04): idempotency and erased-recipient checks.
    rewardReconciliationCase: { findUnique: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async () => ({ status: "ACTIVE" })) },
  };
  return { tx: tx as any, raw: tx, log };
}

describe("lockTripAggregate", () => {
  it("locks the reward user, the funding account, the campaign, then the trip, then its bags in id order, then re-reads", async () => {
    const { tx, log } = fakeTx({ trip: tripRow() });
    const trip = await lockTripAggregate(tx, "t1");
    expect(trip.id).toBe("t1");
    expect(log).toEqual([
      "read ref", "lock User u1", "lock RewardFundingAccount org1", "lock Campaign c1",
      "lock Trip t1", "lock TrashBagAssignment t1 ordered", "read locked",
    ]);
  });

  it("locks no user for a trip without a reward recipient", async () => {
    const { tx, log } = fakeTx({ trip: tripRow({ userId: null }) });
    await lockTripAggregate(tx, "t1");
    expect(log).toEqual([
      "read ref", "lock RewardFundingAccount org1", "lock Campaign c1",
      "lock Trip t1", "lock TrashBagAssignment t1 ordered", "read locked",
    ]);
  });

  it("refuses when the re-read trip belongs to another campaign than the one locked (B01)", async () => {
    const { tx } = fakeTx({ trip: tripRow(), locked: tripRow({ campaignId: "c2" }) });
    await expect(lockTripAggregate(tx, "t1")).rejects.toMatchObject({ status: 409, message: TRIP_CHANGED });
  });

  it("answers 404 before taking any lock when the trip does not exist", async () => {
    const { tx, log } = fakeTx({ trip: null });
    await expect(lockTripAggregate(tx, "t1")).rejects.toMatchObject({ status: 404, message: "Trip tidak ditemukan" });
    expect(log).toEqual(["read ref"]);
  });

  it("answers 404 when the trip row vanished before its lock", async () => {
    const { tx } = fakeTx({ trip: tripRow(), lockRows: { trip: 0 } });
    await expect(lockTripAggregate(tx, "t1")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses when the re-read trip has another recipient than the one locked", async () => {
    const { tx } = fakeTx({ trip: tripRow(), locked: tripRow({ userId: "someone-else" }) });
    await expect(lockTripAggregate(tx, "t1")).rejects.toMatchObject({ status: 409, message: TRIP_CHANGED });
  });

  it("answers 404 when the trip is gone after the locks", async () => {
    const { tx } = fakeTx({ trip: tripRow(), locked: null });
    await expect(lockTripAggregate(tx, "t1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("validateTripBags", () => {
  const bags = (statuses: Array<string | null>) => statuses.map((status, i) => ({ id: `b${i + 1}`, bagQrCode: `Q${i}`, status }));

  it("rejects duplicate IDs before any database access", async () => {
    const { tx, raw } = fakeTx({ trip: tripRow() });
    await expect(validateTripBags(tx, "t1", [{ id: "b1", status: "GOOD" }, { id: "b1", status: "POOR" }]))
      .rejects.toMatchObject({ status: 422, message: BAG_SCANNED_TWICE });
    expect(raw.trashBagAssignment.findMany).not.toHaveBeenCalled();
  });

  it("rejects an unknown condition", async () => {
    const { tx } = fakeTx({ trip: tripRow() });
    await expect(validateTripBags(tx, "t1", [{ id: "b1", status: "LOST" as any }]))
      .rejects.toMatchObject({ status: 422, message: INVALID_BAG_CONDITION });
  });

  it("rejects IDs that are not rows of this trip without updating anything", async () => {
    const { tx, raw } = fakeTx({ trip: tripRow({ bagAssignments: bags([null, null]) }) });
    await expect(validateTripBags(tx, "t1", [{ id: "b1", status: "GOOD" }, { id: "foreign", status: "GOOD" }]))
      .rejects.toMatchObject({ status: 422, message: BAG_NOT_IN_TRIP });
    expect(raw.trashBagAssignment.findMany).toHaveBeenCalledWith({
      where: { tripId: "t1", id: { in: ["b1", "foreign"] } }, select: { id: true, status: true } });
    expect(raw.trashBagAssignment.updateMany).not.toHaveBeenCalled();
  });

  it("updates changed bags by id + tripId in id order and counts the submitted rows", async () => {
    const { tx, raw } = fakeTx({ trip: tripRow({ bagAssignments: bags([null, "GOOD", null]) }) });
    const result = await validateTripBags(tx, "t1", [
      { id: "b3", status: "NOT_RETURNED" }, { id: "b2", status: "GOOD" }, { id: "b1", status: "PARTIAL" }]);
    expect(result).toEqual({ returnedCount: 2, rewardableCount: 2 });
    // b2 is unchanged and keeps its original returnedAt.
    expect(raw.trashBagAssignment.updateMany.mock.calls.map(([args]: any[]) => [args.where, args.data.status, args.data.returnedAt === null]))
      .toEqual([[{ id: "b1", tripId: "t1" }, "PARTIAL", false], [{ id: "b3", tripId: "t1" }, "NOT_RETURNED", true]]);
  });

  it("answers 409 when a locked bag could not be updated", async () => {
    const { tx, raw } = fakeTx({ trip: tripRow({ bagAssignments: bags([null]) }) });
    raw.trashBagAssignment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(validateTripBags(tx, "t1", [{ id: "b1", status: "GOOD" }])).rejects.toMatchObject({ status: 409 });
  });

  it("accepts an empty list without touching the database", async () => {
    const { tx, raw } = fakeTx({ trip: tripRow() });
    await expect(validateTripBags(tx, "t1", [])).resolves.toEqual({ returnedCount: 0, rewardableCount: 0 });
    expect(raw.trashBagAssignment.findMany).not.toHaveBeenCalled();
  });
});

describe("markUnreviewedBagsNotReturned / assertCountWithinIssued", () => {
  it("marks only never-scanned bags of the trip NOT_RETURNED", async () => {
    const { tx, raw } = fakeTx({ trip: tripRow() });
    raw.trashBagAssignment.updateMany.mockResolvedValueOnce({ count: 2 });
    await expect(markUnreviewedBagsNotReturned(tx, "t1")).resolves.toBe(2);
    expect(raw.trashBagAssignment.updateMany).toHaveBeenCalledWith({
      where: { tripId: "t1", status: null }, data: { status: "NOT_RETURNED", returnedAt: null } });
  });

  it("bounds a legacy count by the issued rows", () => {
    expect(() => assertCountWithinIssued(1, 1)).not.toThrow();
    expect(() => assertCountWithinIssued(0, 0)).not.toThrow();
    expect(() => assertCountWithinIssued(500, 1)).toThrow(RETURNED_COUNT_EXCEEDS_ISSUED);
  });
});

describe("refreshTripOutcome", () => {
  it("closes an ACTIVE trip whose bags are all reviewed and writes one keyed earning under the locks", async () => {
    const { tx, raw, log } = fakeTx({ trip: tripRow({ bagAssignments: [
      { id: "b1", bagQrCode: "Q1", status: "GOOD" }, { id: "b2", bagQrCode: "Q2", status: "PARTIAL" },
      { id: "b3", bagQrCode: "Q3", status: "POOR" }] }) });
    const outcome = await refreshTripOutcome(tx, "t1", { appCompleted: true });
    // app 30 + all returned 40 + POOR 0 = 70; 2 rewardable x 2.000 x 70%.
    expect(outcome).toEqual({
      completed: true, completedNow: true, rewardAmount: 2_800, computedRewardAmount: 2_800, paidRewardAmount: 2_800,
      compliance: { score: 70, status: "NEEDS_REVIEW" }, assignedCount: 3, returnedCount: 3, rewardableCount: 2,
      conditionStatus: "POOR" });
    expect(raw.trip.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", status: "ACTIVE" },
      data: { complianceStatus: "NEEDS_REVIEW", complianceScore: 70, status: "COMPLETED", checkOutAt: expect.any(Date) } });
    expect(raw.rewardLedger.create).toHaveBeenCalledWith({ data: {
      userId: "u1", organizationId: "org1", campaignId: "c1", entryType: "EARN", amount: 2_800, status: "AVAILABLE",
      reasonCode: "TRASH_BAG_RETURN", referenceType: "Trip", referenceId: "t1", businessKey: "trip:t1:return",
      sessionId: null, depositItemId: null, actorId: null } });
    expect(log.indexOf("lock User u1")).toBeLessThan(log.indexOf("ledger create"));
    expect(tripReturnKey("t1")).toBe("trip:t1:return");
  });

  it("never pays a second time when a trip return earning (keyed or legacy) exists", async () => {
    const { tx, raw } = fakeTx({
      trip: tripRow(), validations: [{ id: "v-legacy" }],
      rewards: [{ id: "old", amount: 2_000, status: "AVAILABLE" }, { id: "dup", amount: 2_000, status: "REVERSED" }],
    });
    const outcome = await refreshTripOutcome(tx, "t1", { appCompleted: true });
    expect(outcome).toMatchObject({ completedNow: true, rewardAmount: 0, computedRewardAmount: 4_000, paidRewardAmount: 2_000 });
    expect(raw.rewardLedger.create).not.toHaveBeenCalled();
    expect(raw.rewardLedger.findMany).toHaveBeenCalledWith({
      where: { entryType: "EARN", OR: [
        { businessKey: "trip:t1:return" },
        { referenceType: "Trip", referenceId: "t1", reasonCode: "TRASH_BAG_RETURN" },
        { referenceType: "ManualValidation", referenceId: { in: ["v-legacy"] }, reasonCode: "TRASH_BAG_RETURN" }] },
      select: { id: true, amount: true, status: true } });
  });

  it("never closes or pays when the caller may not close, even if every bag is reviewed (legacy re-scan)", async () => {
    const { tx, raw } = fakeTx({ trip: tripRow() });
    const outcome = await refreshTripOutcome(tx, "t1", { appCompleted: true, mayClose: false });
    expect(outcome).toMatchObject({ completed: false, completedNow: false, rewardAmount: 0, computedRewardAmount: 4_000 });
    expect(raw.trip.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", status: "ACTIVE" }, data: { complianceStatus: "COMPLIANT", complianceScore: 100 } });
    expect(raw.rewardLedger.create).not.toHaveBeenCalled();
  });

  it("only records progress while some bag is still unreviewed", async () => {
    const { tx, raw } = fakeTx({ trip: tripRow({ bagAssignments: [
      { id: "b1", bagQrCode: "Q1", status: "GOOD" }, { id: "b2", bagQrCode: "Q2", status: null }] }) });
    const outcome = await refreshTripOutcome(tx, "t1", { appCompleted: true });
    expect(outcome).toMatchObject({ completed: false, completedNow: false, rewardAmount: 0, returnedCount: 1, assignedCount: 2 });
    expect(raw.trip.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", status: "ACTIVE" }, data: { complianceStatus: "COMPLIANT", complianceScore: 80 } });
    expect(raw.rewardLedger.create).not.toHaveBeenCalled();
  });

  it("recomputes a COMPLETED trip (correction) without touching its reward", async () => {
    const { tx, raw } = fakeTx({
      trip: tripRow({ status: "COMPLETED" }), latestCheckout: { appCompleted: true },
      rewards: [{ id: "paid", amount: 1_400, status: "AVAILABLE" }],
    });
    const outcome = await refreshTripOutcome(tx, "t1");
    expect(outcome).toMatchObject({
      completed: true, completedNow: false, rewardAmount: 0, computedRewardAmount: 4_000, paidRewardAmount: 1_400,
      compliance: { score: 100, status: "COMPLIANT" } });
    expect(raw.manualValidation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tripId: "t1", validationStage: "CHECK_OUT" } }));
    expect(raw.trip.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", status: "COMPLETED" }, data: { complianceStatus: "COMPLIANT", complianceScore: 100 } });
    expect(raw.rewardLedger.create).not.toHaveBeenCalled();
  });

  it("defaults appCompleted to false when no check-out was recorded", async () => {
    const { tx } = fakeTx({ trip: tripRow({ campaign: { organizationId: "org1", campaignType: "TRASH_BAG", rewardMode: "COMPLIANCE_ONLY", rewardMultiplier: null, name: "C" } }) });
    const outcome = await refreshTripOutcome(tx, "t1");
    expect(outcome.compliance).toEqual({ score: 70, status: "NEEDS_REVIEW" });
  });

  it("earns nothing for COMPLIANCE_ONLY trips or trips without a recipient", async () => {
    for (const trip of [
      tripRow({ campaign: { organizationId: "org1", campaignType: "TRASH_BAG", rewardMode: "COMPLIANCE_ONLY", rewardMultiplier: 1, name: "C" } }),
      // M04: a campaign that is not a trip program never pays a trip.
      tripRow({ campaign: { organizationId: "org1", campaignType: "MACHINE_DEPOSIT", rewardMode: "MONEY_REWARD", rewardMultiplier: 1, name: "C" } }),
      tripRow({ userId: null }),
    ]) {
      const { tx, raw, log } = fakeTx({ trip });
      const outcome = await refreshTripOutcome(tx, "t1", { appCompleted: true });
      expect(outcome).toMatchObject({ completedNow: true, rewardAmount: 0, computedRewardAmount: 0 });
      expect(raw.rewardLedger.create).not.toHaveBeenCalled();
      if (!trip.userId) expect(log.some((line) => line.startsWith("lock User"))).toBe(false);
    }
  });

  it("answers 409 when the trip status changed under the compare-and-set", async () => {
    const { tx, raw } = fakeTx({ trip: tripRow() });
    raw.trip.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(refreshTripOutcome(tx, "t1", { appCompleted: true })).rejects.toMatchObject({ status: 409, message: TRIP_CHANGED });
    expect(raw.rewardLedger.create).not.toHaveBeenCalled();
  });

  it("refuses trips that are not ACTIVE or COMPLETED", async () => {
    for (const status of ["PLANNED", "CANCELLED"]) {
      const { tx, raw } = fakeTx({ trip: tripRow({ status }) });
      await expect(refreshTripOutcome(tx, "t1")).rejects.toMatchObject({ status: 422 });
      expect(raw.trip.updateMany).not.toHaveBeenCalled();
    }
  });

  it("refuses a reward that cannot be stored as integer rupiah", async () => {
    const { tx, raw } = fakeTx({ trip: tripRow({
      campaign: { organizationId: "org1", campaignType: "TRASH_BAG", rewardMode: "MONEY_REWARD", rewardMultiplier: 1e7, name: "C" } }) });
    await expect(refreshTripOutcome(tx, "t1", { appCompleted: true })).rejects.toMatchObject({ status: 422 });
    expect(raw.trip.updateMany).not.toHaveBeenCalled();
  });
});

describe("tripNotificationRecipients", () => {
  beforeEach(() => vi.clearAllMocks());
  const trip = { userId: "u1", travelAgentId: "ta1", campaign: { organizationId: "org1" } };

  it("is only the recipient without a travel agent", async () => {
    await expect(tripNotificationRecipients({ ...trip, travelAgentId: null })).resolves.toEqual(["u1"]);
    expect(prisma.travelAgentUser.findMany).not.toHaveBeenCalled();
  });

  it("adds the agent's users while the agent is invited by the organization", async () => {
    vi.mocked(prisma.travelAgentUser.findMany).mockResolvedValue([{ userId: "agent-1" }, { userId: "u1" }] as any);
    vi.mocked(prisma.travelAgentOrganization.findMany).mockResolvedValue([{ id: "link" }] as any);
    await expect(tripNotificationRecipients(trip)).resolves.toEqual(["u1", "agent-1"]);
    // A03: unverified members are never notified.
    expect(prisma.travelAgentUser.findMany).toHaveBeenCalledWith({
      where: { travelAgentId: "ta1", verifiedAt: { not: null }, user: { emailVerifiedAt: { not: null } } },
      select: { userId: true },
    });
    expect(prisma.travelAgentOrganization.findMany).toHaveBeenCalledWith({
      where: { travelAgentId: "ta1", organizationId: "org1", status: "INVITED" }, select: { id: true } });
  });

  it("skips agent users when the agent is no longer invited, and never throws", async () => {
    vi.mocked(prisma.travelAgentUser.findMany).mockResolvedValue([{ userId: "agent-1" }] as any);
    vi.mocked(prisma.travelAgentOrganization.findMany).mockResolvedValue([]);
    await expect(tripNotificationRecipients({ ...trip, userId: null })).resolves.toEqual([]);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(prisma.travelAgentUser.findMany).mockRejectedValue(new Error("db down"));
    await expect(tripNotificationRecipients(trip)).resolves.toEqual(["u1"]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
