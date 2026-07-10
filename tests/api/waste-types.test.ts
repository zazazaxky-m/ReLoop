import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/waste-types/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    wasteType: { findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    organization: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  assertOrgScope: vi.fn(),
  activePartnerOrgIds: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/pagination', async (importOriginal) => {
  const actual = await importOriginal();
  return actual as any;
});

describe('/api/waste-types', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET', () => {
    it('returns waste types for SUPERADMIN (no scope filter)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.wasteType.findMany).mockResolvedValue([{ id: 'wt1', name: 'Plastik', organizationId: null }] as any);
      vi.mocked(prisma.wasteType.count).mockResolvedValue(1);
      vi.mocked(prisma.organization.findMany).mockResolvedValue([]);

      const res = await GET(new Request('http://localhost/api/waste-types'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.wasteTypes).toHaveLength(1);
    });

    it('returns waste types for ADMIN (org-scoped)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.wasteType.findMany).mockResolvedValue([]);
      vi.mocked(prisma.wasteType.count).mockResolvedValue(0);
      vi.mocked(prisma.organization.findMany).mockResolvedValue([]);

      const res = await GET(new Request('http://localhost/api/waste-types'));
      expect(res.status).toBe(200);
    });

    it('scopes ADMIN without organizationId to __none__', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: null } as any);
      vi.mocked(prisma.wasteType.findMany).mockResolvedValue([]);
      vi.mocked(prisma.wasteType.count).mockResolvedValue(0);
      vi.mocked(prisma.organization.findMany).mockResolvedValue([]);

      await GET(new Request('http://localhost/api/waste-types'));
      expect(prisma.wasteType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { organizationId: null },
              { organizationId: '__none__' },
            ],
          },
        }),
      );
    });

    it('returns waste types for PENGEPUL (partner org scoped)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
      vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue(['org1']);
      vi.mocked(prisma.wasteType.findMany).mockResolvedValue([]);
      vi.mocked(prisma.wasteType.count).mockResolvedValue(0);
      vi.mocked(prisma.organization.findMany).mockResolvedValue([]);

      const res = await GET(new Request('http://localhost/api/waste-types'));
      expect(res.status).toBe(200);
    });

    it('PENGEPUL without partner orgs only sees global types', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
      vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue([]);
      vi.mocked(prisma.wasteType.findMany).mockResolvedValue([]);
      vi.mocked(prisma.wasteType.count).mockResolvedValue(0);
      vi.mocked(prisma.organization.findMany).mockResolvedValue([]);

      await GET(new Request('http://localhost/api/waste-types'));
      expect(prisma.wasteType.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ organizationId: null }] },
        }),
      );
    });

    it('returns waste types for USER (no filter)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.wasteType.findMany).mockResolvedValue([]);
      vi.mocked(prisma.wasteType.count).mockResolvedValue(0);
      vi.mocked(prisma.organization.findMany).mockResolvedValue([]);

      const res = await GET(new Request('http://localhost/api/waste-types'));
      expect(res.status).toBe(200);
    });

    it('enriches waste types with organization data', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.wasteType.findMany).mockResolvedValue([
        { id: 'wt1', name: 'Plastik', organizationId: 'org1' },
      ] as any);
      vi.mocked(prisma.wasteType.count).mockResolvedValue(1);
      vi.mocked(prisma.organization.findMany).mockResolvedValue([
        { id: 'org1', name: 'Org 1', type: 'BANK_SAMPAH' },
      ] as any);

      const res = await GET(new Request('http://localhost/api/waste-types'));
      const data = await res.json();
      expect(data.wasteTypes[0].organization.name).toBe('Org 1');
    });

    it('maps missing organization join to null', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.wasteType.findMany).mockResolvedValue([
        { id: 'wt1', name: 'Plastik', organizationId: 'deleted-org' },
        { id: 'wt2', name: 'Global', organizationId: null },
      ] as any);
      vi.mocked(prisma.wasteType.count).mockResolvedValue(2);
      vi.mocked(prisma.organization.findMany).mockResolvedValue([]);

      const res = await GET(new Request('http://localhost/api/waste-types'));
      const data = await res.json();
      expect(data.wasteTypes[0].organization).toBeNull();
      expect(data.wasteTypes[1].organization).toBeNull();
    });

    it('handles unexpected errors', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('Unexpected GET error'));
      const res = await GET(new Request('http://localhost'));
      expect(res.status).toBe(500);
    });
  });

  describe('POST', () => {
    it('handles unexpected errors', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('Unexpected POST error'));
      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ name: 'Plastik' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(500);
    });
    it('returns 403 when not ADMIN or SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ name: 'Test', unit: 'ITEM' }) });
      const res = await POST(req);
      expect(res.status).toBe(403);
    });

    it('creates waste type as SUPERADMIN (global)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.wasteType.create).mockResolvedValue({ id: 'wt1', name: 'Kaca' } as any);

      const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ name: 'Kaca' }) });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it('SUPERADMIN can create org-scoped type and assert scope', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.wasteType.create).mockResolvedValue({ id: 'wt1', name: 'Kaca' } as any);

      const res = await POST(new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ name: 'Kaca', organizationId: 'org9' }),
      }));
      expect(res.status).toBe(201);
      expect(rbac.assertOrgScope).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'SUPERADMIN' }),
        'org9',
      );
    });

    it('ADMIN creates org-specific waste type', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.wasteType.create).mockResolvedValue({ id: 'wt1', name: 'Kaca' } as any);

      const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ name: 'Kaca' }) });
      const res = await POST(req);
      expect(res.status).toBe(201);
      expect(prisma.wasteType.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ organizationId: 'org1' }) }),
      );
    });

    it('returns 422 when ADMIN has no organizationId', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: null } as any);

      const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ name: 'Kaca' }) });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('returns 422 for invalid body (name too short)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ name: 'K' }) });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('returns 422 when minWeightGrams > maxWeightGrams', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ name: 'Kaca', minWeightGrams: 100, maxWeightGrams: 50 }) });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });
  });
});
