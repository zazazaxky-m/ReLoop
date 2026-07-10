import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PATCH } from '@/app/api/deposit-reviews/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as reward from '@/lib/reward';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    depositItem: { findUnique: vi.fn() },
    wasteType: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  assertOrgScope: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/ledger', () => ({
  createEarnEntry: vi.fn(),
}));
vi.mock('@/lib/reward', () => ({
  resolveRewardRate: vi.fn(),
  computeRewardAmount: vi.fn(),
  computeWeightBasedRewardAmount: vi.fn(),
}));
vi.mock('@/lib/machine-events', () => ({
  UNKNOWN_WASTE_TYPE_REASON: 'UNKNOWN_WASTE_TYPE',
}));

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });
const makeReq = (body: any) =>
  new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) });

const baseItem = {
  id: 'di1',
  status: 'REVIEW',
  wasteTypeId: 'wt1',
  wasteType: { id: 'wt1', name: 'Plastik', defaultRewardPerItem: 100, unit: 'ITEM' },
  quantity: 1,
  measuredWeightGrams: null,
  validationReasonCode: 'ANOMALY_REVIEW',
  sessionId: 's1',
  ledgerEntries: [{ id: 'le1', amount: 50, status: 'PENDING' }],
  session: {
    id: 's1',
    campaignId: 'c1',
    campaign: { rewardMultiplier: 1 },
    user: { id: 'u1' },
    machine: { organizationId: 'org1' },
  },
};

describe('/api/deposit-reviews/[id] PATCH', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not authorized', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await PATCH(makeReq({ action: 'reject' }), makeParams('di1'));
    expect(res.status).toBe(403);
  });

  it('returns 404 when item not found', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue(null);
    const res = await PATCH(makeReq({ action: 'reject' }), makeParams('di1'));
    expect(res.status).toBe(404);
  });

  it('returns 409 when item not in REVIEW status', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue({ ...baseItem, status: 'ACCEPTED' } as any);
    const res = await PATCH(makeReq({ action: 'reject' }), makeParams('di1'));
    expect(res.status).toBe(409);
  });

  it('rejects item with PENDING earn entry', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue({ ...baseItem } as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const mockTx = {
        depositItem: { update: vi.fn().mockResolvedValue({ id: 'di1', status: 'REJECTED' }) },
        rewardLedger: { update: vi.fn(), create: vi.fn() },
      };
      return fn(mockTx);
    });

    const res = await PATCH(makeReq({ action: 'reject', note: 'Spam' }), makeParams('di1'));
    expect(res.status).toBe(200);
  });

  it('rejects item with AVAILABLE earn entry (creates REVERSE)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    const itemWithAvailable = {
      ...baseItem,
      ledgerEntries: [{ id: 'le1', amount: 50, status: 'AVAILABLE' }],
    };
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue(itemWithAvailable as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const mockTx = {
        depositItem: { update: vi.fn().mockResolvedValue({ id: 'di1', status: 'REJECTED' }) },
        rewardLedger: { update: vi.fn(), create: vi.fn() },
      };
      const result = await fn(mockTx);
      expect(mockTx.rewardLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ entryType: 'REVERSE' }) }),
      );
      return result;
    });

    const res = await PATCH(makeReq({ action: 'reject' }), makeParams('di1'));
    expect(res.status).toBe(200);
  });

  it('approves normal item (releases PENDING to AVAILABLE)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue({ ...baseItem } as any);
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ id: 'rr1', pointsPerItem: 100, unit: 'ITEM' } as any);
    vi.mocked(reward.computeRewardAmount).mockReturnValue(100);

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const mockTx = {
        depositItem: { update: vi.fn().mockResolvedValue({ id: 'di1', status: 'ACCEPTED' }) },
        rewardLedger: { update: vi.fn(), create: vi.fn() },
      };
      return fn(mockTx);
    });

    const res = await PATCH(makeReq({ action: 'approve' }), makeParams('di1'));
    expect(res.status).toBe(200);
  });

  it('returns 422 when approving unknown waste type without wasteTypeId', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    const unknownItem = {
      ...baseItem,
      validationReasonCode: 'UNKNOWN_WASTE_TYPE',
      ledgerEntries: [],
    };
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue(unknownItem as any);

    const res = await PATCH(makeReq({ action: 'approve' }), makeParams('di1'));
    expect(res.status).toBe(422);
  });

  it('approves unknown waste type with reclassification', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    const unknownItem = {
      ...baseItem,
      validationReasonCode: 'UNKNOWN_WASTE_TYPE',
      ledgerEntries: [],
    };
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue(unknownItem as any);
    vi.mocked(prisma.wasteType.findUnique).mockResolvedValue({ id: 'wt2', name: 'Kaca', defaultRewardPerItem: 200, unit: 'ITEM' } as any);
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ id: 'rr1', pointsPerItem: 200, unit: 'ITEM' } as any);
    vi.mocked(reward.computeRewardAmount).mockReturnValue(200);

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const mockTx = {
        depositItem: { update: vi.fn().mockResolvedValue({ id: 'di1', status: 'ACCEPTED' }) },
        rewardLedger: { update: vi.fn(), create: vi.fn() },
      };
      return fn(mockTx);
    });

    const res = await PATCH(makeReq({ action: 'approve', wasteTypeId: 'wt2' }), makeParams('di1'));
    expect(res.status).toBe(200);
  });

  it('approves KG unit using weight-based reward', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue({
      ...baseItem,
      measuredWeightGrams: 1500,
      wasteType: { id: 'wt1', name: 'Organik', defaultRewardPerItem: 10, unit: 'KG' },
    } as any);
    vi.mocked(reward.resolveRewardRate).mockResolvedValue({ id: 'rr1', pointsPerItem: 10, unit: 'KG' } as any);
    vi.mocked(reward.computeWeightBasedRewardAmount).mockReturnValue(15);

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const mockTx = {
        depositItem: { update: vi.fn().mockResolvedValue({ id: 'di1', status: 'ACCEPTED' }) },
        rewardLedger: { update: vi.fn(), create: vi.fn() },
      };
      return fn(mockTx);
    });

    const res = await PATCH(makeReq({ action: 'approve' }), makeParams('di1'));
    expect(res.status).toBe(200);
    expect(reward.computeWeightBasedRewardAmount).toHaveBeenCalled();
    expect(reward.computeRewardAmount).not.toHaveBeenCalled();
  });

  it('returns 422 when replacement waste type is missing', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue({ ...baseItem } as any);
    vi.mocked(prisma.wasteType.findUnique).mockResolvedValue(null);

    const res = await PATCH(makeReq({ action: 'approve', wasteTypeId: 'missing' }), makeParams('di1'));
    expect(res.status).toBe(422);
  });

  it('falls back to default reward and campaign multiplier defaults', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.depositItem.findUnique).mockResolvedValue({
      ...baseItem,
      session: {
        ...baseItem.session,
        campaign: null,
      },
      wasteType: { id: 'wt1', name: 'Plastik', defaultRewardPerItem: null, unit: 'ITEM' },
    } as any);
    vi.mocked(reward.resolveRewardRate).mockResolvedValue(null);
    vi.mocked(reward.computeRewardAmount).mockReturnValue(0);

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const mockTx = {
        depositItem: { update: vi.fn().mockResolvedValue({ id: 'di1', status: 'ACCEPTED' }) },
        rewardLedger: { update: vi.fn(), create: vi.fn() },
      };
      return fn(mockTx);
    });

    const res = await PATCH(makeReq({ action: 'approve' }), makeParams('di1'));
    expect(res.status).toBe(200);
    expect(reward.computeRewardAmount).toHaveBeenCalledWith(0, 1, 1);
  });
});
