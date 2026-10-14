import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleCloseWatermark, WATERMARK_COUNT_MISMATCH, WATERMARK_SESSION_STILL_OPEN } from "@/lib/machine-events/watermark";
import * as locks from "@/lib/db-locks";
import * as funding from "@/lib/reward-funding";
import * as sessions from "@/lib/deposit-session-service";

vi.mock("@/lib/db-locks", () => ({
  lockUser: vi.fn(), lockCampaign: vi.fn(), lockMachine: vi.fn(), lockDepositSession: vi.fn(), lockDepositItem: vi.fn(),
}));
vi.mock("@/lib/reward-funding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reward-funding")>();
  return {
    ...actual,
    lockFundingAccountForOrganization: vi.fn(),
    findReservationByKey: vi.fn(),
    releaseUnusedRewardBudget: vi.fn(),
  };
});
vi.mock("@/lib/deposit-session-service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deposit-session-service")>();
  return { ...actual, expireIfTimedOut: vi.fn() };
});
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));

/**
 * B01b: SESSION_CLOSE_WATERMARK. The RVM says "every event of session S up to
 * localEventId N is synced"; only then is S's residual reward hold released,
 * keyed so a retry never releases twice. Lock order: owner User -> funding
 * account -> Campaign -> Machine -> DepositSession (-> items on expiry).
 */
const tx = {
  depositSession: { findUnique: vi.fn(), update: vi.fn() },
  machineEvent: { count: vi.fn(), findFirst: vi.fn() },
} as any;
const machine = { id: "m1", organizationId: "o1", chamberTimeoutSeconds: 20, sessionIdleTimeoutMinutes: 3, hasCompactor: false };
const terminal = (over: Record<string, unknown> = {}) => ({
  id: "s1", userId: "u1", campaignId: "c1", machineId: "m1", status: "COMPLETED",
  startedAt: new Date(Date.now() - 600_000), timeoutAt: new Date(Date.now() - 300_000), completedAt: new Date(Date.now() - 300_000),
  closeWatermarkAt: null, closeWatermarkEventCount: null, ...over,
});
const input = (payload: Record<string, unknown> = { eventCount: 3, lastLocalEventId: "e3", consumedRupiah: 200, consumedItems: 2 }) => ({
  machineCode: "RVM-001", localEventId: "wm1", eventType: "SESSION_CLOSE_WATERMARK" as const, sessionId: "s1", payload,
});
const calls = () => [
  ...vi.mocked(locks.lockUser).mock.invocationCallOrder.map((o) => [o, "User"] as const),
  ...vi.mocked(funding.lockFundingAccountForOrganization).mock.invocationCallOrder.map((o) => [o, "RewardFundingAccount"] as const),
  ...vi.mocked(locks.lockCampaign).mock.invocationCallOrder.map((o) => [o, "Campaign"] as const),
  ...vi.mocked(locks.lockMachine).mock.invocationCallOrder.map((o) => [o, "Machine"] as const),
  ...vi.mocked(locks.lockDepositSession).mock.invocationCallOrder.map((o) => [o, "DepositSession"] as const),
].sort((a, b) => a[0] - b[0]).map(([, name]) => name);

describe("handleCloseWatermark", () => {
  const afterCommit: (() => Promise<void>)[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    afterCommit.length = 0;
    tx.depositSession.findUnique.mockResolvedValue(terminal());
    tx.depositSession.update.mockResolvedValue({});
    tx.machineEvent.count.mockResolvedValue(3);
    tx.machineEvent.findFirst.mockResolvedValue({ id: "evt3" });
    vi.mocked(funding.findReservationByKey).mockResolvedValue({ id: "res1", status: "ACTIVE", remainingRupiah: 800 } as any);
    vi.mocked(funding.releaseUnusedRewardBudget).mockResolvedValue({ released: 800 } as any);
  });

  it("locks owner User -> account -> Campaign -> Machine -> DepositSession, records the watermark and releases the residue under a business key", async () => {
    await handleCloseWatermark(tx, machine, input(), "wm-row", (effect) => afterCommit.push(effect));
    expect(calls()).toEqual(["User", "RewardFundingAccount", "Campaign", "Machine", "DepositSession"]);
    expect(locks.lockUser).toHaveBeenCalledWith(tx, "u1");
    expect(funding.lockFundingAccountForOrganization).toHaveBeenCalledWith(tx, "o1");
    expect(tx.machineEvent.count).toHaveBeenCalledWith({
      where: { machineId: "m1", sessionId: "s1", eventType: { not: "SESSION_CLOSE_WATERMARK" } } });
    expect(tx.machineEvent.findFirst).toHaveBeenCalledWith({
      where: { machineId: "m1", sessionId: "s1", localEventId: "e3" }, select: { id: true } });
    expect(tx.depositSession.update).toHaveBeenCalledWith({
      where: { id: "s1", closeWatermarkAt: null },
      data: { closeWatermarkAt: expect.any(Date), closeWatermarkEventCount: 3 },
    });
    expect(funding.findReservationByKey).toHaveBeenCalledWith(tx, "session:s1:admission");
    expect(funding.releaseUnusedRewardBudget).toHaveBeenCalledWith(tx, "res1", 800, {
      close: true, reason: "CLOSE_WATERMARK", businessKey: "session:s1:close-watermark" });
    expect(afterCommit).toHaveLength(1);
  });

  it("a session already watermarked is a no-op (the keyed release is never repeated)", async () => {
    tx.depositSession.findUnique.mockResolvedValue(terminal({ closeWatermarkAt: new Date(), closeWatermarkEventCount: 3 }));
    await handleCloseWatermark(tx, machine, input(), "wm-row", (effect) => afterCommit.push(effect));
    expect(tx.depositSession.update).not.toHaveBeenCalled();
    expect(funding.releaseUnusedRewardBudget).not.toHaveBeenCalled();
  });

  it("refuses permanently when the server holds fewer events than the RVM counted or the last event is unknown (hold kept)", async () => {
    tx.machineEvent.count.mockResolvedValue(2);
    await expect(handleCloseWatermark(tx, machine, input(), "wm-row")).rejects.toMatchObject({ status: 409, message: WATERMARK_COUNT_MISMATCH });
    tx.machineEvent.count.mockResolvedValue(3);
    tx.machineEvent.findFirst.mockResolvedValue(null);
    await expect(handleCloseWatermark(tx, machine, input(), "wm-row")).rejects.toMatchObject({ status: 409 });
    expect(tx.depositSession.update).not.toHaveBeenCalled();
    expect(funding.releaseUnusedRewardBudget).not.toHaveBeenCalled();
  });

  it("a watermark for a session the server still runs is retried later (503), never released", async () => {
    tx.depositSession.findUnique.mockResolvedValue(terminal({ status: "ACTIVE", completedAt: null, timeoutAt: new Date(Date.now() + 60_000) }));
    await expect(handleCloseWatermark(tx, machine, input(), "wm-row")).rejects.toMatchObject({ status: 503, message: WATERMARK_SESSION_STILL_OPEN });
    expect(sessions.expireIfTimedOut).not.toHaveBeenCalled();
    expect(funding.releaseUnusedRewardBudget).not.toHaveBeenCalled();
  });

  it("closes a session past its deadline through the timeout policy first, then releases", async () => {
    const open = terminal({ status: "PROCESSING_ITEM", completedAt: null, timeoutAt: new Date(Date.now() - 1_000) });
    tx.depositSession.findUnique
      .mockResolvedValueOnce(open) // immutable relations
      .mockResolvedValueOnce(open) // under the locks: still open, past its deadline
      .mockResolvedValueOnce({ ...open, status: "EXPIRED", completedAt: new Date() }); // after the timeout policy
    vi.mocked(sessions.expireIfTimedOut).mockResolvedValue({ sessionId: "s1", userId: "u1", heldItemIds: ["i1"] });
    await handleCloseWatermark(tx, machine, input(), "wm-row", (effect) => afterCommit.push(effect));
    expect(sessions.expireIfTimedOut).toHaveBeenCalledWith(tx, "s1", 3, expect.any(Date));
    expect(funding.releaseUnusedRewardBudget).toHaveBeenCalled();
    expect(afterCommit).toHaveLength(2); // expiry audit + watermark audit
  });

  it("a compliance session (no reservation) only records the watermark; a malformed payload is rejected permanently", async () => {
    vi.mocked(funding.findReservationByKey).mockResolvedValue(null);
    await handleCloseWatermark(tx, machine, input(), "wm-row");
    expect(tx.depositSession.update).toHaveBeenCalled();
    expect(funding.releaseUnusedRewardBudget).not.toHaveBeenCalled();
    await expect(handleCloseWatermark(tx, machine, input({ eventCount: -1 }), "wm-row")).rejects.toMatchObject({ status: 422 });
    await expect(handleCloseWatermark(tx, machine, input({ eventCount: 1.5, lastLocalEventId: "e1" }), "wm-row")).rejects.toMatchObject({ status: 422 });
  });

  it("does nothing for an event without a session", async () => {
    await handleCloseWatermark(tx, machine, { ...input(), sessionId: null }, "wm-row");
    expect(locks.lockUser).not.toHaveBeenCalled();
  });
});
