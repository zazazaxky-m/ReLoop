import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as locks from '@/lib/db-locks';
import * as ledger from '@/lib/ledger';
import * as funding from '@/lib/reward-funding';
import {
  CASE_ALREADY_PAID_OUT,
  CASE_RECIPIENT_ERASED,
  REWARD_KEY_CONFLICT,
  applyRewardEffect,
  checkRewardFunding,
  creditReward,
  type CreditRewardInput,
} from '@/lib/reward-credit';

vi.mock('@/lib/db-locks', () => ({ lockUser: vi.fn() }));
vi.mock('@/lib/ledger', () => ({ getWalletBalance: vi.fn() }));
vi.mock('@/lib/reward-funding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reward-funding')>()),
  resolveSourceReservation: vi.fn(async () => ({ kind: 'LEGACY_SOURCE', cutover: { at: new Date(), source: 'migration' } })),
  commitRewardAgainstBudget: vi.fn(async () => ({ commitId: 'c1', covered: 100, uncovered: 0, existing: false })),
}));
vi.mock('@/lib/rbac', () => ({
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const mockTx = {
  rewardLedger: { findUnique: vi.fn(), create: vi.fn() },
  rewardReconciliationCase: { findUnique: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn() },
  erasureJobStep: { findFirst: vi.fn() },
} as any;

const earn: CreditRewardInput = {
  businessKey: 'deposit-item:d1:earn', userId: 'u1', organizationId: 'o1', campaignId: null, amount: 100,
  status: 'AVAILABLE', reasonCode: 'ACCEPTED', referenceType: 'DepositItem', referenceId: 'd1',
  depositItemId: 'd1', sessionId: 's1',
};

describe('creditReward / applyRewardEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTx.rewardLedger.findUnique.mockResolvedValue(null);
    mockTx.rewardLedger.create.mockImplementation(async ({ data }: any) => ({ id: 'l1', ...data }));
    mockTx.rewardReconciliationCase.findUnique.mockResolvedValue(null);
    mockTx.rewardReconciliationCase.create.mockImplementation(async ({ data }: any) => ({ id: 'case1', status: 'OPEN', ...data }));
    mockTx.user.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    mockTx.erasureJobStep.findFirst.mockResolvedValue(null);
    vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 1_000 } as any);
  });

  it('writes nothing for amount 0, without even taking the lock', async () => {
    expect(await creditReward(mockTx, { ...earn, amount: 0 })).toBeNull();
    expect(await applyRewardEffect(mockTx, { ...earn, amount: 0 })).toEqual({ outcome: 'ZERO', entry: null, reconciliationCase: null });
    expect(locks.lockUser).not.toHaveBeenCalled();
    expect(mockTx.rewardLedger.create).not.toHaveBeenCalled();
  });

  it('refuses amounts that are not integer rupiah or have the wrong sign for the entry type', async () => {
    for (const input of [
      { ...earn, amount: 1.5 }, { ...earn, amount: -1 }, { ...earn, amount: 2_147_483_648 },
      { ...earn, entryType: 'REVERSE' as const, amount: 5 }, { ...earn, businessKey: '' },
    ]) {
      await expect(creditReward(mockTx, input)).rejects.toBeInstanceOf(RangeError);
    }
    expect(mockTx.rewardLedger.create).not.toHaveBeenCalled();
  });

  it('takes the User lock before reading the key, then writes one keyed row', async () => {
    const entry = await creditReward(mockTx, earn);
    expect(locks.lockUser).toHaveBeenCalledWith(mockTx, 'u1');
    expect(vi.mocked(locks.lockUser).mock.invocationCallOrder[0])
      .toBeLessThan(mockTx.rewardLedger.findUnique.mock.invocationCallOrder[0]);
    expect(mockTx.rewardLedger.create).toHaveBeenCalledWith({ data: {
      userId: 'u1', organizationId: 'o1', campaignId: null, sessionId: 's1', depositItemId: 'd1', entryType: 'EARN',
      amount: 100, status: 'AVAILABLE', reasonCode: 'ACCEPTED', referenceType: 'DepositItem', referenceId: 'd1',
      actorId: null, businessKey: 'deposit-item:d1:earn' } });
    expect(entry).toMatchObject({ id: 'l1', amount: 100 });
  });

  it('is idempotent per business key and refuses a different effect under the same key', async () => {
    mockTx.rewardLedger.findUnique.mockResolvedValue({ id: 'old', userId: 'u1', entryType: 'EARN', amount: 100 });
    expect(await applyRewardEffect(mockTx, earn)).toMatchObject({ outcome: 'EXISTING', entry: { id: 'old' } });
    for (const existing of [
      { id: 'old', userId: 'u1', entryType: 'EARN', amount: 99 },
      { id: 'old', userId: 'u2', entryType: 'EARN', amount: 100 },
      { id: 'old', userId: 'u1', entryType: 'ADJUST', amount: 100 },
    ]) {
      mockTx.rewardLedger.findUnique.mockResolvedValue(existing);
      await expect(creditReward(mockTx, earn)).rejects.toMatchObject({ status: 409, message: REWARD_KEY_CONFLICT });
    }
    expect(mockTx.rewardLedger.create).not.toHaveBeenCalled();
  });

  it('refuses to credit an erased account and records it as a case (A04)', async () => {
    mockTx.user.findUnique.mockResolvedValue({ status: 'INACTIVE' });
    mockTx.erasureJobStep.findFirst.mockResolvedValue({ id: 'step' });
    const result = await applyRewardEffect(mockTx, earn);
    expect(result.outcome).toBe('CASE_OPENED');
    expect(result.entry).toBeNull();
    expect(mockTx.erasureJobStep.findFirst).toHaveBeenCalledWith({
      where: { step: 'ANONYMIZE_ACCOUNT', completedAt: { not: null }, request: { userId: 'u1' } }, select: { id: true } });
    expect(mockTx.rewardReconciliationCase.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      businessKey: 'deposit-item:d1:earn', userId: 'u1', amount: 100, entryType: 'EARN', reasonCode: CASE_RECIPIENT_ERASED }) });
    expect(mockTx.rewardLedger.create).not.toHaveBeenCalled();
  });

  it('an INACTIVE account that was never erased is still credited', async () => {
    mockTx.user.findUnique.mockResolvedValue({ status: 'INACTIVE' });
    expect(await creditReward(mockTx, earn)).not.toBeNull();
  });

  it('never forces a debit the available balance no longer covers: it opens a case instead', async () => {
    const debit = { ...earn, businessKey: 'review:d1:decision:v1', entryType: 'REVERSE' as const, amount: -100 };
    vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 99 } as any);
    const refused = await applyRewardEffect(mockTx, debit);
    expect(refused).toMatchObject({ outcome: 'CASE_OPENED', entry: null,
      reconciliationCase: { reasonCode: CASE_ALREADY_PAID_OUT, amount: 100, entryType: 'REVERSE' } });
    expect(ledger.getWalletBalance).toHaveBeenCalledWith('u1', mockTx);
    expect(mockTx.rewardLedger.create).not.toHaveBeenCalled();

    vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 100 } as any);
    expect(await applyRewardEffect(mockTx, debit)).toMatchObject({ outcome: 'CREDITED', entry: { amount: -100 } });
  });

  it('a key already refused into a case stays refused (no ledger row, no second case)', async () => {
    mockTx.rewardReconciliationCase.findUnique.mockResolvedValue({ id: 'case0', businessKey: earn.businessKey });
    expect(await applyRewardEffect(mockTx, earn)).toMatchObject({ outcome: 'CASE_OPENED', reconciliationCase: { id: 'case0' } });
    expect(mockTx.rewardReconciliationCase.create).not.toHaveBeenCalled();
    expect(mockTx.rewardLedger.create).not.toHaveBeenCalled();
  });

  describe('reward funding (B01)', () => {
    const reservation = { id: 'res1', status: 'ACTIVE', remainingRupiah: 500, lateReservation: false } as any;
    const admitted = { kind: 'RESERVATION' as const, reservation, late: false };

    it('commits an EARN against its session reservation, keyed by the effect (never twice)', async () => {
      vi.mocked(funding.resolveSourceReservation).mockResolvedValue(admitted);
      expect(await checkRewardFunding(mockTx, earn)).toEqual({
        status: 'COMMITTED', reservationId: 'res1', commitId: 'c1', covered: 100, uncovered: 0, existing: false, late: false });
      expect(funding.resolveSourceReservation).toHaveBeenCalledWith(mockTx, { sourceType: 'SESSION', sourceId: 's1' });
      expect(funding.commitRewardAgainstBudget).toHaveBeenCalledWith(mockTx, 'res1', 'deposit-item:d1:earn', 100, { reviewPending: false });
      // The commit runs inside the same write path as the ledger row.
      await creditReward(mockTx, earn);
      expect(funding.commitRewardAgainstBudget).toHaveBeenCalledTimes(2);
      expect(mockTx.rewardLedger.create).toHaveBeenCalledTimes(1);
    });

    it('a review hold commits the approvable ceiling and is marked pending; a trip earning uses its issuance source', async () => {
      vi.mocked(funding.resolveSourceReservation).mockResolvedValue(admitted);
      const hold = { ...earn, amount: 50, status: 'PENDING' as const, funding: { ceilingRupiah: 100, reviewPending: true } };
      expect((await checkRewardFunding(mockTx, hold)).status).toBe('COMMITTED');
      expect(funding.commitRewardAgainstBudget).toHaveBeenLastCalledWith(mockTx, 'res1', 'deposit-item:d1:earn', 100, { reviewPending: true });
      // A hold whose 50% share rounds to 0 still commits its ceiling.
      const zeroHold = { ...hold, amount: 0, funding: { ceilingRupiah: 1, reviewPending: true } };
      expect(await applyRewardEffect(mockTx, zeroHold)).toEqual({ outcome: 'ZERO', entry: null, reconciliationCase: null });
      expect(locks.lockUser).toHaveBeenCalled();
      expect(funding.commitRewardAgainstBudget).toHaveBeenLastCalledWith(mockTx, 'res1', 'deposit-item:d1:earn', 1, { reviewPending: true });
      const trip = { ...earn, businessKey: 'trip:t1:return', sessionId: null, depositItemId: null, referenceType: 'Trip', referenceId: 't1' };
      expect((await checkRewardFunding(mockTx, trip)).status).toBe('COMMITTED');
      expect(funding.resolveSourceReservation).toHaveBeenLastCalledWith(mockTx, { sourceType: 'TRIP', sourceId: 't1' });
    });

    it('a source admitted without a reservation after the cutover is held late (uncovered), reported as such (I2)', async () => {
      vi.mocked(funding.resolveSourceReservation).mockResolvedValue({
        kind: 'RESERVATION', reservation: { ...reservation, id: 'late1', ceilingRupiah: 0, remainingRupiah: 0, lateReservation: true }, late: true });
      vi.mocked(funding.commitRewardAgainstBudget).mockResolvedValueOnce({ commitId: 'c9', covered: 0, uncovered: 100, existing: false });
      expect(await checkRewardFunding(mockTx, earn)).toEqual({
        status: 'COMMITTED', reservationId: 'late1', commitId: 'c9', covered: 0, uncovered: 100, existing: false, late: true });
      expect(funding.commitRewardAgainstBudget).toHaveBeenCalledWith(mockTx, 'late1', 'deposit-item:d1:earn', 100, { reviewPending: false });
    });

    it('reports a legacy source (pre-cutover, no reservation) and an effect without a source, committing nothing', async () => {
      vi.mocked(funding.resolveSourceReservation)
        .mockResolvedValueOnce({ kind: 'LEGACY_SOURCE', cutover: { at: new Date('2026-10-14T15:00:00Z'), source: 'migration' } })
        .mockResolvedValueOnce({ kind: 'NO_SOURCE' });
      expect(await checkRewardFunding(mockTx, earn)).toEqual({ status: 'NO_RESERVATION', reason: 'LEGACY_SOURCE' });
      expect(await checkRewardFunding(mockTx, earn)).toEqual({ status: 'NO_RESERVATION', reason: 'NO_SOURCE' });
      expect(await checkRewardFunding(mockTx, { ...earn, sessionId: null, referenceType: 'ManualValidation' }))
        .toEqual({ status: 'NO_RESERVATION', reason: 'NO_SOURCE' });
      expect(funding.commitRewardAgainstBudget).not.toHaveBeenCalled();
      // The ledger row is still written: funding never withholds an accepted reward.
      vi.mocked(funding.resolveSourceReservation).mockResolvedValue({ kind: 'LEGACY_SOURCE', cutover: { at: null, source: 'migration-missing' } });
      expect(await creditReward(mockTx, earn)).toMatchObject({ businessKey: 'deposit-item:d1:earn', amount: 100 });
    });

    it('leaves corrections and caller-settled effects to the review path', async () => {
      vi.mocked(funding.resolveSourceReservation).mockResolvedValue(admitted);
      expect(await checkRewardFunding(mockTx, { ...earn, entryType: 'ADJUST', amount: 50 })).toEqual({ status: 'SETTLED_BY_CALLER' });
      expect(await checkRewardFunding(mockTx, { ...earn, funding: { settledByCaller: true } })).toEqual({ status: 'SETTLED_BY_CALLER' });
      expect(await checkRewardFunding(mockTx, { ...earn, amount: 0 })).toEqual({ status: 'ZERO' });
      expect(funding.commitRewardAgainstBudget).not.toHaveBeenCalled();
    });
  });
});
