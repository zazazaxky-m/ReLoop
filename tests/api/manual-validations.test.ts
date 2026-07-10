import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/manual-validations/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as trip from '@/lib/trip';
import * as tourism from '@/lib/tourism';
import { createNotification } from '@/lib/notifications';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trip: { findUnique: vi.fn(), update: vi.fn() },
    trashBagAssignment: { findUnique: vi.fn(), update: vi.fn() },
    manualValidation: { findFirst: vi.fn(), create: vi.fn() },
    rewardLedger: { findFirst: vi.fn(), create: vi.fn() },
    travelAgentUser: { findMany: vi.fn().mockResolvedValue([]) },
    travelAgentOrganization: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  assertOrgScope: vi.fn(),
  assertActivePartnership: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/trip', () => ({
  TRASH_BAG_REWARD_PER_BAG: 2000,
  isRewardableCondition: vi.fn((s: string) => s === 'GOOD' || s === 'PARTIAL'),
  computeTrashBagRewardAmount: vi.fn(
    ({ rewardableBagCount, complianceScore, rewardMultiplier, rewardPerBag }: any) => {
      const perBag = rewardPerBag ?? 2000;
      const mult = rewardMultiplier != null && rewardMultiplier > 0 ? rewardMultiplier : 1;
      return Math.floor(rewardableBagCount * perBag * mult * (complianceScore / 100));
    },
  ),
  canValidateTripStage: vi.fn(() => ({ ok: true })),
  getTripTravelAgentGateBlockReason: vi.fn(async () => null),
}));
vi.mock('@/lib/tourism', () => ({
  calculateCompliance: vi.fn().mockReturnValue({ score: 90, status: 'COMPLIANT' }),
}));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/format', () => ({ formatRupiah: (n: number) => `Rp ${n}` }));

describe('/api/manual-validations POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(trip.canValidateTripStage).mockReturnValue({ ok: true });
    vi.mocked(trip.getTripTravelAgentGateBlockReason).mockResolvedValue(null);
    vi.mocked(tourism.calculateCompliance).mockReturnValue({
      score: 90,
      status: 'COMPLIANT',
    } as any);
  });

  const baseTrip = {
    id: 't1',
    userId: 'u1',
    travelAgentId: 'ta1',
    campaignId: 'c1',
    status: 'ACTIVE',
    groupName: 'Grup A',
    campaign: {
      organizationId: 'org1',
      rewardMode: 'MONEY_REWARD',
      campaignType: 'TRASH_BAG',
      rewardMultiplier: 1,
      name: 'Campaign A',
    },
    _count: { bagAssignments: 2 },
  };

  function mockTx(rewardExisting: any = null) {
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const mockTxClient = {
        trashBagAssignment: { update: vi.fn() },
        manualValidation: {
          create: vi.fn().mockResolvedValue({ id: 'v1' }),
        },
        trip: { update: vi.fn() },
        rewardLedger: {
          findFirst: vi.fn().mockResolvedValue(rewardExisting),
          create: vi.fn(),
        },
      };
      return fn(mockTxClient);
    });
  }

  it('returns 404 when trip not found', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1',
      role: 'ADMIN',
      organizationId: 'org1',
    } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(null);

    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ tripId: 'missing', validationStage: 'CHECK_OUT' }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it('rejects pengepul for non bank-sampah stages', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(baseTrip as any);

    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ tripId: 't1', validationStage: 'CHECK_OUT' }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it('rejects when trip stage guard fails', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1',
      role: 'ADMIN',
      organizationId: 'org1',
    } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(baseTrip as any);
    vi.mocked(trip.canValidateTripStage).mockReturnValue({
      ok: false,
      reason: 'Validasi tidak diizinkan untuk status trip ini',
    });

    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ tripId: 't1', validationStage: 'CHECK_OUT' }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it('computes reward from returnedBagCount when bags omitted', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1',
      role: 'ADMIN',
      organizationId: 'org1',
    } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(baseTrip as any);
    mockTx(null);

    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          tripId: 't1',
          validationStage: 'CHECK_OUT',
          returnedBagCount: 2,
          conditionStatus: 'GOOD',
          appCompleted: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.rewardAmount).toBeGreaterThan(0);
    expect(trip.isRewardableCondition).toHaveBeenCalledWith('GOOD');
  });

  it('notifies trip user and invited agent users after validation', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1',
      role: 'ADMIN',
      organizationId: 'org1',
    } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(baseTrip as any);
    vi.mocked(prisma.travelAgentUser.findMany).mockResolvedValue([
      { userId: 'agent-u1' },
    ] as any);
    vi.mocked(prisma.travelAgentOrganization.findMany).mockResolvedValue([
      { id: 'inv1' },
    ] as any);
    mockTx(null);

    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          tripId: 't1',
          validationStage: 'CHECK_OUT',
          returnedBagCount: 1,
          conditionStatus: 'GOOD',
          appCompleted: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', type: 'TRIP_STATUS' }),
    );
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'agent-u1', type: 'TRIP_STATUS' }),
    );
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', type: 'TRASH_BAG_REWARD' }),
    );
  });

  it('skips agent notifications when org invite is missing', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1',
      role: 'ADMIN',
      organizationId: 'org1',
    } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(baseTrip as any);
    vi.mocked(prisma.travelAgentUser.findMany).mockResolvedValue([
      { userId: 'agent-u1' },
    ] as any);
    vi.mocked(prisma.travelAgentOrganization.findMany).mockResolvedValue([]);
    mockTx({ id: 'existing' });

    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          tripId: 't1',
          validationStage: 'CHECK_IN',
          returnedBagCount: 0,
          appCompleted: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', type: 'TRIP_STATUS' }),
    );
    expect(createNotification).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'agent-u1' }),
    );
  });

  it('derives condition and rewardable count from bags array', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1',
      role: 'ADMIN',
      organizationId: 'org1',
    } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(baseTrip as any);
    mockTx(null);

    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          tripId: 't1',
          validationStage: 'CHECK_OUT',
          bags: [
            { id: 'b1', status: 'GOOD' },
            { id: 'b2', status: 'PARTIAL' },
          ],
          appCompleted: true,
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect(tourism.calculateCompliance).toHaveBeenCalledWith(
      expect.objectContaining({ conditionStatus: 'PARTIAL', returnedBagCount: 2 }),
    );
  });

  it('derives NOT_RETURNED when all bags are not returned', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1', role: 'ADMIN', organizationId: 'org1',
    } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(baseTrip as any);
    mockTx(null);

    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        tripId: 't1',
        validationStage: 'CHECK_OUT',
        bags: [
          { id: 'b1', status: 'NOT_RETURNED' },
          { id: 'b2', status: 'NOT_RETURNED' },
        ],
        appCompleted: true,
      }),
    }));
    expect(res.status).toBe(201);
    expect(tourism.calculateCompliance).toHaveBeenCalledWith(
      expect.objectContaining({ conditionStatus: 'NOT_RETURNED', returnedBagCount: 0 }),
    );
  });

  it('derives GOOD when all bags are good', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1', role: 'ADMIN', organizationId: 'org1',
    } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(baseTrip as any);
    mockTx(null);

    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        tripId: 't1',
        validationStage: 'CHECK_OUT',
        bags: [{ id: 'b1', status: 'GOOD' }],
        appCompleted: true,
      }),
    }));
    expect(res.status).toBe(201);
    expect(tourism.calculateCompliance).toHaveBeenCalledWith(
      expect.objectContaining({ conditionStatus: 'GOOD' }),
    );
  });

  it('derives POOR when any bag is poor', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1', role: 'ADMIN', organizationId: 'org1',
    } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(baseTrip as any);
    mockTx(null);

    const res = await POST(new Request('http://localhost', {
      method: 'POST',
      body: JSON.stringify({
        tripId: 't1',
        validationStage: 'CHECK_OUT',
        bags: [
          { id: 'b1', status: 'GOOD' },
          { id: 'b2', status: 'POOR' },
        ],
        appCompleted: true,
      }),
    }));
    expect(res.status).toBe(201);
    expect(tourism.calculateCompliance).toHaveBeenCalledWith(
      expect.objectContaining({ conditionStatus: 'POOR' }),
    );
  });
});
