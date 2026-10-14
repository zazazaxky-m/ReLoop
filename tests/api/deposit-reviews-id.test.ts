import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PATCH } from '@/app/api/deposit-reviews/[id]/route';
import { planReviewSettlement } from '@/lib/deposit-review';
import { prisma } from '@/lib/prisma';
import * as audit from '@/lib/audit';
import * as locks from '@/lib/db-locks';
import * as credit from '@/lib/reward-credit';
import * as rbac from '@/lib/rbac';
import * as reward from '@/lib/reward';

vi.mock('@/lib/prisma', () => ({
  prisma: { depositItem: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  assertOrgScope: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/db-locks', () => ({
  lockUser: vi.fn(),
  lockMachine: vi.fn(),
  lockDepositSession: vi.fn(),
  lockDepositItem: vi.fn(),
}));
vi.mock('@/lib/wallet-service', () => ({
  runWalletTransaction: vi.fn((fn: (tx: unknown) => unknown) => fn(mockTx)),
  afterCommitSafely: vi.fn(async (_label: string, effect: () => Promise<unknown>) => { await effect(); }),
}));
vi.mock('@/lib/reward-credit', () => ({ applyRewardEffect: vi.fn() }));
vi.mock('@/lib/reward', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/reward')>();
  return {
    validateWeight: original.validateWeight,
    rateWindowContains: original.rateWindowContains,
    resolveRewardRate: vi.fn(),
    computeRewardAmount: vi.fn(),
    computeWeightBasedRewardAmount: vi.fn(),
  };
});

const mockTx = {
  depositItem: { findUnique: vi.fn(), updateMany: vi.fn() },
  wasteType: { findUnique: vi.fn() },
  rewardRate: { findUnique: vi.fn() },
  rewardLedger: { findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  rewardReconciliationCase: { findUnique: vi.fn() },
} as any;

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });
const makeReq = (body: unknown) => new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) });
const patch = (body: unknown) => PATCH(makeReq(body), makeParams('di1'));
const admin = { id: 'a1', role: 'ADMIN', organizationId: 'org1' };

const ref = { id: 'di1', sessionId: 's1', session: { userId: 'u1', machineId: 'm1', machine: { organizationId: 'org1' } } };
const ACCEPTED_AT = new Date('2026-10-01T08:00:00.000Z');
const CREATED_AT = new Date('2026-10-01T07:59:00.000Z');
const lockedItem = (extra: Record<string, unknown> = {}) => ({
  id: 'di1', sessionId: 's1', status: 'REVIEW', wasteTypeId: 'wt1', quantity: 1, measuredWeightGrams: 25,
  validationReasonCode: 'REVERSE_MOTION', acceptedAt: ACCEPTED_AT, createdAt: CREATED_AT,
  // Passed the acceptance point (fix round 3, R1); no rate recorded there (type defaults).
  acceptanceEventId: 'evt1', rewardRateId: null,
  wasteType: { id: 'wt1', name: 'Plastik', defaultRewardPerItem: 100, unit: 'ITEM', organizationId: null,
    minWeightGrams: null, maxWeightGrams: null },
  session: {
    id: 's1', userId: 'u1', machineId: 'm1', campaignId: null, campaign: null, status: 'ACTIVE',
    machine: { id: 'm1', organizationId: 'org1', organization: { machineRewardMode: 'MONEY_REWARD' } },
  },
  ...extra,
});
const endedSession = (status = 'COMPLETED') => ({ ...lockedItem().session, status });
const superadmin = { id: 'sa1', role: 'SUPERADMIN', organizationId: null };
const LEGACY_ROW =
  'Catatan penerimaan mesin untuk item ini tidak ada atau tidak lengkap, dan mesin tidak akan melengkapinya lagi. ' +
  'Hanya superadmin yang dapat menyetujuinya sebagai setoran lama, atau tolak item ini.';
const NOT_ACCEPTED =
  'Item belum melewati titik penerimaan mesin. Tunggu hingga mesin menyelesaikan setoran, atau tolak item ini.';
const pendingEarn = { id: 'le1', entryType: 'EARN', status: 'PENDING', amount: 50, userId: 'u1' };
const effect = () => vi.mocked(credit.applyRewardEffect).mock.calls[0]?.[1];

describe('/api/deposit-reviews/[id] PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rbac.requireApiUser).mockResolvedValue(admin as any);
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue(ref as any);
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem());
    mockTx.depositItem.updateMany.mockResolvedValue({ count: 1 });
    mockTx.rewardLedger.findMany.mockResolvedValue([pendingEarn]);
    mockTx.rewardLedger.updateMany.mockResolvedValue({ count: 1 });
    mockTx.rewardLedger.findUnique.mockResolvedValue(null);
    mockTx.rewardReconciliationCase.findUnique.mockResolvedValue(null);
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ id: 'rr1', pointsPerItem: 100, unit: 'ITEM' } as any);
    vi.mocked(reward.computeRewardAmount).mockReturnValue(100);
    vi.mocked(credit.applyRewardEffect).mockResolvedValue({ outcome: 'CREDITED', entry: { id: 'adj1' }, reconciliationCase: null } as any);
  });

  it('returns 403 when not authorized', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    expect((await patch({ action: 'reject' })).status).toBe(403);
  });

  it('returns 422 for an invalid body before touching the database', async () => {
    expect((await patch({ action: 'pay-twice' })).status).toBe(422);
    expect((await patch({ action: 'approve', quantity: 1.5 })).status).toBe(422);
    expect(prisma.depositItem.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when the item does not exist', async () => {
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue(null);
    expect((await patch({ action: 'reject' })).status).toBe(404);
  });

  it('checks the organization scope from the immutable relations before locking', async () => {
    vi.mocked(rbac.assertOrgScope).mockImplementationOnce(() => { throw new (rbac as any).HttpError(403, 'Di luar scope organisasi Anda'); });
    expect((await patch({ action: 'reject' })).status).toBe(403);
    expect(locks.lockUser).not.toHaveBeenCalled();
  });

  it('locks User -> Machine -> DepositSession -> DepositItem and only then re-reads the item and its earnings', async () => {
    await patch({ action: 'approve' });
    const order = [locks.lockUser, locks.lockMachine, locks.lockDepositSession, locks.lockDepositItem]
      .map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(locks.lockUser).toHaveBeenCalledWith(mockTx, 'u1');
    expect(locks.lockMachine).toHaveBeenCalledWith(mockTx, 'm1');
    expect(locks.lockDepositSession).toHaveBeenCalledWith(mockTx, 's1');
    expect(locks.lockDepositItem).toHaveBeenCalledWith(mockTx, 'di1');
    expect(mockTx.depositItem.findUnique.mock.invocationCallOrder[0]).toBeGreaterThan(order[3]);
    expect(mockTx.rewardLedger.findMany.mock.invocationCallOrder[0]).toBeGreaterThan(order[3]);
  });

  it('approves with a compare-and-set, releases the hold and pays target minus committed once', async () => {
    const res = await patch({ action: 'approve', note: 'ok' });
    expect(res.status).toBe(200);
    expect(mockTx.depositItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'di1', status: 'REVIEW' },
      data: expect.objectContaining({ status: 'ACCEPTED', rewardAmount: 100, validationReasonCode: 'REVIEW_APPROVED' }),
    });
    expect(mockTx.rewardLedger.updateMany).toHaveBeenCalledWith({ where: { id: 'le1', status: 'PENDING' }, data: { status: 'AVAILABLE' } });
    expect(effect()).toEqual(expect.objectContaining({
      businessKey: 'review:di1:decision:v1', userId: 'u1', organizationId: 'org1', amount: 50, entryType: 'ADJUST',
      status: 'AVAILABLE', reasonCode: 'REVIEW_ADJUSTMENT', referenceType: 'DepositItem', referenceId: 'di1', actorId: 'a1' }));
    const body = await res.json();
    expect(body).toMatchObject({ idempotent: false, reconciliationCase: null });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEPOSIT_REVIEW_APPROVED' }));
  });

  it('returns 409 if the compare-and-set loses (nothing is paid)', async () => {
    mockTx.depositItem.updateMany.mockResolvedValue({ count: 0 });
    expect((await patch({ action: 'approve' })).status).toBe(409);
    expect(credit.applyRewardEffect).not.toHaveBeenCalled();
  });

  it('pays nothing and rejects the hold in a COMPLIANCE_ONLY campaign (LOG-04)', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ session: { ...lockedItem().session, campaignId: 'c1',
      campaign: { campaignType: 'MACHINE_DEPOSIT', rewardMode: 'COMPLIANCE_ONLY', supportsMachine: false, rewardMultiplier: 2 } } }));
    expect((await patch({ action: 'approve' })).status).toBe(200);
    expect(mockTx.depositItem.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'ACCEPTED', rewardAmount: 0 });
    expect(mockTx.rewardLedger.updateMany).toHaveBeenCalledWith({ where: { id: 'le1', status: 'PENDING' }, data: { status: 'REJECTED' } });
    expect(credit.applyRewardEffect).not.toHaveBeenCalled();
  });

  it('rejects: the hold is rejected, an available earning is reversed under the decision key', async () => {
    expect((await patch({ action: 'reject' })).status).toBe(200);
    expect(mockTx.depositItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'di1', status: 'REVIEW' },
      data: { status: 'REJECTED', rewardAmount: 0, validationReasonCode: 'REVIEW_REJECTED' },
    });
    expect(mockTx.rewardLedger.updateMany).toHaveBeenCalledWith({ where: { id: 'le1', status: 'PENDING' }, data: { status: 'REJECTED' } });
    expect(credit.applyRewardEffect).not.toHaveBeenCalled();

    vi.clearAllMocks();
    vi.mocked(rbac.requireApiUser).mockResolvedValue(admin as any);
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue(ref as any);
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem());
    mockTx.depositItem.updateMany.mockResolvedValue({ count: 1 });
    mockTx.rewardLedger.findMany.mockResolvedValue([{ ...pendingEarn, status: 'AVAILABLE', amount: 100 }]);
    vi.mocked(credit.applyRewardEffect).mockResolvedValue({ outcome: 'CREDITED', entry: { id: 'rev1' }, reconciliationCase: null } as any);
    expect((await patch({ action: 'reject' })).status).toBe(200);
    expect(effect()).toMatchObject({ amount: -100, entryType: 'REVERSE', reasonCode: 'REVIEW_REJECTED', businessKey: 'review:di1:decision:v1' });
  });

  it('reports the reconciliation case when a correction cannot be applied', async () => {
    mockTx.rewardLedger.findMany.mockResolvedValue([{ ...pendingEarn, status: 'AVAILABLE', amount: 100 }]);
    vi.mocked(credit.applyRewardEffect).mockResolvedValue({ outcome: 'CASE_OPENED', entry: null,
      reconciliationCase: { id: 'case1', reasonCode: 'ANOMALY_ALREADY_PAID_OUT', amount: 100, status: 'OPEN' } } as any);
    const res = await patch({ action: 'reject' });
    expect(res.status).toBe(200);
    expect((await res.json()).reconciliationCase).toMatchObject({ id: 'case1', amount: 100 });
  });

  it('a repeated identical decision is idempotent; a different one is 409', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ status: 'ACCEPTED', validationReasonCode: 'REVIEW_APPROVED' }));
    const same = await patch({ action: 'approve', quantity: 1 });
    expect(same.status).toBe(200);
    expect((await same.json()).idempotent).toBe(true);
    for (const body of [{ action: 'reject' }, { action: 'approve', quantity: 2 }, { action: 'approve', wasteTypeId: 'wt9' }]) {
      const conflict = await patch(body);
      expect(conflict.status).toBe(409);
      expect((await conflict.json()).error).toBe('Item sudah ditinjau dengan keputusan lain');
    }
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();
    expect(mockTx.rewardLedger.updateMany).not.toHaveBeenCalled();
    expect(credit.applyRewardEffect).not.toHaveBeenCalled();
    expect(audit.logAudit).not.toHaveBeenCalled();
  });

  it('returns 409 for an item that left review without a review decision', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ status: 'ACCEPTED', validationReasonCode: 'ACCEPTED' }));
    const res = await patch({ action: 'reject' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Item sudah berstatus ACCEPTED, tidak lagi menunggu peninjauan');
  });

  it('refuses the fallback (unknown) waste type as an approval target (A1)', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ validationReasonCode: 'UNKNOWN_WASTE_TYPE' }));
    mockTx.wasteType.findUnique.mockResolvedValue({ id: 'wt-unknown', name: 'Tidak Diketahui (Unknown)', organizationId: null, unit: 'ITEM', defaultRewardPerItem: 500 });
    const res = await patch({ action: 'approve', wasteTypeId: 'wt-unknown' });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Jenis sampah cadangan tidak dapat disetujui. Pilih jenis sampah yang sebenarnya.');
    // An item still typed as the fallback (reason overwritten) cannot be approved on its own type either.
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ wasteTypeId: 'wt-unknown',
      wasteType: { id: 'wt-unknown', name: 'Tidak Diketahui (Unknown)', organizationId: null, unit: 'ITEM', defaultRewardPerItem: 500 } }));
    expect((await patch({ action: 'approve', wasteTypeId: 'wt-unknown' })).status).toBe(422);
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();
    expect(credit.applyRewardEffect).not.toHaveBeenCalled();
  });

  it('validates the weight against the assigned type window: missing or out of range is 422 (A2)', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ measuredWeightGrams: null }));
    const missing = await patch({ action: 'approve' });
    expect(missing.status).toBe(422);
    expect((await missing.json()).error).toBe('Berat setoran tidak tercatat. Item tanpa berat tidak dapat disetujui; tolak item ini.');

    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ measuredWeightGrams: 500, rewardRateId: 'rr1' }));
    mockTx.rewardRate.findUnique.mockResolvedValue({ id: 'rr1', wasteTypeId: 'wt1', pointsPerItem: 100, unit: 'ITEM', minWeightGrams: 10, maxWeightGrams: 100,
      effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), effectiveTo: null });
    const heavy = await patch({ action: 'approve' });
    expect(heavy.status).toBe(422);
    expect((await heavy.json()).error).toBe('Berat setoran di luar batas jenis sampah yang dipilih. Tolak item ini atau pilih jenis sampah yang sesuai.');
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();

    // The type window applies when the rate has none; rejecting such an item still works.
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ measuredWeightGrams: 5,
      wasteType: { ...lockedItem().wasteType, minWeightGrams: 10, maxWeightGrams: 100 } }));
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ id: 'rr1', pointsPerItem: 100, unit: 'ITEM' } as any);
    expect((await patch({ action: 'approve' })).status).toBe(422);
    expect((await patch({ action: 'reject' })).status).toBe(200);
  });

  it('approves only items that passed the acceptance point; they can always be rejected (R1)', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ acceptanceEventId: null }));
    const early = await patch({ action: 'approve' });
    expect(early.status).toBe(409);
    expect((await early.json()).error).toBe(
      'Item belum melewati titik penerimaan mesin. Tunggu hingga mesin menyelesaikan setoran, atau tolak item ini.');
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();
    expect(credit.applyRewardEffect).not.toHaveBeenCalled();
    expect((await patch({ action: 'reject' })).status).toBe(200);
  });

  it('validates and prices against the rate recorded at acceptance, not the current one (R2)', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ rewardRateId: 'rr-acc', measuredWeightGrams: 50 }));
    mockTx.rewardRate.findUnique.mockResolvedValue({ id: 'rr-acc', wasteTypeId: 'wt1', pointsPerItem: 100, unit: 'ITEM', minWeightGrams: 10, maxWeightGrams: 100,
      effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), effectiveTo: null });
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ id: 'rr-now', pointsPerItem: 300, unit: 'ITEM', minWeightGrams: 60, maxWeightGrams: 100 } as any);
    expect((await patch({ action: 'approve' })).status).toBe(200);
    expect(mockTx.rewardRate.findUnique).toHaveBeenCalledWith({ where: { id: 'rr-acc' } });
    expect(reward.resolveRewardRate).not.toHaveBeenCalled();
    expect(reward.computeRewardAmount).toHaveBeenCalledWith(100, 1, 1);
    expect(mockTx.depositItem.updateMany.mock.calls[0][0].data).toMatchObject({ rewardRateId: 'rr-acc' });
  });

  it('a reclassified item is priced from the rate in effect at its acceptance (R2)', async () => {
    const acceptedAt = new Date('2026-10-01T08:00:00.000Z');
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ rewardRateId: 'rr-acc', acceptedAt }));
    mockTx.wasteType.findUnique.mockResolvedValue({ id: 'wt2', name: 'Kaca', organizationId: null, unit: 'ITEM', defaultRewardPerItem: 5 });
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ id: 'rr-wt2', pointsPerItem: 200, unit: 'ITEM' } as any);
    expect((await patch({ action: 'approve', wasteTypeId: 'wt2' })).status).toBe(200);
    expect(mockTx.rewardRate.findUnique).not.toHaveBeenCalled();
    expect(reward.resolveRewardRate).toHaveBeenCalledWith(
      { organizationId: 'org1', campaignId: null, wasteTypeId: 'wt2', now: acceptedAt }, mockTx);
  });

  it('uses the recorded rate only when its window contains acceptedAt; otherwise resolves at acceptedAt (N1)', async () => {
    // Recorded (legacy, mis-recorded by the old spread query): active but expired before acceptance.
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ rewardRateId: 'rr-expired', measuredWeightGrams: 50 }));
    mockTx.rewardRate.findUnique.mockResolvedValue({ id: 'rr-expired', wasteTypeId: 'wt1', pointsPerItem: 900, unit: 'ITEM', active: true,
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), effectiveTo: new Date('2026-09-01T00:00:00.000Z') });
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ id: 'rr-fixed', pointsPerItem: 100, unit: 'ITEM' } as any);
    expect((await patch({ action: 'approve' })).status).toBe(200);
    expect(reward.resolveRewardRate).toHaveBeenCalledWith(
      { organizationId: 'org1', campaignId: null, wasteTypeId: 'wt1', now: ACCEPTED_AT }, mockTx);
    expect(reward.computeRewardAmount).toHaveBeenCalledWith(100, 1, 1);
    expect(mockTx.depositItem.updateMany.mock.calls[0][0].data).toMatchObject({ rewardRateId: 'rr-fixed', acceptedAt: ACCEPTED_AT });

    // A recorded rate whose window contains acceptedAt is used even when it was deactivated since.
    vi.clearAllMocks();
    vi.mocked(rbac.requireApiUser).mockResolvedValue(admin as any);
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue(ref as any);
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ rewardRateId: 'rr-acc', measuredWeightGrams: 50 }));
    mockTx.depositItem.updateMany.mockResolvedValue({ count: 1 });
    mockTx.rewardLedger.findMany.mockResolvedValue([pendingEarn]);
    mockTx.rewardLedger.updateMany.mockResolvedValue({ count: 1 });
    vi.mocked(credit.applyRewardEffect).mockResolvedValue({ outcome: 'CREDITED', entry: { id: 'adj1' }, reconciliationCase: null } as any);
    mockTx.rewardRate.findUnique.mockResolvedValue({ id: 'rr-acc', wasteTypeId: 'wt1', pointsPerItem: 100, unit: 'ITEM', active: false,
      effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), effectiveTo: null });
    vi.mocked(reward.computeRewardAmount).mockReturnValue(100);
    expect((await patch({ action: 'approve' })).status).toBe(200);
    expect(reward.resolveRewardRate).not.toHaveBeenCalled();
    expect(mockTx.depositItem.updateMany.mock.calls[0][0].data).toMatchObject({ rewardRateId: 'rr-acc' });
  });

  it('fails closed when an acceptance event has no acceptance time: a legacy row, never priced at approval time (N4)', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ acceptedAt: null, session: endedSession() }));
    const res = await patch({ action: 'approve' });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(LEGACY_ROW);
    expect(reward.resolveRewardRate).not.toHaveBeenCalled();
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();
    expect(credit.applyRewardEffect).not.toHaveBeenCalled();
    expect((await patch({ action: 'reject' })).status).toBe(200);
  });

  it('a pre-acceptance row in an ended session is a legacy row: the 409 never says to wait (N2)', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ acceptanceEventId: null, session: endedSession('EXPIRED') }));
    const ended = await patch({ action: 'approve' });
    expect(ended.status).toBe(409);
    expect((await ended.json()).error).toBe(LEGACY_ROW);
    // While the session runs, the machine may still accept the item.
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ acceptanceEventId: null, session: endedSession('PROCESSING_ITEM') }));
    const open = await patch({ action: 'approve' });
    expect(open.status).toBe(409);
    expect((await open.json()).error).toBe(NOT_ACCEPTED);
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();
  });

  it('legacy approval is superadmin-only, audited, and priced at the recorded time with the fixed query (N2)', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ acceptanceEventId: null, acceptedAt: null, session: endedSession() }));
    const forbidden = await patch({ action: 'approve', legacy: true });
    expect(forbidden.status).toBe(403);
    expect((await forbidden.json()).error).toBe('Persetujuan setoran lama hanya dapat dilakukan oleh superadmin.');
    expect(locks.lockUser).not.toHaveBeenCalled();

    vi.mocked(rbac.requireApiUser).mockResolvedValue(superadmin as any);
    // Without the explicit flag a superadmin gets the same 409 as an admin.
    const implicit = await patch({ action: 'approve' });
    expect(implicit.status).toBe(409);
    expect((await implicit.json()).error).toBe(LEGACY_ROW);

    const res = await patch({ action: 'approve', legacy: true, note: 'sesi lama' });
    expect(res.status).toBe(200);
    expect(reward.resolveRewardRate).toHaveBeenCalledWith(
      { organizationId: 'org1', campaignId: null, wasteTypeId: 'wt1', now: CREATED_AT }, mockTx);
    expect(mockTx.depositItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'di1', status: 'REVIEW' },
      data: expect.objectContaining({ status: 'ACCEPTED', rewardAmount: 100, validationReasonCode: 'REVIEW_APPROVED',
        acceptanceEventId: 'legacy-approval:sa1', acceptedAt: CREATED_AT }),
    });
    expect(effect()).toEqual(expect.objectContaining({ businessKey: 'review:di1:decision:v1', amount: 50, entryType: 'ADJUST', actorId: 'sa1' }));
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DEPOSIT_REVIEW_APPROVED',
      metadata: expect.objectContaining({ legacyApproval: true, pricedAt: CREATED_AT.toISOString(), sessionStatus: 'COMPLETED', measuredWeightGrams: 25 }),
    }));
    const body = await res.json();
    expect(body).toMatchObject({ idempotent: false, targetAmount: 100 });
  });

  it('legacy approval keeps a real acceptance event id and refuses open sessions and ordinary rows (N2, N4)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue(superadmin as any);
    // N4 row: the acceptance event exists but recorded no time; the marker never overwrites the event id.
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ acceptedAt: null, session: endedSession('CANCELLED') }));
    expect((await patch({ action: 'approve', legacy: true })).status).toBe(200);
    expect(reward.resolveRewardRate).toHaveBeenCalledWith(expect.objectContaining({ now: CREATED_AT }), mockTx);
    expect(mockTx.depositItem.updateMany.mock.calls[0][0].data).toMatchObject({ acceptanceEventId: 'evt1', acceptedAt: CREATED_AT });

    vi.clearAllMocks();
    vi.mocked(rbac.requireApiUser).mockResolvedValue(superadmin as any);
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue(ref as any);
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ acceptanceEventId: null, session: endedSession('REVIEW') }));
    const open = await patch({ action: 'approve', legacy: true });
    expect(open.status).toBe(409);
    expect((await open.json()).error).toBe(
      'Sesi setoran ini masih berjalan. Tunggu hingga sesi berakhir sebelum menyetujuinya sebagai setoran lama, atau tolak item ini.');

    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem());
    const ordinary = await patch({ action: 'approve', legacy: true });
    expect(ordinary.status).toBe(422);
    expect((await ordinary.json()).error).toBe('Item ini sudah tercatat diterima mesin. Gunakan persetujuan biasa.');
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();
    expect(credit.applyRewardEffect).not.toHaveBeenCalled();
  });

  it('requires a valid replacement waste type for unknown items', async () => {
    mockTx.depositItem.findUnique.mockResolvedValue(lockedItem({ validationReasonCode: 'UNKNOWN_WASTE_TYPE' }));
    expect((await patch({ action: 'approve' })).status).toBe(422);
    mockTx.wasteType.findUnique.mockResolvedValue(null);
    expect((await patch({ action: 'approve', wasteTypeId: 'missing' })).status).toBe(422);
    mockTx.wasteType.findUnique.mockResolvedValue({ id: 'wt2', organizationId: 'other-org', unit: 'ITEM', defaultRewardPerItem: 5 });
    expect((await patch({ action: 'approve', wasteTypeId: 'wt2' })).status).toBe(422);
    expect(mockTx.depositItem.updateMany).not.toHaveBeenCalled();

    mockTx.wasteType.findUnique.mockResolvedValue({ id: 'wt2', organizationId: null, unit: 'KG', defaultRewardPerItem: 5 });
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ id: 'rr2', pointsPerItem: 10, unit: 'KG' } as any);
    vi.mocked(reward.computeWeightBasedRewardAmount).mockReturnValue(15);
    expect((await patch({ action: 'approve', wasteTypeId: 'wt2' })).status).toBe(200);
    expect(reward.computeWeightBasedRewardAmount).toHaveBeenCalled();
    expect(mockTx.depositItem.updateMany.mock.calls[0][0].data).toMatchObject({ wasteTypeId: 'wt2', rewardAmount: 15, rewardRateId: 'rr2' });
  });
});

describe('planReviewSettlement', () => {
  const row = (id: string, entryType: string, status: string, amount: number) => ({ id, entryType, status, amount }) as any;

  it('approve: releases holds and adjusts to the target over every committed row', () => {
    expect(planReviewSettlement({ action: 'approve', targetAmount: 300, rows: [
      row('e', 'EARN', 'PENDING', 50), row('a', 'ADJUST', 'AVAILABLE', 20), row('x', 'EARN', 'REVERSED', 999),
    ] })).toEqual({ releaseIds: ['e'], rejectIds: [], delta: 230, entryType: 'ADJUST', reasonCode: 'REVIEW_ADJUSTMENT' });
  });

  it('approve without any earning creates the EARN; with target 0 it rejects holds', () => {
    expect(planReviewSettlement({ action: 'approve', targetAmount: 100, rows: [] }))
      .toEqual({ releaseIds: [], rejectIds: [], delta: 100, entryType: 'EARN', reasonCode: 'REVIEW_APPROVED' });
    expect(planReviewSettlement({ action: 'approve', targetAmount: 0, rows: [row('e', 'EARN', 'PENDING', 50)] }))
      .toEqual({ releaseIds: [], rejectIds: ['e'], delta: 0, entryType: null, reasonCode: null });
    expect(planReviewSettlement({ action: 'approve', targetAmount: 40, rows: [row('e', 'EARN', 'AVAILABLE', 100)] }))
      .toEqual({ releaseIds: [], rejectIds: [], delta: -60, entryType: 'ADJUST', reasonCode: 'REVIEW_ADJUSTMENT' });
  });

  it('reject: removes holds and reverses whatever is still committed', () => {
    expect(planReviewSettlement({ action: 'reject', targetAmount: 0, rows: [
      row('e', 'EARN', 'AVAILABLE', 100), row('a', 'ADJUST', 'AVAILABLE', -10),
    ] })).toEqual({ releaseIds: [], rejectIds: [], delta: -90, entryType: 'REVERSE', reasonCode: 'REVIEW_REJECTED' });
    expect(planReviewSettlement({ action: 'reject', targetAmount: 0, rows: [row('e', 'EARN', 'PENDING', 50)] }))
      .toEqual({ releaseIds: [], rejectIds: ['e'], delta: 0, entryType: null, reasonCode: null });
  });
});
