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

    it('scopes ADMIN list by organization and status filter', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({
        id: 'admin1',
        role: 'ADMIN',
        organizationId: 'org1',
      } as any);
      vi.mocked(prisma.organizationCollectorPartner.findMany).mockResolvedValue([]);
      vi.mocked(prisma.organizationCollectorPartner.count).mockResolvedValue(0);

      const res = await GET(makeReq('http://localhost/api/partnerships?status=ACTIVE'));
      expect(res.status).toBe(200);
      expect(prisma.organizationCollectorPartner.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: 'org1', status: 'ACTIVE' },
        }),
      );
    });

    it('uses __none__ when ADMIN has no organization', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({
        id: 'admin1',
        role: 'ADMIN',
        organizationId: null,
      } as any);
      vi.mocked(prisma.organizationCollectorPartner.findMany).mockResolvedValue([]);
      vi.mocked(prisma.organizationCollectorPartner.count).mockResolvedValue(0);

      await GET(makeReq('http://localhost/api/partnerships'));
      expect(prisma.organizationCollectorPartner.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { organizationId: '__none__' } }),
      );
    });

    it('handles unexpected GET errors', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('boom'));
      const res = await GET(makeReq('http://localhost/api/partnerships'));
      expect(res.status).toBe(500);
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

    it('rejects pengepul request without organizationId', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      const res = await POST(makeReq('http://localhost/api/partnerships', 'POST', {}));
      expect(res.status).toBe(422);
    });

    it('returns 404 when requested organization is missing', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);
      const res = await POST(makeReq('http://localhost/api/partnerships', 'POST', {
        organizationId: 'missing',
      }));
      expect(res.status).toBe(404);
    });

    it('rejects admin without organization', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({
        id: 'admin1',
        role: 'ADMIN',
        organizationId: null,
      } as any);
      const res = await POST(makeReq('http://localhost/api/partnerships', 'POST', {
        collectorEmail: 'coll@test.com',
      }));
      expect(res.status).toBe(422);
    });

    it('rejects admin invite without collector email', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({
        id: 'admin1',
        role: 'ADMIN',
        organizationId: 'org1',
      } as any);
      const res = await POST(makeReq('http://localhost/api/partnerships', 'POST', {}));
      expect(res.status).toBe(422);
    });

    it('returns 404 when collector email is not a PENGEPUL', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({
        id: 'admin1',
        role: 'ADMIN',
        organizationId: 'org1',
      } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      const res = await POST(makeReq('http://localhost/api/partnerships', 'POST', {
        collectorEmail: 'user@test.com',
      }));
      expect(res.status).toBe(404);
    });

    it('reopens REMOVED partnership instead of creating duplicate', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({
        id: 'admin1',
        role: 'ADMIN',
        organizationId: 'org1',
      } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue({
        id: 'p1',
        status: 'REMOVED',
      } as any);
      vi.mocked(prisma.organizationCollectorPartner.update).mockResolvedValue({
        id: 'p1',
        status: 'INVITED',
      } as any);

      const res = await POST(makeReq('http://localhost/api/partnerships', 'POST', {
        collectorEmail: 'coll@test.com',
      }));
      expect(res.status).toBe(201);
      expect(prisma.organizationCollectorPartner.update).toHaveBeenCalled();
      expect(prisma.organizationCollectorPartner.create).not.toHaveBeenCalled();
    });

    it('returns 409 when active partnership already exists', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({
        id: 'admin1',
        role: 'ADMIN',
        organizationId: 'org1',
      } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue({
        id: 'p1',
        status: 'ACTIVE',
      } as any);

      const res = await POST(makeReq('http://localhost/api/partnerships', 'POST', {
        collectorEmail: 'coll@test.com',
      }));
      expect(res.status).toBe(409);
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

    it('returns 404 when partnership missing', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue(null);
      const res = await PATCH(makeReq('http://localhost/api/partnerships/p1', 'PATCH', {
        action: 'approve',
      }), { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(404);
    });

    it('rejects ADMIN outside org scope', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({
        id: 'a1',
        role: 'ADMIN',
        organizationId: 'org1',
      } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue({
        id: 'p1',
        organizationId: 'org2',
        collectorUserId: 'coll1',
        status: 'INVITED',
      } as any);
      const res = await PATCH(makeReq('http://localhost/api/partnerships/p1', 'PATCH', {
        action: 'remove',
      }), { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(403);
    });

    it('rejects PENGEPUL for another collectors partnership', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll2', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue({
        id: 'p1',
        organizationId: 'org1',
        collectorUserId: 'coll1',
        status: 'INVITED',
      } as any);
      const res = await PATCH(makeReq('http://localhost/api/partnerships/p1', 'PATCH', {
        action: 'accept',
      }), { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(403);
    });

    it('superadmin approve sets approvedBySuperadminId', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue({
        id: 'p1',
        organizationId: 'org1',
        collectorUserId: 'coll1',
        status: 'PENDING_SUPERADMIN_APPROVAL',
      } as any);
      vi.mocked(prisma.organizationCollectorPartner.update).mockResolvedValue({
        id: 'p1',
        status: 'ACTIVE',
      } as any);

      const res = await PATCH(makeReq('http://localhost/api/partnerships/p1', 'PATCH', {
        action: 'approve',
      }), { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(200);
      expect(prisma.organizationCollectorPartner.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ACTIVE',
            approvedBySuperadminId: 's1',
          }),
        }),
      );
    });

    it('rejects set_area when caller is not owner or superadmin', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue({
        id: 'p1',
        organizationId: 'org1',
        collectorUserId: 'coll1',
        status: 'ACTIVE',
      } as any);

      const res = await PATCH(makeReq('http://localhost/api/partnerships/p1', 'PATCH', {
        action: 'set_area',
        contactName: 'Nope',
      }), { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(403);
    });

    it('rejects invalid transition with 409', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue({
        id: 'p1',
        organizationId: 'org1',
        collectorUserId: 'coll1',
        status: 'ACTIVE',
      } as any);

      const res = await PATCH(makeReq('http://localhost/api/partnerships/p1', 'PATCH', {
        action: 'accept',
      }), { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(409);
    });

    it('superadmin can set_area', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.organizationCollectorPartner.findUnique).mockResolvedValue({
        id: 'p1',
        organizationId: 'org1',
        collectorUserId: 'coll1',
        status: 'ACTIVE',
      } as any);
      vi.mocked(prisma.organizationCollectorPartner.update).mockResolvedValue({ id: 'p1' } as any);

      const res = await PATCH(makeReq('http://localhost/api/partnerships/p1', 'PATCH', {
        action: 'set_area',
        serviceArea: { regions: ['r1'], note: 'n' },
        notes: 'note',
      }), { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(200);
    });

    it('returns handled error on patch failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('patch boom'));
      expect((await PATCH(makeReq('http://localhost/api/partnerships/p1', 'PATCH', {
        action: 'approve',
      }), { params: Promise.resolve({ id: 'p1' }) })).status).toBe(500);
    });
  });
});
