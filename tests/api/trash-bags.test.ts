import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST, PATCH } from '@/app/api/trash-bags/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as trip from '@/lib/trip';
import * as tourism from '@/lib/tourism';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trashBagAssignment: { findMany: vi.fn(), createMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    trip: { findUnique: vi.fn(), update: vi.fn() },
    wasteType: { findFirst: vi.fn() },
    manualValidation: { create: vi.fn() },
    rewardLedger: { findFirst: vi.fn(), create: vi.fn() },
    travelAgentUser: { findMany: vi.fn().mockResolvedValue([]) },
    travelAgentOrganization: { findMany: vi.fn().mockResolvedValue([]) },
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
vi.mock('@/lib/trip', () => ({
  generateBagQrCode: vi.fn().mockReturnValue('QR123'),
  canIssueBagsForTripStatus: vi.fn((status: string) => status === 'PLANNED' || status === 'ACTIVE'),
  TRASH_BAG_REWARD_PER_BAG: 2000,
  isRewardableCondition: vi.fn((s: string) => s === 'GOOD' || s === 'PARTIAL'),
  computeTrashBagRewardAmount: vi.fn(({ rewardableBagCount, complianceScore, rewardMultiplier, rewardPerBag }: any) => {
    const perBag = rewardPerBag ?? 2000;
    const mult = rewardMultiplier != null && rewardMultiplier > 0 ? rewardMultiplier : 1;
    return Math.floor(rewardableBagCount * perBag * mult * (complianceScore / 100));
  }),
  getTripTravelAgentGateBlockReason: vi.fn(async () => null),
}));
vi.mock('@/lib/tourism', () => ({
  calculateCompliance: vi.fn().mockReturnValue({ score: 80, status: 'COMPLIANT' }),
}));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/format', () => ({ formatRupiah: (n: number) => `Rp ${n}` }));

describe('/api/trash-bags', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET', () => {
    it('returns 400 when no tripId or qrCode', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      const res = await GET(new Request('http://localhost/api/trash-bags'));
      expect(res.status).toBe(400);
    });

    it('returns bags by tripId', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([
        { id: 'b1', trip: { campaign: { organizationId: 'org1' } } },
      ] as any);

      const res = await GET(new Request('http://localhost/api/trash-bags?tripId=t1'));
      expect(res.status).toBe(200);
    });

    it('returns bags by qrCode', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([
        { id: 'b1', trip: { campaign: { organizationId: 'org1' } } },
      ] as any);

      const res = await GET(new Request('http://localhost/api/trash-bags?qrCode=QR123'));
      expect(res.status).toBe(200);
    });
  });

  describe('POST', () => {
    it('returns 404 when trip not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(null);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ tripId: 'notexist', bagCount: 3 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(404);
    });

    it('creates bags successfully (201)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', status: 'PLANNED', campaign: { organizationId: 'org1' },
      } as any);
      vi.mocked(prisma.trashBagAssignment.createMany).mockResolvedValue({ count: 2 } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([{ id: 'b1' }, { id: 'b2' }] as any);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ tripId: 't1', bagCount: 2 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it('retries createMany on unique QR collision (P2002)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', status: 'PLANNED', campaign: { organizationId: 'org1' },
      } as any);
      const collision = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      vi.mocked(prisma.trashBagAssignment.createMany)
        .mockRejectedValueOnce(collision)
        .mockResolvedValueOnce({ count: 1 } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([{ id: 'b1' }] as any);
      vi.mocked(trip.generateBagQrCode)
        .mockReturnValueOnce('QR-DUP')
        .mockReturnValueOnce('QR-OK');

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ tripId: 't1', bagCount: 1 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(prisma.trashBagAssignment.createMany).toHaveBeenCalledTimes(2);
    });

    it('rethrows non-P2002 createMany errors immediately', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', status: 'PLANNED', campaign: { organizationId: 'org1' },
      } as any);
      vi.mocked(prisma.trashBagAssignment.createMany).mockRejectedValue(new Error('db down'));

      const res = await POST(new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ tripId: 't1', bagCount: 1 }),
      }));
      expect(res.status).toBe(500);
    });

    it('returns 422 when bagCount exceeds 200', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ tripId: 't1', bagCount: 201 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('returns 422 when wasteTypeId is invalid', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', status: 'PLANNED', campaign: { organizationId: 'org1' },
      } as any);
      vi.mocked(prisma.wasteType.findFirst).mockResolvedValue(null);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ tripId: 't1', bagCount: 1, wasteTypeId: 'invalid' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('rejects issuing bags for cancelled trips', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', status: 'CANCELLED', campaign: { organizationId: 'org1' },
      } as any);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ tripId: 't1', bagCount: 1 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('rejects POST when travel agent gate blocks', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1',
        status: 'PLANNED',
        travelAgentId: 'ta1',
        campaign: { organizationId: 'org1' },
      } as any);
      vi.mocked(trip.getTripTravelAgentGateBlockReason).mockResolvedValueOnce(
        'Travel agent ditangguhkan',
      );

      const res = await POST(new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ tripId: 't1', bagCount: 1 }),
      }));
      expect(res.status).toBe(422);
    });
  });

  describe('PATCH', () => {
    it('returns 404 when bag not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue(null);

      const req = new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ id: 'notexist', status: 'GOOD', appCompleted: true }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(404);
    });

    it('returns 422 when neither id nor qrCode provided', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);

      const req = new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ status: 'GOOD', appCompleted: true }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(422);
    });

    it('updates bag status and recalculates compliance', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'ACTIVE',
          userId: null,
          campaignId: 'c1',
          campaign: { organizationId: 'org1', rewardMode: 'COMPLIANCE_ONLY', rewardMultiplier: 1 },
          _count: { bagAssignments: 2 },
        },
      } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([
        { id: 'b1', status: null },
        { id: 'b2', status: 'GOOD' },
      ] as any);

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          trashBagAssignment: { update: vi.fn().mockResolvedValue({ id: 'b1' }) },
          manualValidation: { create: vi.fn().mockResolvedValue({ id: 'v1' }) },
          trip: { update: vi.fn() },
          rewardLedger: { findFirst: vi.fn(), create: vi.fn() },
        };
        return fn(mockTx);
      });

      const req = new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ id: 'b1', status: 'GOOD', appCompleted: true }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(200);
      expect(tourism.calculateCompliance).toHaveBeenCalled();
    });

    it('rejects PATCH when trip is still PLANNED', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'PLANNED',
          campaign: { organizationId: 'org1', rewardMode: 'MONEY_REWARD' },
          _count: { bagAssignments: 1 },
        },
      } as any);

      const res = await PATCH(new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ id: 'b1', status: 'GOOD' }),
      }));
      expect(res.status).toBe(422);
    });

    it('rejects PATCH when trip is CANCELLED', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'CANCELLED',
          campaign: { organizationId: 'org1', rewardMode: 'MONEY_REWARD' },
          _count: { bagAssignments: 1 },
        },
      } as any);

      const res = await PATCH(new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ id: 'b1', status: 'GOOD' }),
      }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toContain('dibatalkan');
    });

    it('rejects PATCH when trip is COMPLETED', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'COMPLETED',
          campaign: { organizationId: 'org1', rewardMode: 'MONEY_REWARD' },
          _count: { bagAssignments: 1 },
        },
      } as any);

      const res = await PATCH(new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ id: 'b1', status: 'GOOD' }),
      }));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toContain('selesai');
    });

    it('creates reward when last bag completes MONEY_REWARD trip', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'ACTIVE',
          userId: 'u1',
          campaignId: 'c1',
          campaign: { organizationId: 'org1', rewardMode: 'MONEY_REWARD', rewardMultiplier: 1 },
          _count: { bagAssignments: 1 },
        },
      } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([
        { id: 'b1', status: null },
      ] as any);

      let rewardCreated = false;
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          trashBagAssignment: { update: vi.fn().mockResolvedValue({ id: 'b1' }) },
          manualValidation: { create: vi.fn().mockResolvedValue({ id: 'v1' }) },
          trip: { update: vi.fn() },
          rewardLedger: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockImplementation(() => { rewardCreated = true; }),
          },
        };
        return fn(mockTx);
      });

      const res = await PATCH(new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ id: 'b1', status: 'GOOD', appCompleted: true }),
      }));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.rewardAmount).toBeGreaterThan(0);
      expect(rewardCreated).toBe(true);
    });

    it('calculates conditionStatus as NOT_RETURNED when all are NOT_RETURNED', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'ACTIVE',
          userId: null,
          campaignId: 'c1',
          campaign: { organizationId: 'org1', rewardMode: 'COMPLIANCE_ONLY', rewardMultiplier: 1 },
          _count: { bagAssignments: 2 },
        },
      } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([
        { id: 'b1', status: null },
        { id: 'b2', status: 'NOT_RETURNED' },
      ] as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          trashBagAssignment: { update: vi.fn().mockResolvedValue({ id: 'b1' }) },
          manualValidation: { create: vi.fn().mockResolvedValue({ id: 'v1' }) },
          trip: { update: vi.fn() },
          rewardLedger: { findFirst: vi.fn(), create: vi.fn() },
        };
        return fn(mockTx);
      });

      await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ id: 'b1', status: 'NOT_RETURNED' }) }));
      expect(tourism.calculateCompliance).toHaveBeenCalledWith(expect.objectContaining({ conditionStatus: 'NOT_RETURNED' }));
    });

    it('calculates conditionStatus as POOR when some are POOR', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'ACTIVE',
          userId: null,
          campaignId: 'c1',
          campaign: { organizationId: 'org1', rewardMode: 'COMPLIANCE_ONLY', rewardMultiplier: 1 },
          _count: { bagAssignments: 2 },
        },
      } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([
        { id: 'b1', status: null },
        { id: 'b2', status: 'POOR' },
      ] as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          trashBagAssignment: { update: vi.fn().mockResolvedValue({ id: 'b1' }) },
          manualValidation: { create: vi.fn().mockResolvedValue({ id: 'v1' }) },
          trip: { update: vi.fn() },
          rewardLedger: { findFirst: vi.fn(), create: vi.fn() },
        };
        return fn(mockTx);
      });

      await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ id: 'b1', status: 'GOOD' }) }));
      expect(tourism.calculateCompliance).toHaveBeenCalledWith(expect.objectContaining({ conditionStatus: 'POOR' }));
    });

    it('calculates conditionStatus as PARTIAL when mixed without POOR', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'ACTIVE',
          userId: null,
          campaignId: 'c1',
          campaign: { organizationId: 'org1', rewardMode: 'COMPLIANCE_ONLY', rewardMultiplier: 1 },
          _count: { bagAssignments: 2 },
        },
      } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([
        { id: 'b1', status: null },
        { id: 'b2', status: 'PARTIAL' },
      ] as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          trashBagAssignment: { update: vi.fn().mockResolvedValue({ id: 'b1' }) },
          manualValidation: { create: vi.fn().mockResolvedValue({ id: 'v1' }) },
          trip: { update: vi.fn() },
          rewardLedger: { findFirst: vi.fn(), create: vi.fn() },
        };
        return fn(mockTx);
      });

      await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ id: 'b1', status: 'GOOD' }) }));
      expect(tourism.calculateCompliance).toHaveBeenCalledWith(expect.objectContaining({ conditionStatus: 'PARTIAL' }));
    });

    it('calculates conditionStatus as data.status when knownStatuses is empty', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'ACTIVE',
          userId: null,
          campaignId: 'c1',
          campaign: { organizationId: 'org1', rewardMode: 'COMPLIANCE_ONLY', rewardMultiplier: 1 },
          _count: { bagAssignments: 1 },
        },
      } as any);
      // Return empty array so knownStatuses is empty
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([] as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          trashBagAssignment: { update: vi.fn().mockResolvedValue({ id: 'b1' }) },
          manualValidation: { create: vi.fn().mockResolvedValue({ id: 'v1' }) },
          trip: { update: vi.fn() },
          rewardLedger: { findFirst: vi.fn(), create: vi.fn() },
        };
        return fn(mockTx);
      });

      await PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ id: 'b1', status: 'POOR' }) }));
      expect(tourism.calculateCompliance).toHaveBeenCalledWith(expect.objectContaining({ conditionStatus: 'POOR' }));
    });

    it('finds bag by qrCode and leaves trip ACTIVE if not all bags reviewed', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'ACTIVE',
          userId: null,
          campaignId: 'c1',
          campaign: { organizationId: 'org1', rewardMode: 'COMPLIANCE_ONLY', rewardMultiplier: 1 },
          _count: { bagAssignments: 2 },
        },
      } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([
        { id: 'b1', status: null }, // b1 being updated
        { id: 'b2', status: null }, // b2 not reviewed
      ] as any);

      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          trashBagAssignment: { update: vi.fn().mockResolvedValue({ id: 'b1' }) },
          manualValidation: { create: vi.fn().mockResolvedValue({ id: 'v1' }) },
          trip: { update: vi.fn() },
          rewardLedger: { findFirst: vi.fn(), create: vi.fn() },
        };
        await fn(mockTx);
        expect(mockTx.trip.update).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ status: 'ACTIVE' })
        }));
        expect(mockTx.trip.update).not.toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ checkOutAt: expect.anything() })
        }));
        // Progressive scan must not create CHECK_OUT validation until all bags reviewed.
        expect(mockTx.manualValidation.create).not.toHaveBeenCalled();
        return { bag: { id: 'b1' }, validation: null };
      });

      const req = new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ qrCode: 'QR1', status: 'GOOD' }),
      });
      const res = await PATCH(req);
      expect(res.status).toBe(200);
      expect(prisma.trashBagAssignment.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { bagQrCode: 'QR1' }
      }));
    });

    it('rejects PATCH for unknown trip status branch', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'ARCHIVED' as any,
          campaign: { organizationId: 'org1', rewardMode: 'COMPLIANCE_ONLY' },
          _count: { bagAssignments: 1 },
        },
      } as any);

      const res = await PATCH(new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ id: 'b1', status: 'GOOD' }),
      }));
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toContain('PLANNED atau ACTIVE');
    });

    it('rejects PATCH when travel agent gate blocks', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'ACTIVE',
          travelAgentId: 'ta1',
          campaign: { organizationId: 'org1', rewardMode: 'COMPLIANCE_ONLY' },
          _count: { bagAssignments: 1 },
        },
      } as any);
      vi.mocked(trip.getTripTravelAgentGateBlockReason).mockResolvedValueOnce(
        'Travel agent belum invited',
      );

      const res = await PATCH(new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ id: 'b1', status: 'GOOD' }),
      }));
      expect(res.status).toBe(422);
    });

    it('notifies trip user and invited travel agent users on completed checkout', async () => {
      const { createNotification } = await import('@/lib/notifications');
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', bagQrCode: 'QR1',
        trip: {
          status: 'ACTIVE',
          userId: 'u1',
          travelAgentId: 'ta1',
          campaignId: 'c1',
          groupName: 'Grup Wisata',
          campaign: {
            organizationId: 'org1',
            rewardMode: 'MONEY_REWARD',
            rewardMultiplier: 1,
            name: 'Camp',
          },
          _count: { bagAssignments: 1 },
        },
      } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([
        { id: 'b1', status: null },
      ] as any);
      vi.mocked(prisma.travelAgentUser.findMany).mockResolvedValue([
        { userId: 'agent-user-1' },
      ] as any);
      vi.mocked(prisma.travelAgentOrganization.findMany).mockResolvedValue([
        { id: 'link1' },
      ] as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          trashBagAssignment: { update: vi.fn().mockResolvedValue({ id: 'b1' }) },
          manualValidation: { create: vi.fn().mockResolvedValue({ id: 'v1' }) },
          trip: { update: vi.fn() },
          rewardLedger: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn(),
          },
        };
        return fn(mockTx);
      });

      const res = await PATCH(new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'b1', status: 'GOOD', appCompleted: true }),
      }));
      expect(res.status).toBe(200);
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', type: 'TRIP_STATUS' }),
      );
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'agent-user-1', type: 'TRIP_STATUS' }),
      );
      expect(createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', type: 'TRASH_BAG_REWARD' }),
      );
    });
  });
});
