import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/regions/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as audit from '@/lib/audit';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    region: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

describe('/api/regions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (method = 'GET', body?: any) => new Request('http://localhost/api/regions', {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });

  describe('GET', () => {
    it('returns list of regions (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.region.findMany).mockResolvedValue([{ id: 'r1', name: 'Reg 1' }] as any);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.regions).toHaveLength(1);
    });

    it('denies access if not SUPERADMIN (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await GET();
      expect(res.status).toBe(403);
    });
  });

  describe('POST', () => {
    it('creates new region (201)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.region.create).mockResolvedValue({ id: 'r1', type: 'PROVINCE', name: 'Jawa Barat' } as any);

      const res = await POST(makeReq('POST', {
        type: 'PROVINCE',
        name: 'Jawa Barat'
      }));
      expect(res.status).toBe(201);
      
      expect(prisma.region.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ type: 'PROVINCE', name: 'Jawa Barat' })
      }));
    });

    it('rejects if parent region not found (404)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.region.findUnique).mockResolvedValue(null);

      const res = await POST(makeReq('POST', {
        type: 'REGENCY',
        name: 'Kota Bandung',
        parentId: 'invalid_id'
      }));
      expect(res.status).toBe(404);
    });
  });
});
