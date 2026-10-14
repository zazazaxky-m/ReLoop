import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleAcceptance, handleItemRejected, recordItemEvidence } from '@/lib/machine-events/acceptance';
import * as locks from '@/lib/db-locks';
import * as credit from '@/lib/reward-credit';
import * as funding from '@/lib/reward-funding';
import * as machineState from '@/lib/machine-state';
import * as reward from '@/lib/reward';
import { UNKNOWN_WASTE_TYPE_NAME, UNKNOWN_WASTE_TYPE_REASON } from '@/lib/machine-events/shared';

vi.mock('@/lib/db-locks', () => ({
  lockUser: vi.fn(),
  lockCampaign: vi.fn(),
  lockDepositSession: vi.fn(),
  lockDepositItem: vi.fn(),
}));
vi.mock('@/lib/reward-credit', () => ({ creditReward: vi.fn() }));
vi.mock('@/lib/reward-funding', () => ({ lockFundingAccountForOrganization: vi.fn() }));
vi.mock('@/lib/machine-state', () => ({
  transitionSession: vi.fn(),
  validateSensorSequence: vi.fn(),
}));
vi.mock('@/lib/reward', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reward')>();
  return {
    validateWeight: actual.validateWeight,
    computeRewardAmount: vi.fn(),
    computeWeightBasedRewardAmount: vi.fn(),
    resolveRewardRate: vi.fn(),
  };
});

const mockTx = {
  depositSession: { findUnique: vi.fn(), update: vi.fn() },
  depositItem: { findUnique: vi.fn(), updateMany: vi.fn() },
  machine: { findUnique: vi.fn() },
  machineEvent: { findUnique: vi.fn() },
  rewardLedger: { count: vi.fn() },
} as any;
const machine = { id: 'm1', organizationId: 'o1', hasCompactor: false };

const session = (extra: Record<string, unknown> = {}) => ({
  id: 's1', userId: 'u1', status: 'PROCESSING_ITEM', campaignId: null, campaign: null,
  startedAt: new Date(Date.now() - 60_000), timeoutAt: new Date(Date.now() + 60_000), completedAt: null, ...extra,
});
const item = (extra: Record<string, unknown> = {}) => ({
  id: 'd1', sessionId: 's1', wasteTypeId: 'w1', measuredWeightGrams: 50, quantity: 1, status: 'PENDING',
  acceptanceEventId: null, validationReasonCode: null, externalFraudFlag: false, sensorSequenceJson: null,
  aiDetectedType: null, aiConfidence: null, barcodeValue: null,
  wasteType: { unit: 'ITEM', defaultRewardPerItem: 10, minWeightGrams: null, maxWeightGrams: null, aiAcceptedLabels: ['bottle_pet'] },
  ...extra,
});
const run = () => handleAcceptance(mockTx, machine, 's1', 'd1', 'evt1');
const itemUpdate = () => mockTx.depositItem.updateMany.mock.calls[0]?.[0];
const credited = () => vi.mocked(credit.creditReward).mock.calls[0]?.[1];

describe('handleAcceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ id: 'r1', pointsPerItem: 200, unit: 'ITEM' } as any);
    vi.mocked(reward.computeRewardAmount).mockReturnValue(200);
    vi.mocked(reward.computeWeightBasedRewardAmount).mockReturnValue(300);
    vi.mocked(machineState.validateSensorSequence).mockReturnValue(null);
    vi.mocked(machineState.transitionSession).mockReturnValue('ACTIVE' as any);
    vi.mocked(credit.creditReward).mockResolvedValue(null);
    mockTx.depositSession.findUnique.mockResolvedValue(session());
    mockTx.depositItem.findUnique.mockResolvedValue(item());
    mockTx.depositItem.updateMany.mockResolvedValue({ count: 1 });
    mockTx.machine.findUnique.mockResolvedValue({
      materialVerification: 'WEIGHT_ONLY', sessionIdleTimeoutMinutes: 3, organization: { machineRewardMode: 'MONEY_REWARD' } });
    mockTx.machineEvent.findUnique.mockResolvedValue({ occurredAt: new Date() });
  });

  describe('R03 C1: acceptance after the session ended', () => {
    const deadline = () => new Date(Date.now() - 60_000);
    const held = (reason: string) => {
      expect(itemUpdate().data).toMatchObject({ status: 'REVIEW', validationReasonCode: reason, acceptanceEventId: 'evt1',
        complianceMultiplier: 0.5, rewardAmount: 100 });
      expect(credited()).toMatchObject({ status: 'PENDING', amount: 100, reasonCode: reason });
    };

    it('holds an acceptance made after the deadline for review, keeping SESSION_TIMEOUT, never AVAILABLE', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue(session({ status: 'EXPIRED', timeoutAt: deadline(), completedAt: new Date() }));
      mockTx.depositItem.findUnique.mockResolvedValue(item({ status: 'REVIEW', validationReasonCode: 'SESSION_TIMEOUT' }));
      mockTx.machineEvent.findUnique.mockResolvedValue({ occurredAt: new Date(deadline().getTime() + 5_000) });
      await run();
      expect(mockTx.machineEvent.findUnique).toHaveBeenCalledWith({ where: { id: 'evt1' }, select: { occurredAt: true } });
      held('SESSION_TIMEOUT');
    });

    it('holds a late acceptance of a still-open session past its deadline (not yet closed by a poll)', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue(session({ status: 'PROCESSING_ITEM', timeoutAt: deadline() }));
      await run();
      held('SESSION_TIMEOUT');
    });

    it('uses start + idle timeout as the deadline of a session without timeoutAt', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue(session({ timeoutAt: null, startedAt: new Date(Date.now() - 4 * 60_000) }));
      await run();
      held('SESSION_TIMEOUT');
    });

    it('holds an item reported after the session ended (SESSION_CLOSED) whatever the acceptance time', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue(session({ status: 'COMPLETED', completedAt: new Date(Date.now() - 1_000) }));
      mockTx.depositItem.findUnique.mockResolvedValue(item({ status: 'REVIEW', validationReasonCode: 'SESSION_CLOSED' }));
      mockTx.machineEvent.findUnique.mockResolvedValue({ occurredAt: new Date(Date.now() - 30_000) });
      await run();
      held('SESSION_CLOSED');
    });

    it('treats an acceptance after the owner ended the session as late, even before the deadline', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue(session({ status: 'COMPLETED', completedAt: new Date(Date.now() - 10_000) }));
      await run();
      held('SESSION_TIMEOUT');
    });

    it('applies the normal policy to an acceptance made before the deadline (may pay)', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue(session({ status: 'EXPIRED', timeoutAt: deadline(), completedAt: new Date() }));
      mockTx.depositItem.findUnique.mockResolvedValue(item({ status: 'REVIEW', validationReasonCode: 'SESSION_TIMEOUT' }));
      mockTx.machineEvent.findUnique.mockResolvedValue({ occurredAt: new Date(deadline().getTime() - 5_000) });
      await run();
      expect(itemUpdate().data).toMatchObject({ status: 'ACCEPTED', rewardAmount: 200 });
      expect(credited()).toMatchObject({ status: 'AVAILABLE', amount: 200 });
    });

    it('keeps the unknown-type reason and hard zero on a late unknown-type item', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue(session({ status: 'EXPIRED', timeoutAt: deadline(), completedAt: new Date() }));
      mockTx.depositItem.findUnique.mockResolvedValue(item({
        status: 'REVIEW', validationReasonCode: UNKNOWN_WASTE_TYPE_REASON,
        wasteType: { name: UNKNOWN_WASTE_TYPE_NAME, organizationId: null, unit: 'ITEM', defaultRewardPerItem: 0,
          minWeightGrams: null, maxWeightGrams: null, aiAcceptedLabels: [] } }));
      await run();
      expect(itemUpdate().data).toMatchObject({ status: 'REVIEW', validationReasonCode: UNKNOWN_WASTE_TYPE_REASON, rewardAmount: 0 });
    });

    it('rejects a late item with an invalid weight, with no money', async () => {
      mockTx.depositSession.findUnique.mockResolvedValue(session({ status: 'PROCESSING_ITEM', timeoutAt: deadline() }));
      mockTx.depositItem.findUnique.mockResolvedValue(item({ measuredWeightGrams: null,
        wasteType: { unit: 'ITEM', defaultRewardPerItem: 10, minWeightGrams: 10, maxWeightGrams: 100, aiAcceptedLabels: [] } }));
      await run();
      expect(itemUpdate().data).toMatchObject({ status: 'REJECTED', rewardAmount: 0 });
      expect(credit.creditReward).not.toHaveBeenCalled();
    });
  });

  it('exits early without locks or writes if the session or item does not exist', async () => {
    mockTx.depositSession.findUnique.mockResolvedValueOnce(null);
    await run();
    mockTx.depositItem.findUnique.mockResolvedValueOnce(null);
    await run();
    expect(locks.lockUser).not.toHaveBeenCalled();
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();
    expect(credit.creditReward).not.toHaveBeenCalled();
  });

  it('locks User -> funding account -> DepositSession -> DepositItem before reading the decision state', async () => {
    await run();
    const order = [locks.lockUser, funding.lockFundingAccountForOrganization, locks.lockDepositSession, locks.lockDepositItem]
      .map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(locks.lockUser).toHaveBeenCalledWith(mockTx, 'u1');
    expect(funding.lockFundingAccountForOrganization).toHaveBeenCalledWith(mockTx, 'o1');
    expect(locks.lockCampaign).not.toHaveBeenCalled();
    expect(locks.lockDepositSession).toHaveBeenCalledWith(mockTx, 's1');
    expect(locks.lockDepositItem).toHaveBeenCalledWith(mockTx, 'd1');
    const lastLock = vi.mocked(locks.lockDepositItem).mock.invocationCallOrder[0];
    expect(mockTx.machine.findUnique.mock.invocationCallOrder[0]).toBeGreaterThan(lastLock);
    expect(mockTx.depositItem.findUnique.mock.invocationCallOrder.at(-1)).toBeGreaterThan(lastLock);
  });

  it('locks the session campaign between the account and the session, and fails loudly if the session changed (B01)', async () => {
    const campaign = { id: 'c1', campaignType: 'MACHINE_DEPOSIT', rewardMode: 'MONEY_REWARD', supportsMachine: false, rewardMultiplier: null };
    mockTx.depositSession.findUnique.mockResolvedValue(session({ campaignId: 'c1', campaign }));
    await run();
    const account = vi.mocked(funding.lockFundingAccountForOrganization).mock.invocationCallOrder[0];
    const campaignLock = vi.mocked(locks.lockCampaign).mock.invocationCallOrder[0];
    expect(locks.lockCampaign).toHaveBeenCalledWith(mockTx, 'c1');
    expect(campaignLock).toBeGreaterThan(account);
    expect(campaignLock).toBeLessThan(vi.mocked(locks.lockDepositSession).mock.invocationCallOrder[0]);
    expect(credited()).toMatchObject({ campaignId: 'c1', funding: { ceilingRupiah: 200, reviewPending: false } });

    vi.clearAllMocks();
    mockTx.depositSession.findUnique
      .mockResolvedValueOnce(session({ campaignId: 'c1' }))
      .mockResolvedValueOnce(session({ campaignId: null }));
    await expect(run()).rejects.toThrow('DEPOSIT_ITEM_CHANGED');
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();
  });

  it('commits the approvable ceiling for a review hold and nothing with money for COMPLIANCE_ONLY (B01)', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(item({ aiDetectedType: 'paper', aiConfidence: 0.97 }));
    await run();
    expect(credited()).toMatchObject({ amount: 100, status: 'PENDING', funding: { ceilingRupiah: 200, reviewPending: true } });

    vi.clearAllMocks();
    mockTx.depositItem.findUnique.mockResolvedValue(item({ aiDetectedType: 'paper', aiConfidence: 0.97 }));
    mockTx.machine.findUnique.mockResolvedValue({
      materialVerification: 'WEIGHT_ONLY', sessionIdleTimeoutMinutes: 3, organization: { machineRewardMode: 'COMPLIANCE_ONLY' } });
    await run();
    expect(credited()).toMatchObject({ amount: 0, funding: { ceilingRupiah: 0, reviewPending: true } });
  });

  it('is idempotent: an item already accepted or decided is never priced or paid again', async () => {
    for (const extra of [{ acceptanceEventId: 'evt0' }, { status: 'ACCEPTED' }, { status: 'REJECTED' }]) {
      mockTx.depositItem.findUnique.mockResolvedValue(item(extra));
      await run();
    }
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();
    expect(credit.creditReward).not.toHaveBeenCalled();
  });

  it('accepts a verified item and credits it AVAILABLE under its business key', async () => {
    await run();
    expect(itemUpdate()).toEqual({
      where: { id: 'd1', acceptanceEventId: null, status: { in: ['PENDING', 'REVIEW'] } },
      data: expect.objectContaining({ status: 'ACCEPTED', validationReasonCode: 'ACCEPTED', rewardAmount: 200,
        baseRewardAmount: 200, complianceMultiplier: 1, acceptanceEventId: 'evt1', compactionStatus: 'NOT_REQUIRED' }),
    });
    expect(credited()).toEqual({
      businessKey: 'deposit-item:d1:earn', userId: 'u1', organizationId: 'o1', campaignId: null, amount: 200,
      status: 'AVAILABLE', reasonCode: 'ACCEPTED', referenceType: 'DepositItem', referenceId: 'd1',
      depositItemId: 'd1', sessionId: 's1', funding: { ceilingRupiah: 200, reviewPending: false },
    });
    expect(mockTx.depositSession.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'ACTIVE', anomalyCount: undefined } });
  });

  it('never mints money in a COMPLIANCE_ONLY campaign (LOG-04)', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue(session({
      campaignId: 'c1', campaign: { campaignType: 'MACHINE_DEPOSIT', rewardMode: 'COMPLIANCE_ONLY', supportsMachine: false, rewardMultiplier: 3 } }));
    await run();
    expect(itemUpdate().data).toMatchObject({ status: 'ACCEPTED', rewardAmount: 0, baseRewardAmount: 0 });
    expect(credited()).toMatchObject({ amount: 0, campaignId: 'c1' });
  });

  it('pays no money for a session bound to a campaign that does not support machines', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue(session({
      campaignId: 'c1', campaign: { campaignType: 'TRASH_BAG', rewardMode: 'MONEY_REWARD', supportsMachine: true, rewardMultiplier: 3 } }));
    await run();
    expect(reward.resolveRewardRate).toHaveBeenCalledWith(expect.objectContaining({ campaignId: null }), mockTx);
    expect(credited()).toMatchObject({ amount: 0 });
  });

  it('uses the organization mode for sessions without a campaign', async () => {
    mockTx.machine.findUnique.mockResolvedValue({ materialVerification: 'WEIGHT_ONLY', organization: { machineRewardMode: 'COMPLIANCE_ONLY' } });
    await run();
    expect(credited()).toMatchObject({ amount: 0 });
  });

  it('holds an AI mismatch for review with a PENDING half reward (LOG-05)', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(item({ aiDetectedType: 'paper', aiConfidence: 0.97 }));
    await run();
    expect(itemUpdate().data).toMatchObject({ status: 'REVIEW', validationReasonCode: 'AI_TYPE_MISMATCH', rewardAmount: 100, complianceMultiplier: 0.5 });
    expect(credited()).toMatchObject({ amount: 100, status: 'PENDING', reasonCode: 'AI_TYPE_MISMATCH' });
    expect(mockTx.depositSession.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'ACTIVE', anomalyCount: { increment: 1 } } });
    expect(machineState.transitionSession).toHaveBeenCalledWith('PROCESSING_ITEM', 'ANOMALY');
  });

  it('holds an item when an AI_REQUIRED machine has no classification', async () => {
    mockTx.machine.findUnique.mockResolvedValue({ materialVerification: 'AI_REQUIRED', organization: { machineRewardMode: 'MONEY_REWARD' } });
    await run();
    expect(itemUpdate().data).toMatchObject({ status: 'REVIEW', validationReasonCode: 'AI_UNAVAILABLE' });
    expect(credited()).toMatchObject({ status: 'PENDING', amount: 100 });
  });

  it('rejects an invalid weight with no money', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(item({ measuredWeightGrams: 5, aiDetectedType: 'bottle_pet', aiConfidence: 0.99 }));
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ id: 'r1', pointsPerItem: 200, unit: 'ITEM', minWeightGrams: 10, maxWeightGrams: 100 } as any);
    await run();
    expect(itemUpdate().data).toMatchObject({ status: 'REJECTED', validationReasonCode: 'WEIGHT_BELOW_MIN', rewardAmount: 0, acceptedAt: null });
    expect(credit.creditReward).not.toHaveBeenCalled();
  });

  it('reviews sensor anomalies, fraud flags and REVIEW sessions with the most specific reason', async () => {
    vi.mocked(machineState.validateSensorSequence).mockReturnValueOnce('REVERSE_MOTION');
    await run();
    expect(itemUpdate().data).toMatchObject({ status: 'REVIEW', validationReasonCode: 'REVERSE_MOTION' });

    vi.clearAllMocks();
    mockTx.depositItem.updateMany.mockResolvedValue({ count: 1 });
    mockTx.depositSession.findUnique.mockResolvedValue(session({ status: 'REVIEW' }));
    mockTx.depositItem.findUnique.mockResolvedValue(item({ externalFraudFlag: true }));
    vi.mocked(reward.resolveRewardRate).mockResolvedValue(null);
    vi.mocked(reward.computeRewardAmount).mockReturnValue(10);
    await run();
    expect(itemUpdate().data).toMatchObject({ status: 'REVIEW', validationReasonCode: 'ANOMALY_REVIEW', rewardAmount: 5 });
    expect(mockTx.depositSession.update).not.toHaveBeenCalled();
  });

  it('hard-zeroes an unknown-type item and keeps it in review, whatever the fallback type is worth (C3)', async () => {
    // The fallback type is worth something (an admin set a default reward): still 0.
    mockTx.depositItem.findUnique.mockResolvedValue(item({ status: 'REVIEW', validationReasonCode: UNKNOWN_WASTE_TYPE_REASON,
      wasteType: { unit: 'ITEM', defaultRewardPerItem: 500, aiAcceptedLabels: [] } }));
    vi.mocked(reward.computeRewardAmount).mockReturnValue(500);
    await run();
    expect(reward.resolveRewardRate).not.toHaveBeenCalled();
    expect(itemUpdate().data).toMatchObject({ status: 'REVIEW', validationReasonCode: UNKNOWN_WASTE_TYPE_REASON,
      rewardAmount: 0, baseRewardAmount: 0, complianceMultiplier: 0 });
    expect(credited()).toMatchObject({ amount: 0 });
  });

  it('routes an unknown-type item to review even without a valid weight (C3)', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(item({ status: 'REVIEW', measuredWeightGrams: null,
      validationReasonCode: 'REVERSE_MOTION', // reason overwritten earlier: the fallback type still identifies it
      wasteType: { name: UNKNOWN_WASTE_TYPE_NAME, organizationId: null, unit: 'ITEM', defaultRewardPerItem: 500,
        minWeightGrams: 10, maxWeightGrams: 20, aiAcceptedLabels: [] } }));
    vi.mocked(reward.computeRewardAmount).mockReturnValue(500);
    await run();
    expect(itemUpdate().data).toMatchObject({ status: 'REVIEW', validationReasonCode: UNKNOWN_WASTE_TYPE_REASON, rewardAmount: 0 });
    expect(credited()).toMatchObject({ amount: 0 });
  });

  it('fails closed when the machine configuration cannot be read (C4)', async () => {
    mockTx.machine.findUnique.mockResolvedValue(null);
    await run();
    // AI_REQUIRED without a classification -> review; COMPLIANCE_ONLY -> no money.
    expect(itemUpdate().data).toMatchObject({ status: 'REVIEW', validationReasonCode: 'AI_UNAVAILABLE', rewardAmount: 0 });
    expect(credited()).toMatchObject({ amount: 0 });
  });

  it('computes a weight-based reward for KG rates', async () => {
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ id: 'r1', pointsPerItem: 20, unit: 'KG' } as any);
    await run();
    expect(reward.computeWeightBasedRewardAmount).toHaveBeenCalledWith(20, 50, 1);
    expect(credited()).toMatchObject({ amount: 300 });
  });

  it('marks compaction pending on machines with a compactor', async () => {
    await handleAcceptance(mockTx, { ...machine, hasCompactor: true }, 's1', 'd1', 'evt1');
    expect(itemUpdate().data).toMatchObject({ compactionStatus: 'PENDING' });
  });

  it('fails loudly if the compare-and-set lost the item under the lock', async () => {
    mockTx.depositItem.updateMany.mockResolvedValue({ count: 0 });
    // Not an HttpError: the ingest classifies it as transient, and the retry
    // finds the item already processed.
    await expect(run()).rejects.toThrow('DEPOSIT_ITEM_CHANGED');
    expect(credit.creditReward).not.toHaveBeenCalled();
  });
});

describe('handleItemRejected (M04 fix round 1, C2)', () => {
  const pendingItem = (extra: Record<string, unknown> = {}) => ({
    sessionId: 's1', status: 'PENDING', acceptanceEventId: null, validationReasonCode: null, session: { userId: 'u1' }, ...extra,
  });
  const reject = (sessionId: string | null = 's1') =>
    handleItemRejected(mockTx, { sessionId, depositItemId: 'd1', reason: 'ABNORMAL_ITEM_WEIGHT' });

  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.depositItem.findUnique.mockResolvedValue(pendingItem());
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'PROCESSING_ITEM' });
    mockTx.depositItem.updateMany.mockResolvedValue({ count: 1 });
    mockTx.rewardLedger.count.mockResolvedValue(0);
    vi.mocked(machineState.transitionSession).mockReturnValue('ACTIVE' as any);
  });

  it('locks User -> DepositSession -> DepositItem, then rejects a pending item by compare-and-set', async () => {
    await reject();
    const order = [locks.lockUser, locks.lockDepositSession, locks.lockDepositItem]
      .map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(locks.lockUser).toHaveBeenCalledWith(mockTx, 'u1');
    expect(mockTx.depositItem.findUnique.mock.invocationCallOrder.at(-1)).toBeGreaterThan(order[2]);
    expect(mockTx.depositSession.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { status: 'ACTIVE' } });
    expect(mockTx.depositItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', status: { in: ['PENDING', 'REVIEW'] }, acceptanceEventId: null },
      data: { status: 'REJECTED', validationReasonCode: 'ABNORMAL_ITEM_WEIGHT' },
    });
  });

  it('never flips an accepted, rejected, reviewed or already priced item, nor one with money', async () => {
    for (const extra of [
      { status: 'ACCEPTED' }, { status: 'REJECTED' }, { status: 'REVIEW', acceptanceEventId: 'evt0' },
      { status: 'ACCEPTED', validationReasonCode: 'REVIEW_APPROVED' },
    ]) {
      mockTx.depositItem.findUnique.mockResolvedValue(pendingItem(extra));
      await reject();
    }
    mockTx.depositItem.findUnique.mockResolvedValue(pendingItem({ status: 'REVIEW' }));
    mockTx.rewardLedger.count.mockResolvedValue(1);
    await reject();
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing for an unknown item and skips the session step without a sessionId', async () => {
    mockTx.depositItem.findUnique.mockResolvedValueOnce(null);
    await reject();
    expect(locks.lockUser).not.toHaveBeenCalled();
    await reject(null);
    expect(mockTx.depositSession.update).not.toHaveBeenCalled();
    expect(mockTx.depositItem.updateMany).toHaveBeenCalledTimes(1);
  });
});

describe('recordItemEvidence (M04 fix round 2, A3)', () => {
  const ref = (extra: Record<string, unknown> = {}) => ({
    sessionId: 's1', status: 'PENDING', acceptanceEventId: null, session: { userId: 'u1' }, ...extra,
  });
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.depositItem.findUnique.mockResolvedValue(ref());
    mockTx.depositItem.updateMany.mockResolvedValue({ count: 1 });
  });

  it('locks User -> DepositSession -> DepositItem, then writes measurements only to an undecided item', async () => {
    expect(await recordItemEvidence(mockTx, 'd1', { kind: 'MEASUREMENT', data: { measuredWeightGrams: 40 } })).toBe(true);
    const order = [locks.lockUser, locks.lockDepositSession, locks.lockDepositItem]
      .map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(locks.lockUser).toHaveBeenCalledWith(mockTx, 'u1');
    expect(mockTx.depositItem.findUnique.mock.invocationCallOrder.at(-1)).toBeGreaterThan(order[2]);
    expect(mockTx.depositItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', acceptanceEventId: null, status: { in: ['PENDING', 'REVIEW'] } },
      data: { measuredWeightGrams: 40 },
    });
  });

  it('never rewrites the evidence of an accepted, held, rejected or reviewed item', async () => {
    for (const extra of [
      { status: 'ACCEPTED', acceptanceEventId: 'e1' }, { status: 'REVIEW', acceptanceEventId: 'e1' },
      { status: 'REJECTED' }, { status: 'ACCEPTED' },
    ]) {
      mockTx.depositItem.findUnique.mockResolvedValue(ref(extra));
      expect(await recordItemEvidence(mockTx, 'd1', { kind: 'MEASUREMENT', data: { measuredWeightGrams: 950 } })).toBe(false);
    }
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();
  });

  it('records compaction only after acceptance, and never on a rejected item', async () => {
    expect(await recordItemEvidence(mockTx, 'd1', { kind: 'COMPACTION', data: { compactionStatus: 'COMPACTED' } })).toBe(false);
    mockTx.depositItem.findUnique.mockResolvedValue(ref({ status: 'REJECTED', acceptanceEventId: 'e1' }));
    expect(await recordItemEvidence(mockTx, 'd1', { kind: 'COMPACTION', data: { compactionStatus: 'COMPACTED' } })).toBe(false);
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();
    mockTx.depositItem.findUnique.mockResolvedValue(ref({ status: 'REVIEW', acceptanceEventId: 'e1' }));
    expect(await recordItemEvidence(mockTx, 'd1', { kind: 'COMPACTION', data: { compactionStatus: 'COMPACTED' } })).toBe(true);
    expect(mockTx.depositItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'd1', acceptanceEventId: { not: null }, status: { not: 'REJECTED' } },
      data: { compactionStatus: 'COMPACTED' },
    });
  });

  it('does nothing for an unknown item', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(null);
    expect(await recordItemEvidence(mockTx, 'd1', { kind: 'MEASUREMENT', data: { barcodeValue: 'x' } })).toBe(false);
    expect(locks.lockUser).not.toHaveBeenCalled();
  });
});

