import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET as getList, POST } from '@/app/api/machines/route';
import { GET as getOne, PATCH, DELETE } from '@/app/api/machines/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const mockTx = {
    machine: { update: vi.fn() },
    machineWasteType: { deleteMany: vi.fn(), createMany: vi.fn() },
  };
  return {
    prisma: {
      machine: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), delete: vi.fn(), count: vi.fn() },
      organization: { findUnique: vi.fn() },
      machineWasteType: { deleteMany: vi.fn() },
      depositSession: { count: vi.fn() },
      machineEvent: { count: vi.fn() },
      pickupRequest: { count: vi.fn() },
      $transaction: vi.fn().mockImplementation((cb) => cb(mockTx)),
    },
    mockTx,
  };
});

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  assertOrgScope: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/qr', () => ({ generateToken: vi.fn().mockReturnValue('qr_token') }));
vi.mock('@/lib/machine-auth', () => ({ generateIngestSecret: vi.fn().mockReturnValue('secret') }));

describe('/api/machines endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (url: string, method: string = 'GET', body?: any) => {
    return new NextRequest(url, {
      method,
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  describe('GET list', () => {
    it('returns filtered list based on role', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.machine.count).mockResolvedValue(1);
      vi.mocked(prisma.machine.findMany).mockResolvedValue([{ id: 'm1' }] as any);

      const req = makeReq('http://localhost/api/machines?status=ONLINE');
      const res = await getList(req);
      
      expect(res.status).toBe(200);
      expect(prisma.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { organizationId: 'org1', status: 'ONLINE' }
      }));
    });

    it('uses __none__ when ADMIN has no organization', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ role: 'ADMIN', organizationId: null } as any);
      vi.mocked(prisma.machine.count).mockResolvedValue(0);
      vi.mocked(prisma.machine.findMany).mockResolvedValue([]);
      await getList(makeReq('http://localhost/api/machines'));
      expect(prisma.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { organizationId: '__none__' },
      }));
    });

    it('filters SUPERADMIN list by organizationId', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.count).mockResolvedValue(0);
      vi.mocked(prisma.machine.findMany).mockResolvedValue([]);
      await getList(makeReq('http://localhost/api/machines?organizationId=org9'));
      expect(prisma.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { organizationId: 'org9' },
      }));
    });

    it('returns handled error on list failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('list boom'));
      expect((await getList(makeReq('http://localhost/api/machines'))).status).toBe(500);
    });
  });

  describe('POST create', () => {
    it('requires SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await POST(makeReq('http://localhost/api/machines', 'POST', {}));
      expect(res.status).toBe(403);
    });

    it('creates machine successfully (201)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: 'org1' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.machine.create).mockResolvedValue({ id: 'new_m1' } as any);

      const res = await POST(makeReq('http://localhost/api/machines', 'POST', {
        machineCode: 'M-001',
        name: 'Machine 1',
        organizationId: 'org1'
      }));
      
      expect(res.status).toBe(201);
      expect(prisma.machine.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ machineCode: 'M-001', qrToken: 'qr_token' })
      }));
    });

    it('creates machine with wasteTypeIds', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: 'org1' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.machine.create).mockResolvedValue({
        id: 'new_m2',
        machineCode: 'M-002',
        name: 'Machine 2',
        organizationId: 'org1',
      } as any);

      const res = await POST(makeReq('http://localhost/api/machines', 'POST', {
        machineCode: 'M-002',
        name: 'Machine 2',
        organizationId: 'org1',
        wasteTypeIds: ['wt1', 'wt2'],
      }));
      expect(res.status).toBe(201);
      expect(prisma.machine.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          wasteTypes: {
            create: [
              { wasteTypeId: 'wt1', active: true },
              { wasteTypeId: 'wt2', active: true },
            ],
          },
        }),
      }));
    });

    it('returns 422 when organization missing', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);
      const res = await POST(makeReq('http://localhost/api/machines', 'POST', {
        machineCode: 'M-003',
        name: 'Machine 3',
        organizationId: 'missing',
      }));
      expect(res.status).toBe(422);
    });

    it('returns 409 when machine code exists', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: 'org1' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'existing' } as any);
      const res = await POST(makeReq('http://localhost/api/machines', 'POST', {
        machineCode: 'M-001',
        name: 'Machine 1',
        organizationId: 'org1',
      }));
      expect(res.status).toBe(409);
    });

    it('returns handled error on create failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('create boom'));
      expect((await POST(makeReq('http://localhost/api/machines', 'POST', {
        machineCode: 'M-001',
        name: 'Machine 1',
        organizationId: 'org1',
      }))).status).toBe(500);
    });
  });

  describe('GET detail', () => {
    it('checks org scope for ADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'org2' } as any); // different org

      const req = makeReq('http://localhost/api/machines/m1');
      const res = await getOne(req, { params: Promise.resolve({ id: 'm1' }) });
      expect(res.status).toBe(403);
    });

    it('returns machine details for SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ role: 'SUPERADMIN', organizationId: null } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'org1' } as any);

      const req = makeReq('http://localhost/api/machines/m1');
      const res = await getOne(req, { params: Promise.resolve({ id: 'm1' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.machine.id).toBe('m1');
    });

    it('returns 404 when machine missing', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
      expect((await getOne(makeReq('http://localhost/api/machines/m1'), {
        params: Promise.resolve({ id: 'm1' }),
      })).status).toBe(404);
    });
  });

  describe('PATCH update', () => {
    it('updates machine and waste types', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN', organizationId: null } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'org1' } as any);
      
      const { mockTx } = await import('@/lib/prisma') as any;
      mockTx.machine.update.mockResolvedValue({ id: 'm1' });

      const req = makeReq('http://localhost/api/machines/m1', 'PATCH', {
        name: 'Updated Name',
        wasteTypeIds: ['wt1', 'wt2']
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: 'm1' }) });
      
      expect(res.status).toBe(200);
      expect(mockTx.machine.update).toHaveBeenCalledWith(expect.objectContaining({
        data: { name: 'Updated Name' }
      }));
      expect(mockTx.machineWasteType.deleteMany).toHaveBeenCalled();
      expect(mockTx.machineWasteType.createMany).toHaveBeenCalled();
    });

    it('clears waste types when empty array provided', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'org1' } as any);
      const { mockTx } = await import('@/lib/prisma') as any;
      mockTx.machine.update.mockResolvedValue({ id: 'm1' });
      mockTx.machineWasteType.createMany.mockClear();

      const res = await PATCH(makeReq('http://localhost/api/machines/m1', 'PATCH', {
        wasteTypeIds: [],
      }), { params: Promise.resolve({ id: 'm1' }) });
      expect(res.status).toBe(200);
      expect(mockTx.machineWasteType.deleteMany).toHaveBeenCalled();
      expect(mockTx.machineWasteType.createMany).not.toHaveBeenCalled();
    });

    it('returns handled error on patch failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('patch boom'));
      expect((await PATCH(makeReq('http://localhost/api/machines/m1', 'PATCH', {
        name: 'X',
      }), { params: Promise.resolve({ id: 'm1' }) })).status).toBe(500);
    });
  });

  describe('DELETE', () => {
    it('prevents deletion if history exists (409)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ role: 'SUPERADMIN', organizationId: null } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'org1' } as any);
      vi.mocked(prisma.depositSession.count).mockResolvedValue(1);

      const req = makeReq('http://localhost/api/machines/m1', 'DELETE');
      const res = await DELETE(req, { params: Promise.resolve({ id: 'm1' }) });
      expect(res.status).toBe(409);
    });

    it('deletes machine successfully (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ role: 'SUPERADMIN', organizationId: null } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'org1' } as any);
      vi.mocked(prisma.depositSession.count).mockResolvedValue(0);
      vi.mocked(prisma.machineEvent.count).mockResolvedValue(0);
      vi.mocked(prisma.pickupRequest.count).mockResolvedValue(0);

      const req = makeReq('http://localhost/api/machines/m1', 'DELETE');
      const res = await DELETE(req, { params: Promise.resolve({ id: 'm1' }) });
      expect(res.status).toBe(200);
      expect(prisma.machine.delete).toHaveBeenCalledWith({ where: { id: 'm1' } });
    });

    it('returns handled error on delete failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('delete boom'));
      expect((await DELETE(makeReq('http://localhost/api/machines/m1', 'DELETE'), {
        params: Promise.resolve({ id: 'm1' }),
      })).status).toBe(500);
    });
  });
});
