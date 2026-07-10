import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleAcceptance } from '@/lib/machine-events/acceptance';
import * as ledger from '@/lib/ledger';
import * as machineState from '@/lib/machine-state';
import * as reward from '@/lib/reward';
import { UNKNOWN_WASTE_TYPE_REASON } from '@/lib/machine-events/shared';

vi.mock('@/lib/ledger', () => ({ createEarnEntry: vi.fn() }));
vi.mock('@/lib/machine-state', () => ({
  transitionSession: vi.fn(),
  validateSensorSequence: vi.fn(),
}));
vi.mock('@/lib/reward', () => ({
  computeRewardAmount: vi.fn(),
  computeWeightBasedRewardAmount: vi.fn(),
  evaluateSensorFusion: vi.fn(),
  resolveRewardRate: vi.fn(),
}));

const mockTx = {
  depositSession: { findUnique: vi.fn(), update: vi.fn() },
  depositItem: { findUnique: vi.fn(), update: vi.fn() },
} as any;

describe('handleAcceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reward.resolveRewardRate).mockResolvedValue(null);
    vi.mocked(reward.evaluateSensorFusion).mockReturnValue({ valid: true } as any);
    vi.mocked(machineState.validateSensorSequence).mockReturnValue(null);
    vi.mocked(reward.computeRewardAmount).mockReturnValue(100);
    vi.mocked(reward.computeWeightBasedRewardAmount).mockReturnValue(200);
    vi.mocked(machineState.transitionSession).mockReturnValue('ITEM_DONE' as any);
    
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', userId: 'u1', status: 'PROCESSING_ITEM' });
    mockTx.depositItem.findUnique.mockResolvedValue({ 
      id: 'd1', wasteTypeId: 'w1', measuredWeightGrams: 50, quantity: 1, wasteType: { unit: 'pcs', defaultRewardPerItem: 10 }
    });
  });

  it('exits early if session or item not found', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue(null);
    await handleAcceptance(mockTx, { id: 'm1', organizationId: 'o1', hasCompactor: false }, 's1', 'd1', 'evt1');
    expect(mockTx.depositItem.update).not.toHaveBeenCalled();
  });

  it('handles UNKNOWN_WASTE_TYPE fallback', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue({ 
      id: 'd1', validationReasonCode: UNKNOWN_WASTE_TYPE_REASON, wasteType: { unit: 'pcs' }
    });
    
    await handleAcceptance(mockTx, { id: 'm1', organizationId: 'o1', hasCompactor: false }, 's1', 'd1', 'evt1');
    
    expect(reward.resolveRewardRate).not.toHaveBeenCalled();
    expect(mockTx.depositItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW', rewardAmount: 0 }) })
    );
    expect(ledger.createEarnEntry).not.toHaveBeenCalled(); // amount is 0
  });

  it('rejects item if sensor fusion fails', async () => {
    vi.mocked(reward.evaluateSensorFusion).mockReturnValue({ valid: false, reasonCode: 'TOO_LIGHT', wasteTypeMatch: false } as any);
    
    await handleAcceptance(mockTx, { id: 'm1', organizationId: 'o1', hasCompactor: false }, 's1', 'd1', 'evt1');
    
    expect(mockTx.depositItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED', validationReasonCode: 'TOO_LIGHT', rewardAmount: 0 }) })
    );
  });

  it('defaults fusion reason when reasonCode is missing', async () => {
    vi.mocked(reward.evaluateSensorFusion).mockReturnValue({ valid: false } as any);

    await handleAcceptance(mockTx, { id: 'm1', organizationId: 'o1', hasCompactor: false }, 's1', 'd1', 'evt1');

    expect(mockTx.depositItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ validationReasonCode: 'WEIGHT_INVALID' }),
      }),
    );
  });

  it('reviews when session is already REVIEW or external fraud is set', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({
      id: 's1',
      userId: 'u1',
      status: 'REVIEW',
      campaign: { rewardMultiplier: 2 },
    });
    mockTx.depositItem.findUnique.mockResolvedValue({
      id: 'd1',
      wasteTypeId: 'w1',
      measuredWeightGrams: 50,
      quantity: 1,
      externalFraudFlag: true,
      wasteType: { unit: 'ITEM', defaultRewardPerItem: null },
    });
    vi.mocked(reward.resolveRewardRate).mockResolvedValue(null);

    await handleAcceptance(mockTx, { id: 'm1', organizationId: 'o1', hasCompactor: false }, 's1', 'd1', 'evt1');

    expect(mockTx.depositItem.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REVIEW',
          validationReasonCode: 'ANOMALY_REVIEW',
        }),
      }),
    );
  });

  it('flags for review on sensor anomaly', async () => {
    vi.mocked(machineState.validateSensorSequence).mockReturnValue('WRONG_SEQUENCE');
    
    await handleAcceptance(mockTx, { id: 'm1', organizationId: 'o1', hasCompactor: false }, 's1', 'd1', 'evt1');
    
    expect(mockTx.depositItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVIEW', complianceMultiplier: 0.5, rewardAmount: 50 }) })
    );
    expect(ledger.createEarnEntry).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING', amount: 50 }),
      mockTx
    );
  });

  it('accepts item and updates session state', async () => {
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ pointsPerItem: 20, unit: 'pcs' } as any);
    
    await handleAcceptance(mockTx, { id: 'm1', organizationId: 'o1', hasCompactor: true }, 's1', 'd1', 'evt1');
    
    expect(mockTx.depositItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ 
        data: expect.objectContaining({ status: 'ACCEPTED', rewardAmount: 100, compactionStatus: 'PENDING' }) 
      })
    );
    expect(ledger.createEarnEntry).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'AVAILABLE', amount: 100 }),
      mockTx
    );
    expect(mockTx.depositSession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ITEM_DONE' }) })
    );
  });

  it('computes weight-based reward if unit is KG', async () => {
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ pointsPerItem: 20, unit: 'KG' } as any);
    
    await handleAcceptance(mockTx, { id: 'm1', organizationId: 'o1', hasCompactor: false }, 's1', 'd1', 'evt1');
    
    expect(reward.computeWeightBasedRewardAmount).toHaveBeenCalled();
    expect(mockTx.depositItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ rewardAmount: 200, compactionStatus: 'NOT_REQUIRED' }) })
    );
  });
});
