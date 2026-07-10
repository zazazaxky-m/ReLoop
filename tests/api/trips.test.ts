import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/trips/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trip: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    campaign: { findUnique: vi.fn() },
    travelAgentOrganization: { findUnique: vi.fn() },
    travelAgentUser: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
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
vi.mock('@/lib/trip', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/trip')>();
  return {
    ...actual,
    getInvitedTravelAgentTripFilters: vi.fn(async () => []),
  };
});

describe('/api/trips', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET', () => {
    it('returns trips for SUPERADMIN (no scope)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.trip.findMany).mockResolvedValue([{ id: 't1' }] as any);
      vi.mocked(prisma.trip.count).mockResolvedValue(1);

      const res = await GET(new Request('http://localhost/api/trips'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.trips).toHaveLength(1);
      expect(data.pagination).toBeDefined();
    });

    it('returns trips for ADMIN (org-scoped)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.trip.findMany).mockResolvedValue([]);
      vi.mocked(prisma.trip.count).mockResolvedValue(0);

      const res = await GET(new Request('http://localhost/api/trips'));
      expect(res.status).toBe(200);
      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { campaign: { organizationId: 'org1' } },
        }),
      );
    });

    it('scopes ADMIN without organizationId to __none__', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: null } as any);
      vi.mocked(prisma.trip.findMany).mockResolvedValue([]);
      vi.mocked(prisma.trip.count).mockResolvedValue(0);

      const res = await GET(new Request('http://localhost/api/trips'));
      expect(res.status).toBe(200);
      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { campaign: { organizationId: '__none__' } },
        }),
      );
    });

    it('returns trips for USER (own trips and linked travel agents)', async () => {
      const tripHelpers = await import('@/lib/trip');
      vi.mocked(tripHelpers.getInvitedTravelAgentTripFilters).mockResolvedValueOnce([
        { travelAgentId: 'ta1', organizationId: 'org1' },
      ]);
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.trip.findMany).mockResolvedValue([]);
      vi.mocked(prisma.trip.count).mockResolvedValue(0);

      const res = await GET(new Request('http://localhost/api/trips'));
      expect(res.status).toBe(200);
      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { userId: 'u1' },
              { travelAgentId: 'ta1', campaign: { organizationId: 'org1' } },
            ],
          },
        }),
      );
    });

    it('returns own trips only when USER has no travel agent links', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.trip.findMany).mockResolvedValue([]);
      vi.mocked(prisma.trip.count).mockResolvedValue(0);

      const res = await GET(new Request('http://localhost/api/trips'));
      expect(res.status).toBe(200);
      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ userId: 'u1' }] },
        }),
      );
    });

    it('handles unexpected errors', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('Unexpected GET error'));
      const res = await GET(new Request('http://localhost/api/trips'));
      expect(res.status).toBe(500);
    });

    it('applies status, complianceStatus, campaignId and q filters', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.trip.findMany).mockResolvedValue([]);
      vi.mocked(prisma.trip.count).mockResolvedValue(0);

      const res = await GET(
        new Request(
          'http://localhost/api/trips?status=ACTIVE&complianceStatus=COMPLIANT&campaignId=c1&q=Grup',
        ),
      );
      expect(res.status).toBe(200);
      expect(prisma.trip.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              {
                AND: [
                  {
                    AND: [
                      { AND: [{}, { status: 'ACTIVE' }] },
                      { complianceStatus: 'COMPLIANT' },
                    ],
                  },
                  { campaignId: 'c1' },
                ],
              },
              {
                OR: [
                  { groupName: { contains: 'Grup', mode: 'insensitive' } },
                  { leaderName: { contains: 'Grup', mode: 'insensitive' } },
                  { travelAgentName: { contains: 'Grup', mode: 'insensitive' } },
                ],
              },
            ],
          },
        }),
      );
    });
  });
  describe('POST', () => {
    it('returns 403 when not ADMIN or SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ campaignId: 'c1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });

    it('returns 404 when campaign not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(null);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ campaignId: 'notexist' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(404);
    });

    const activeTrashBagCampaign = {
      id: 'c1',
      organizationId: 'org1',
      campaignType: 'TRASH_BAG',
      status: 'ACTIVE',
      rewardMode: 'COMPLIANCE_ONLY',
      startAt: null,
      endAt: null,
    };

    it('creates trip successfully (201)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(activeTrashBagCampaign as any);
      vi.mocked(prisma.trip.create).mockResolvedValue({ id: 't1' } as any);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ campaignId: 'c1', groupName: 'Group A' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it('requires userEmail for MONEY_REWARD campaigns', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        ...activeTrashBagCampaign,
        rewardMode: 'MONEY_REWARD',
      } as any);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ campaignId: 'c1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('rejects non trash-bag campaign types', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        ...activeTrashBagCampaign,
        campaignType: 'MACHINE_DEPOSIT',
      } as any);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ campaignId: 'c1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('rejects draft campaigns', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        ...activeTrashBagCampaign,
        status: 'DRAFT',
      } as any);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ campaignId: 'c1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('requires travel agent for tourism programs', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        ...activeTrashBagCampaign,
        campaignType: 'TOURISM_PROGRAM',
      } as any);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ campaignId: 'c1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('rejects manual travelAgentName without travelAgentId', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(activeTrashBagCampaign as any);

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ campaignId: 'c1', travelAgentName: 'Agen Manual' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('validates travel agent status (not invited)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(activeTrashBagCampaign as any);
      vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue({
        status: 'PENDING', travelAgent: { name: 'Agent' },
      } as any);

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ campaignId: 'c1', travelAgentId: 'ta1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('validates travel agent status (link not found)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(activeTrashBagCampaign as any);
      vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue(null);

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ campaignId: 'c1', travelAgentId: 'ta1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('sets travel agent name from link when valid', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        ...activeTrashBagCampaign,
        campaignType: 'TOURISM_PROGRAM',
      } as any);
      vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue({
        status: 'INVITED', travelAgent: { name: 'Agent X', status: 'ACTIVE' },
      } as any);
      vi.mocked(prisma.trip.create).mockResolvedValue({ id: 't1' } as any);

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ campaignId: 'c1', travelAgentId: 'ta1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(prisma.trip.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ travelAgentName: 'Agent X' }) }),
      );
    });

    it('returns 404 when user email not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        ...activeTrashBagCampaign,
        rewardMode: 'MONEY_REWARD',
      } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ campaignId: 'c1', userEmail: 'notexist@example.com' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(404);
    });

    it('creates trip with userId when userEmail is found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        ...activeTrashBagCampaign,
        rewardMode: 'MONEY_REWARD',
      } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.trip.create).mockResolvedValue({ id: 't1' } as any);

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ campaignId: 'c1', userEmail: 'user@example.com' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(prisma.trip.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'u1' }) }),
      );
    });

    it('returns 422 if Campaign belum dimulai', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        ...activeTrashBagCampaign,
        startAt: new Date(Date.now() + 1000000), // future
      } as any);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ campaignId: 'c1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toBe("Campaign belum dimulai");
    });

    it('returns 422 if Campaign sudah berakhir', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        ...activeTrashBagCampaign,
        endAt: new Date(Date.now() - 1000000), // past
      } as any);

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ campaignId: 'c1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toBe("Campaign sudah berakhir");
    });

    it('handles unexpected errors', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('Unexpected error POST'));
      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ campaignId: 'c1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(500);
    });

    it('rejects inactive travel agent even when org link is INVITED', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        ...activeTrashBagCampaign,
        campaignType: 'TOURISM_PROGRAM',
      } as any);
      vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue({
        status: 'INVITED',
        travelAgent: { name: 'Agent X', status: 'SUSPENDED' },
      } as any);

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ campaignId: 'c1', travelAgentId: 'ta1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toBe('Travel agent tidak aktif');
    });
  });
});
