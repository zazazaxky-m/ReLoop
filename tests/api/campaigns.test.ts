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
  });

  describe('PATCH', () => {
    it('updates campaign (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ id: 'c1', visibility: 'PUBLIC' } as any);
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
  });
});
