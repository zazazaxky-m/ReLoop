import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/campaigns/route';
import { PATCH, DELETE } from '@/app/api/campaigns/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn() },
    depositSession: { count: vi.fn() },
    rewardRate: { deleteMany: vi.fn() },
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

describe('/api/campaigns endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (url: string, method = 'GET', body?: any) => new Request(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });

  describe('GET', () => {
    it('returns campaigns', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.count).mockResolvedValue(1);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([{ id: 'c1' }] as any);

      const res = await GET(makeReq('http://localhost/api/campaigns'));
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.campaigns).toHaveLength(1);
      expect(prisma.campaign.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { organizationId: 'org1' }
      }));
    });

    it('uses __none__ when ADMIN has no organization', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: null } as any);
      vi.mocked(prisma.campaign.count).mockResolvedValue(0);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([] as any);

      await GET(makeReq('http://localhost/api/campaigns'));
      expect(prisma.campaign.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { organizationId: '__none__' },
      }));
    });

    it('filters by organizationId for SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.campaign.count).mockResolvedValue(0);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([] as any);

      await GET(makeReq('http://localhost/api/campaigns?organizationId=org9'));
      expect(prisma.campaign.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { organizationId: 'org9' },
      }));
    });

    it('returns handled error on GET failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('get boom'));
      expect((await GET(makeReq('http://localhost/api/campaigns'))).status).toBe(500);
    });
  });

  describe('POST', () => {
    it('creates campaign (201)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.create).mockResolvedValue({ id: 'c1' } as any);

      const res = await POST(makeReq('http://localhost/api/campaigns', 'POST', {
        name: 'New Camp',
        organizationId: 'org1',
      }));
      expect(res.status).toBe(201);
      expect(prisma.campaign.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ name: 'New Camp', organizationId: 'org1' })
      }));
    });

    it('requires organizationId for SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      const res = await POST(makeReq('http://localhost/api/campaigns', 'POST', { name: 'No Org' }));
      expect(res.status).toBe(422);
    });

    it('rejects private campaign without valid email domains', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any);
      const res = await POST(makeReq('http://localhost/api/campaigns', 'POST', {
        name: 'Private Camp',
        visibility: 'PRIVATE',
        allowedEmailDomains: ['not-a-domain'],
      }));
      expect(res.status).toBe(422);
    });

    it('creates private campaign with normalized domains', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.create).mockResolvedValue({ id: 'c2', name: 'Private', visibility: 'PRIVATE' } as any);

      const res = await POST(makeReq('http://localhost/api/campaigns', 'POST', {
        name: 'Private Camp',
        visibility: 'PRIVATE',
        allowedEmailDomains: ['@School.Edu', 'partner.org'],
        startAt: '2026-01-01T00:00:00.000Z',
        endAt: '2026-12-31T00:00:00.000Z',
        rewardMultiplier: 1.5,
      }));
      expect(res.status).toBe(201);
      expect(prisma.campaign.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          visibility: 'PRIVATE',
          allowedEmailDomainsJson: expect.any(Array),
          rewardMultiplier: 1.5,
        }),
      }));
    });

    it('returns handled error on POST failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('post boom'));
      expect((await POST(makeReq('http://localhost/api/campaigns', 'POST', { name: 'X' }))).status).toBe(500);
    });
  });

  describe('PATCH', () => {
    it('updates campaign (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ id: 'c1', visibility: 'PUBLIC', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.update).mockResolvedValue({ id: 'c1', name: 'Updated' } as any);

      const res = await PATCH(makeReq('http://localhost/api/campaigns/c1', 'PATCH', {
        name: 'Updated',
      }), { params: Promise.resolve({ id: 'c1' }) });
      
      expect(res.status).toBe(200);
      expect(prisma.campaign.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({ name: 'Updated' })
      }));
    });

    it('returns 404 when campaign is missing', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(null);
      const res = await PATCH(makeReq('http://localhost/api/campaigns/missing', 'PATCH', { name: 'X' }), {
        params: Promise.resolve({ id: 'missing' }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 403 when ADMIN edits outside org scope', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ id: 'c1', organizationId: 'org2', visibility: 'PUBLIC' } as any);
      const res = await PATCH(makeReq('http://localhost/api/campaigns/c1', 'PATCH', { name: 'Nope' }), {
        params: Promise.resolve({ id: 'c1' }),
      });
      expect(res.status).toBe(403);
    });

    it('clears domains when switching to PUBLIC', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ id: 'c1', visibility: 'PRIVATE', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.update).mockResolvedValue({ id: 'c1' } as any);

      const res = await PATCH(makeReq('http://localhost/api/campaigns/c1', 'PATCH', {
        visibility: 'PUBLIC',
        startAt: null,
        endAt: null,
      }), { params: Promise.resolve({ id: 'c1' }) });
      expect(res.status).toBe(200);
      expect(prisma.campaign.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          visibility: 'PUBLIC',
          startAt: null,
          endAt: null,
        }),
      }));
    });

    it('rejects private domain update with empty valid domains', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ id: 'c1', visibility: 'PRIVATE', organizationId: 'org1' } as any);

      const res = await PATCH(makeReq('http://localhost/api/campaigns/c1', 'PATCH', {
        allowedEmailDomains: ['bad'],
      }), { params: Promise.resolve({ id: 'c1' }) });
      expect(res.status).toBe(422);
    });

    it('updates private domains and dated window', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ id: 'c1', visibility: 'PRIVATE', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.update).mockResolvedValue({ id: 'c1' } as any);

      const res = await PATCH(makeReq('http://localhost/api/campaigns/c1', 'PATCH', {
        allowedEmailDomains: ['campus.edu'],
        startAt: '2026-02-01T00:00:00.000Z',
        endAt: '2026-03-01T00:00:00.000Z',
      }), { params: Promise.resolve({ id: 'c1' }) });
      expect(res.status).toBe(200);
      expect(prisma.campaign.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          allowedEmailDomainsJson: ['@campus.edu'],
          startAt: expect.any(Date),
          endAt: expect.any(Date),
        }),
      }));
    });

    it('clears domains when PUBLIC campaign receives empty domain list', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        id: 'c1',
        visibility: 'PUBLIC',
        organizationId: 'org1',
      } as any);
      vi.mocked(prisma.campaign.update).mockResolvedValue({ id: 'c1' } as any);

      const res = await PATCH(makeReq('http://localhost/api/campaigns/c1', 'PATCH', {
        allowedEmailDomains: [],
      }), { params: Promise.resolve({ id: 'c1' }) });
      expect(res.status).toBe(200);
    });

    it('returns handled error on PATCH failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('patch boom'));
      expect((await PATCH(makeReq('http://localhost/api/campaigns/c1', 'PATCH', { name: 'X' }), {
        params: Promise.resolve({ id: 'c1' }),
      })).status).toBe(500);
    });
  });

  describe('DELETE', () => {
    it('soft deletes (ends) if sessions exist (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ id: 'c1' } as any);
      vi.mocked(prisma.depositSession.count).mockResolvedValue(5);
      vi.mocked(prisma.campaign.update).mockResolvedValue({ id: 'c1', status: 'ENDED' } as any);

      const res = await DELETE(makeReq('http://localhost/api/campaigns/c1', 'DELETE'), { params: Promise.resolve({ id: 'c1' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ended).toBe(true);
      expect(prisma.campaign.update).toHaveBeenCalledWith({
        where: { id: 'c1' },
        data: { status: 'ENDED' }
      });
      expect(prisma.campaign.delete).not.toHaveBeenCalled();
    });

    it('hard deletes if no sessions exist (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ id: 'c1' } as any);
      vi.mocked(prisma.depositSession.count).mockResolvedValue(0);

      const res = await DELETE(makeReq('http://localhost/api/campaigns/c1', 'DELETE'), { params: Promise.resolve({ id: 'c1' }) });
      expect(res.status).toBe(200);
      
      expect(prisma.rewardRate.deleteMany).toHaveBeenCalledWith({ where: { campaignId: 'c1' } });
      expect(prisma.campaign.delete).toHaveBeenCalledWith({ where: { id: 'c1' } });
    });

    it('returns handled error on DELETE failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('delete boom'));
      expect((await DELETE(makeReq('http://localhost/api/campaigns/c1', 'DELETE'), {
        params: Promise.resolve({ id: 'c1' }),
      })).status).toBe(500);
    });
  });
});
