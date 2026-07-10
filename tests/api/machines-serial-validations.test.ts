import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/manual-validations/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trip: { findUnique: vi.fn(), update: vi.fn() },
    trashBagAssignment: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    manualValidation: { create: vi.fn(), findFirst: vi.fn() },
    rewardLedger: { create: vi.fn(), findFirst: vi.fn() },
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
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/tourism', () => ({
  calculateCompliance: vi.fn().mockReturnValue({ score: 100, status: 'COMPLIANT' }),
}));
vi.mock('@/lib/trip', () => ({
  TRASH_BAG_REWARD_PER_BAG: 100,
  isRewardableCondition: vi.fn((s) => s === 'GOOD' || s === 'PARTIAL'),
  computeTrashBagRewardAmount: vi.fn(({ rewardableBagCount, complianceScore, rewardMultiplier, rewardPerBag }) => {
    const perBag = rewardPerBag ?? 100;
    const mult = rewardMultiplier != null && rewardMultiplier > 0 ? rewardMultiplier : 1;
    return Math.floor(rewardableBagCount * perBag * mult * (complianceScore / 100));
  }),
  canValidateTripStage: vi.fn(() => ({ ok: true })),
  getTripTravelAgentGateBlockReason: vi.fn(async () => null),
}));

vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/format', () => ({ formatRupiah: (n: number) => `Rp ${n}` }));

const makeReq = (body: any) => new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) });

describe('/api/manual-validations POST', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when USER role tries to validate', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await POST(makeReq({ tripId: 't1' }));
    expect(res.status).toBe(403);
  });

  it('returns 404 when trip not found', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN' } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(null);
    const res = await POST(makeReq({ tripId: 't1' }));
    expect(res.status).toBe(404);
  });

  it('restricts PENGEPUL to BANK_SAMPAH_PICKUP stage only', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({
      id: 't1', status: 'COMPLETED', campaign: { organizationId: 'org1' },
    } as any);
    vi.mocked(rbac.assertActivePartnership).mockResolvedValue({} as any);

    const res = await POST(makeReq({ tripId: 't1', validationStage: 'CHECK_OUT' }));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain('Bank Sampah');
  });

  it('validates bagQrCode if provided', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN' } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({
      id: 't1', status: 'ACTIVE', campaign: { organizationId: 'org1' },
    } as any);
    vi.mocked(prisma.trashBagAssignment.findUnique).mockResolvedValue({ tripId: 't2' } as any);

    const res = await POST(makeReq({ tripId: 't1', bagQrCode: 'QR123' }));
    expect(res.status).toBe(422);
  });

  it('records CHECK_IN and updates trip', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN' } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({
      id: 't1',
      status: 'PLANNED',
      campaign: { organizationId: 'org1', rewardMode: 'MONEY_REWARD' },
      _count: { bagAssignments: 5 }
    } as any);

    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const mockTx = {
        manualValidation: { create: vi.fn().mockResolvedValue({ id: 'mv1' }) },
        trip: { update: vi.fn() },
      };
      return fn(mockTx);
    });

    const res = await POST(makeReq({ tripId: 't1', validationStage: 'CHECK_IN' }));
    expect(res.status).toBe(201);
  });

  it('records CHECK_OUT with multiple bag status updates and calculates reward', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN' } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({
      id: 't1',
      status: 'ACTIVE',
      userId: 'u1',
      campaign: { organizationId: 'org1', rewardMode: 'MONEY_REWARD', rewardMultiplier: 1 },
      _count: { bagAssignments: 3 }
    } as any);

    vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([{ id: 'b1' }, { id: 'b2' }] as any);

    const bagUpdates: Array<{ id: string; data: { status: string; returnedAt: Date | null } }> = [];
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const mockTx = {
        trashBagAssignment: {
          update: vi.fn(async ({ where, data }: any) => {
            bagUpdates.push({ id: where.id, data });
          }),
        },
        manualValidation: { create: vi.fn().mockResolvedValue({ id: 'mv1' }) },
        trip: { update: vi.fn() },
        rewardLedger: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
      };
      const res = await fn(mockTx);
      expect(mockTx.rewardLedger.create).toHaveBeenCalled();
      return res;
    });

    const res = await POST(makeReq({
      tripId: 't1',
      validationStage: 'CHECK_OUT',
      bags: [
        { id: 'b1', status: 'GOOD' },
        { id: 'b2', status: 'NOT_RETURNED' },
      ]
    }));
    
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.rewardAmount).toBeGreaterThan(0);
    expect(bagUpdates).toEqual([
      expect.objectContaining({
        id: 'b1',
        data: expect.objectContaining({ status: 'GOOD', returnedAt: expect.any(Date) }),
      }),
      expect.objectContaining({
        id: 'b2',
        data: expect.objectContaining({ status: 'NOT_RETURNED', returnedAt: null }),
      }),
    ]);
  });

  it('records validation with conditionStatus=null and appCompleted=true', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN' } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({
      id: 't1',
      status: 'COMPLETED',
      campaign: { organizationId: 'org1', rewardMode: 'MONEY_REWARD' },
      _count: { bagAssignments: 5 }
    } as any);
    vi.mocked(prisma.manualValidation.findFirst).mockResolvedValue(null);

    let createdVal: any;
    vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
      const mockTx = {
        manualValidation: { create: vi.fn().mockImplementation((args: any) => {
          createdVal = args.data;
          return { id: 'mv1' };
        }) },
        trip: { update: vi.fn() },
        rewardLedger: { findFirst: vi.fn(), create: vi.fn() },
      };
      return fn(mockTx);
    });

    const res = await POST(makeReq({ tripId: 't1', validationStage: 'BANK_SAMPAH_PICKUP', appCompleted: true }));
    expect(res.status).toBe(201);
    expect(createdVal.conditionStatus).toBeNull();
    expect(createdVal.appCompleted).toBe(true);
  });

  it('rejects duplicate BANK_SAMPAH_PICKUP', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({
      id: 't1',
      status: 'COMPLETED',
      campaign: { organizationId: 'org1', rewardMode: 'COMPLIANCE_ONLY' },
      _count: { bagAssignments: 3 },
    } as any);
    vi.mocked(rbac.assertActivePartnership).mockResolvedValue({} as any);
    vi.mocked(prisma.manualValidation.findFirst).mockResolvedValue({ id: 'existing' } as any);

    const res = await POST(makeReq({
      tripId: 't1',
      validationStage: 'BANK_SAMPAH_PICKUP',
      gateType: 'BANK_SAMPAH',
      returnedBagCount: 3,
      appCompleted: true,
    }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('sudah dicatat');
  });

  it('rejects gate validation when travel agent is suspended', async () => {
    const tripHelpers = await import('@/lib/trip');
    vi.mocked(tripHelpers.getTripTravelAgentGateBlockReason).mockResolvedValueOnce(
      'Travel agent trip ini sudah ditangguhkan atau dihapus dari organisasi',
    );
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN' } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({
      id: 't1',
      status: 'ACTIVE',
      travelAgentId: 'ta1',
      campaign: { organizationId: 'org1', rewardMode: 'COMPLIANCE_ONLY' },
      _count: { bagAssignments: 2 },
    } as any);

    const res = await POST(makeReq({ tripId: 't1', validationStage: 'CHECK_OUT' }));
    expect(res.status).toBe(422);
  });

  it('handles unexpected errors', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('Unexpected error POST'));
    const res = await POST(makeReq({ tripId: 't1' }));
    expect(res.status).toBe(500);
  });
});