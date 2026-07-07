import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/partnerships/route';
import { PATCH } from '@/app/api/partnerships/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organizationCollectorPartner: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn() },
    organization: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

describe('/api/partnerships endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (url: string, method = 'GET', body?: any) => new Request(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });

  describe('GET', () => {
    it('returns partnerships for PENGEPUL (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findMany).mockResolvedValue([{ id: 'p1', collectorUser: {} }] as any);
      vi.mocked(prisma.organizationCollectorPartner.count).mockResolvedValue(1);

      const res = await GET(makeReq('http://localhost/api/partnerships'));
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.partnerships).toHaveLength(1);
      expect(prisma.organizationCollectorPartner.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { collectorUserId: 'coll1' }
      }));
    });
  });

  describe('POST', () => {
    it('admin invites collector (201)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.organizationCollectorPartner.create).mockResolvedValue({ id: 'p1' } as any);

      const res = await POST(makeReq('http://localhost/api/partnerships', 'POST', {
        collectorEmail: 'coll@test.com'
      }));
      
      expect(res.status).toBe(201);
      expect(prisma.organizationCollectorPartner.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ 
          organizationId: 'org1', 
          collectorUserId: 'coll1',
          status: 'INVITED'
        })
      }));
    });

    it('pengepul requests org (201)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: 'org1' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.organizationCollectorPartner.create).mockResolvedValue({ id: 'p1' } as any);

      const res = await POST(makeReq('http://localhost/api/partnerships', 'POST', {
        organizationId: 'org1'
      }));
      
      expect(res.status).toBe(201);
      expect(prisma.organizationCollectorPartner.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ 
          organizationId: 'org1', 
          collectorUserId: 'coll1',
          status: 'REQUESTED'
        })
      }));
    });
  });

  describe('PATCH', () => {
    it('collector accepts invite (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue({ 
        id: 'p1', 
        collectorUserId: 'coll1', 
        status: 'INVITED' 
      } as any);
      vi.mocked(prisma.organizationCollectorPartner.update).mockResolvedValue({ id: 'p1', status: 'ACTIVE' } as any);

      const res = await PATCH(makeReq('http://localhost/api/partnerships/p1', 'PATCH', {
        action: 'accept'
      }), { params: Promise.resolve({ id: 'p1' }) });
      
      expect(res.status).toBe(200);
      expect(prisma.organizationCollectorPartner.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING_SUPERADMIN_APPROVAL' })
      }));
    });

    it('set_area updates info without state transition (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue({ 
        id: 'p1', 
        collectorUserId: 'coll1', 
      } as any);
      vi.mocked(prisma.organizationCollectorPartner.update).mockResolvedValue({ id: 'p1' } as any);

      const res = await PATCH(makeReq('http://localhost/api/partnerships/p1', 'PATCH', {
        action: 'set_area',
        contactName: 'John'
      }), { params: Promise.resolve({ id: 'p1' }) });
      
      expect(res.status).toBe(200);
      expect(prisma.organizationCollectorPartner.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ contactName: 'John' })
      }));
    });
  });
});
