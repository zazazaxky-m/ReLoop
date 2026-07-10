import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/reward-rates/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rewardRate: {
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    campaign: { findUnique: vi.fn() },
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
vi.mock('@/lib/pagination', async (importOriginal) => {
  const actual = await importOriginal();
  return actual as any;
});

describe('/api/reward-rates', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET', () => {
    it('returns rates for SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.rewardRate.count).mockResolvedValue(1);
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([{ id: 'rr1' }] as any);

      const res = await GET(new Request('http://localhost/api/reward-rates'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.rates).toHaveLength(1);
    });

    it('scopes ADMIN with null organizationId to __none__', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: null } as any);
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([]);
      vi.mocked(prisma.rewardRate.count).mockResolvedValue(0);

      const res = await GET(new Request('http://localhost/api/reward-rates'));
      expect(res.status).toBe(200);
      expect(prisma.rewardRate.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { organizationId: null, campaignId: null },
              { organizationId: '__none__' },
              { campaign: { organizationId: '__none__' } },
            ],
          },
        }),
      );
    });

    it('returns rates for ADMIN (scoped)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.rewardRate.count).mockResolvedValue(0);
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([]);

      const res = await GET(new Request('http://localhost/api/reward-rates'));
      expect(res.status).toBe(200);
    });

    it('applies active filter when active=1', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.rewardRate.count).mockResolvedValue(0);
      vi.mocked(prisma.rewardRate.findMany).mockResolvedValue([]);

      await GET(new Request('http://localhost/api/reward-rates?active=1'));
      expect(prisma.rewardRate.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ active: true }) }),
      );
    });
    it('handles unexpected errors', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('Unexpected error GET'));
      const res = await GET(new Request('http://localhost/api/reward-rates'));
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    it('returns 400 when minWeightGrams > maxWeightGrams', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ wasteTypeId: 'wt1', pointsPerItem: 100, minWeightGrams: 500, maxWeightGrams: 200 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422); // zod validation error
    });

    it('handles unexpected errors', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('Unexpected error POST'));
      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ wasteTypeId: 'wt1', pointsPerItem: 100 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(500);
    });
    it('returns 403 when not authorized', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ wasteTypeId: 'wt1', pointsPerItem: 100 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });

    it('returns 422 when ADMIN has no org', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: null } as any);
      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ wasteTypeId: 'wt1', pointsPerItem: 100 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('creates rate with versioning as SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          rewardRate: {
            updateMany: vi.fn(),
            create: vi.fn().mockResolvedValue({ id: 'rr1' }),
          },
        };
        return fn(mockTx);
      });

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ wasteTypeId: 'wt1', pointsPerItem: 500 }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it('uses explicit organizationId for SUPERADMIN when provided', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(rbac.assertOrgScope).mockImplementation(() => undefined);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          rewardRate: {
            updateMany: vi.fn(),
            create: vi.fn().mockResolvedValue({ id: 'rr1', organizationId: 'org9' }),
          },
        };
        return fn(mockTx);
      });

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ wasteTypeId: 'wt1', pointsPerItem: 500, organizationId: 'org9' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(rbac.assertOrgScope).toHaveBeenCalled();
    });

    it('validates campaign belongs to admin org', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({ id: 'c1', organizationId: 'org2' } as any);

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ wasteTypeId: 'wt1', pointsPerItem: 100, campaignId: 'c1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });

    it('returns 422 when campaign not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue(null);

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ wasteTypeId: 'wt1', pointsPerItem: 100, campaignId: 'notexist' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('inherits organizationId from campaign for SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
        id: 'c1',
        organizationId: 'org-from-campaign',
      } as any);

      let createdData: any;
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          rewardRate: {
            updateMany: vi.fn(),
            create: vi.fn().mockImplementation(({ data }) => {
              createdData = data;
              return { id: 'rr1', ...data };
            }),
          },
        };
        return fn(mockTx);
      });

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ wasteTypeId: 'wt1', pointsPerItem: 100, campaignId: 'c1' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(createdData.organizationId).toBe('org-from-campaign');
    });
  });
});
