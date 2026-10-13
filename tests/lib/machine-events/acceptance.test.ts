import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleAcceptance } from '@/lib/machine-events/acceptance';
import * as locks from '@/lib/db-locks';
import * as credit from '@/lib/reward-credit';
import * as machineState from '@/lib/machine-state';
import * as reward from '@/lib/reward';
import { UNKNOWN_WASTE_TYPE_REASON } from '@/lib/machine-events/shared';

vi.mock('@/lib/db-locks', () => ({
  lockUser: vi.fn(),
  lockDepositSession: vi.fn(),
  lockDepositItem: vi.fn(),
}));
vi.mock('@/lib/reward-credit', () => ({ creditReward: vi.fn() }));
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
} as any;
const machine = { id: 'm1', organizationId: 'o1', hasCompactor: false };

const session = (extra: Record<string, unknown> = {}) => ({
  id: 's1', userId: 'u1', status: 'PROCESSING_ITEM', campaignId: null, campaign: null, ...extra,
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
    mockTx.machine.findUnique.mockResolvedValue({ materialVerification: 'WEIGHT_ONLY', organization: { machineRewardMode: 'MONEY_REWARD' } });
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

  it('locks User -> DepositSession -> DepositItem before reading the decision state', async () => {
    await run();
    const order = [locks.lockUser, locks.lockDepositSession, locks.lockDepositItem]
      .map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(locks.lockUser).toHaveBeenCalledWith(mockTx, 'u1');
    expect(locks.lockDepositSession).toHaveBeenCalledWith(mockTx, 's1');
    expect(locks.lockDepositItem).toHaveBeenCalledWith(mockTx, 'd1');
    const lastLock = vi.mocked(locks.lockDepositItem).mock.invocationCallOrder[0];
    expect(mockTx.machine.findUnique.mock.invocationCallOrder[0]).toBeGreaterThan(lastLock);
    expect(mockTx.depositItem.findUnique.mock.invocationCallOrder.at(-1)).toBeGreaterThan(lastLock);
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
      depositItemId: 'd1', sessionId: 's1',
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

  it('keeps the unknown-waste-type fallback in review with no reward and no rate lookup', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(item({ status: 'REVIEW', validationReasonCode: UNKNOWN_WASTE_TYPE_REASON,
      wasteType: { unit: 'ITEM', defaultRewardPerItem: null, aiAcceptedLabels: [] } }));
    vi.mocked(reward.computeRewardAmount).mockReturnValue(0);
    await run();
    expect(reward.resolveRewardRate).not.toHaveBeenCalled();
    expect(itemUpdate().data).toMatchObject({ status: 'REVIEW', validationReasonCode: UNKNOWN_WASTE_TYPE_REASON, rewardAmount: 0, complianceMultiplier: 0 });
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
