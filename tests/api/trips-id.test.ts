import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, PATCH } from '@/app/api/trips/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as tripLifecycle from '@/lib/trip-issuance';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trip: { findUnique: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    travelAgentUser: { findFirst: vi.fn() },
    travelAgentOrganization: { findUnique: vi.fn() },
    rewardLedger: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
// B01: the status change runs under the trip locks in lib/trip-issuance.ts
// (a cancelled trip gives its reservation back, a reopened one reserves again).
vi.mock('@/lib/trip-issuance', () => ({ changeTripStatus: vi.fn() }));

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe('/api/trips/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET', () => {
    it('returns 404 when trip not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(null);

      const res = await GET(new Request('http://localhost'), makeParams('t1'));
      expect(res.status).toBe(404);
    });

    it('returns trip details for SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.trip.findUnique)
        // loadScopedTrip call
        .mockResolvedValueOnce({ id: 't1', campaign: { organizationId: 'org1' }, userId: null } as any)
        // detailed query
        .mockResolvedValueOnce({ id: 't1', campaign: { id: 'c1', name: 'Camp' }, userId: null, validations: [] } as any);

      const res = await GET(new Request('http://localhost'), makeParams('t1'));
      expect(res.status).toBe(200);
    });

    it('returns 403 when ADMIN tries to access trip from other org', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', campaign: { organizationId: 'org2' }, userId: null,
      } as any);

      const res = await GET(new Request('http://localhost'), makeParams('t1'));
      expect(res.status).toBe(403);
    });

    it('returns 403 when USER accesses another users trip', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', campaign: { organizationId: 'org1' }, userId: 'u2', travelAgentId: null,
      } as any);

      const res = await GET(new Request('http://localhost'), makeParams('t1'));
      expect(res.status).toBe(403);
    });

    it('allows USER to access trip linked via travel agent', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.trip.findUnique)
        .mockResolvedValueOnce({
          id: 't1',
          campaign: { organizationId: 'org1' },
          userId: 'u2',
          travelAgentId: 'ta1',
        } as any)
        .mockResolvedValueOnce({
          id: 't1',
          campaign: { id: 'c1', name: 'Camp' },
          bagAssignments: [],
          validations: [],
        } as any);
      vi.mocked(prisma.travelAgentUser.findFirst).mockResolvedValue({ id: 'link1' } as any);
      vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue({
        status: 'INVITED',
      } as any);

      const res = await GET(new Request('http://localhost'), makeParams('t1'));
      expect(res.status).toBe(200);
      // A03: the membership must be verified (accepted from the invited mailbox).
      expect(prisma.travelAgentUser.findFirst).toHaveBeenCalledWith({
        where: { userId: 'u1', travelAgentId: 'ta1', verifiedAt: { not: null }, user: { emailVerifiedAt: { not: null } } },
        select: { id: true },
      });
    });

    it('rejects USER when travel agent org is suspended', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1',
        campaign: { organizationId: 'org1' },
        userId: 'u2',
        travelAgentId: 'ta1',
      } as any);
      vi.mocked(prisma.travelAgentUser.findFirst).mockResolvedValue({ id: 'link1' } as any);
      vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue({
        status: 'SUSPENDED',
      } as any);

      const res = await GET(new Request('http://localhost'), makeParams('t1'));
      expect(res.status).toBe(403);
    });

    it('aggregates trashBagRewardAmount when trip has userId', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.trip.findUnique)
        .mockResolvedValueOnce({
          id: 't1',
          campaign: { organizationId: 'org1' },
          userId: 'u1',
        } as any)
        .mockResolvedValueOnce({
          id: 't1',
          userId: 'u1',
          campaignId: 'c1',
          campaign: { id: 'c1', name: 'Camp' },
          validations: [{ id: 'v1' }, { id: 'v2' }],
          bagAssignments: [],
        } as any);
      vi.mocked(prisma.rewardLedger.aggregate).mockResolvedValue({
        _sum: { amount: 4500 },
      } as any);

      const res = await GET(new Request('http://localhost'), makeParams('t1'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.trip.trashBagRewardAmount).toBe(4500);
      expect(prisma.rewardLedger.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'u1',
            campaignId: 'c1',
            reasonCode: 'TRASH_BAG_RETURN',
          }),
        }),
      );
    });

    it('defaults trashBagRewardAmount to 0 when aggregate sum is null', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.trip.findUnique)
        .mockResolvedValueOnce({
          id: 't1',
          campaign: { organizationId: 'org1' },
          userId: 'u1',
        } as any)
        .mockResolvedValueOnce({
          id: 't1',
          userId: 'u1',
          campaignId: 'c1',
          campaign: { id: 'c1', name: 'Camp' },
          validations: [],
          bagAssignments: [],
        } as any);
      vi.mocked(prisma.rewardLedger.aggregate).mockResolvedValue({
        _sum: { amount: null },
      } as any);

      const res = await GET(new Request('http://localhost'), makeParams('t1'));
      const data = await res.json();
      expect(data.trip.trashBagRewardAmount).toBe(0);
    });

    it('returns 404 when detail query races to null after scope check', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.trip.findUnique)
        .mockResolvedValueOnce({
          id: 't1',
          campaign: { organizationId: 'org1' },
          userId: null,
        } as any)
        .mockResolvedValueOnce(null);

      const res = await GET(new Request('http://localhost'), makeParams('t1'));
      expect(res.status).toBe(404);
    });

    it('allows USER to access own trip without travel agent check', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.trip.findUnique)
        .mockResolvedValueOnce({
          id: 't1',
          campaign: { organizationId: 'org1' },
          userId: 'u1',
          travelAgentId: null,
        } as any)
        .mockResolvedValueOnce({
          id: 't1',
          userId: 'u1',
          campaign: { id: 'c1', name: 'Camp' },
          validations: [],
          bagAssignments: [],
        } as any);

      const res = await GET(new Request('http://localhost'), makeParams('t1'));
      expect(res.status).toBe(200);
    });
  });

  describe('PATCH', () => {
    it('cancels a planned trip', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', campaign: { organizationId: 'org1' }, userId: null, status: 'PLANNED',
      } as any);
      vi.mocked(tripLifecycle.changeTripStatus).mockResolvedValue({ id: 't1', status: 'CANCELLED' } as any);

      const req = new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }),
      });
      const res = await PATCH(req, makeParams('t1'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ trip: { id: 't1', status: 'CANCELLED' } });
      // The change runs under the trip locks with the status the decision was made on.
      expect(tripLifecycle.changeTripStatus).toHaveBeenCalledWith('t1', 'PLANNED', 'CANCELLED');
      expect(prisma.trip.updateMany).not.toHaveBeenCalled();
    });

    it('reopens a cancelled trip through the same locked change (B01 fix 1: it reserves its issued bags again)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', campaign: { organizationId: 'org1' }, userId: 'u1', status: 'CANCELLED',
      } as any);
      vi.mocked(tripLifecycle.changeTripStatus).mockResolvedValue({ id: 't1', status: 'PLANNED' } as any);
      const res = await PATCH(new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ status: 'PLANNED' }),
      }), makeParams('t1'));
      expect(res.status).toBe(200);
      expect(tripLifecycle.changeTripStatus).toHaveBeenCalledWith('t1', 'CANCELLED', 'PLANNED');

      // A refused reservation (funding enforcement) leaves the trip cancelled.
      vi.mocked(tripLifecycle.changeTripStatus).mockRejectedValueOnce(
        new (rbac as any).HttpError(409, 'Program sementara tidak menerima setoran berhadiah'));
      const refused = await PATCH(new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ status: 'PLANNED' }),
      }), makeParams('t1'));
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toBe('Program sementara tidak menerima setoran berhadiah');
    });

    it('answers 409 when a check-out changed the trip meanwhile', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', campaign: { organizationId: 'org1' }, userId: null, status: 'ACTIVE',
      } as any);
      vi.mocked(tripLifecycle.changeTripStatus).mockRejectedValue(
        new (rbac as any).HttpError(409, 'Status trip sudah berubah. Muat ulang halaman lalu coba lagi.'));

      const res = await PATCH(new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ status: 'CANCELLED' }),
      }), makeParams('t1'));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toBe('Status trip sudah berubah. Muat ulang halaman lalu coba lagi.');
      expect(tripLifecycle.changeTripStatus).toHaveBeenCalledWith('t1', 'ACTIVE', 'CANCELLED');
    });

    it('rejects illegal status transitions', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', campaign: { organizationId: 'org1' }, userId: null, status: 'PLANNED',
      } as any);

      const req = new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ status: 'COMPLETED' }),
      });
      const res = await PATCH(req, makeParams('t1'));
      expect(res.status).toBe(422);
    });

    it('returns 422 for invalid status', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', campaign: { organizationId: 'org1' }, userId: null, status: 'PLANNED',
      } as any);

      const req = new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ status: 'INVALID_STATUS' }),
      });
      const res = await PATCH(req, makeParams('t1'));
      expect(res.status).toBe(422);
    });
  });
});
