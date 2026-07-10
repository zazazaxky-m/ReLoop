import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET as getList, POST } from '@/app/api/pickups/route';
import { GET as getOne, PATCH } from '@/app/api/pickups/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => {
  const mockTx = {
    pickupRequest: { update: vi.fn() },
    machine: { findUnique: vi.fn(), update: vi.fn() },
  };
  return {
    prisma: {
      pickupRequest: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
      machine: { findUnique: vi.fn() },
      $transaction: vi.fn().mockImplementation((cb) => cb(mockTx)),
    },
    mockTx,
  };
});

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  assertOrgScope: vi.fn(),
  activePartnerOrgIds: vi.fn(),
  assertActivePartnership: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn().mockResolvedValue({ id: 'n1' }),
}));

describe('/api/pickups endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (url: string, method = 'GET', body?: any) => new Request(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });

  describe('GET list', () => {
    it('returns available open pickups for PENGEPUL (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue(['org1']);
      vi.mocked(prisma.pickupRequest.count).mockResolvedValue(1);
      vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([{ id: 'p1' }] as any);

      const res = await getList(makeReq('http://localhost/api/pickups?scope=available'));
      expect(res.status).toBe(200);
      
      expect(prisma.pickupRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          organizationId: { in: ['org1'] },
          assignedCollectorId: null,
          status: { in: expect.any(Array) },
        }
      }));
    });

    it('uses __none__ when PENGEPUL has no partner orgs', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue([]);
      vi.mocked(prisma.pickupRequest.count).mockResolvedValue(0);
      vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([]);

      await getList(makeReq('http://localhost/api/pickups?scope=available'));
      expect(prisma.pickupRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ organizationId: { in: ['__none__'] } }),
      }));
    });

    it('lists assigned pickups for PENGEPUL without available scope', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.pickupRequest.count).mockResolvedValue(0);
      vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([]);

      await getList(makeReq('http://localhost/api/pickups'));
      expect(prisma.pickupRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { assignedCollectorId: 'coll1' },
      }));
    });

    it('scopes ADMIN list by organization and status filter', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.pickupRequest.count).mockResolvedValue(0);
      vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([]);

      await getList(makeReq('http://localhost/api/pickups?status=REQUESTED'));
      expect(prisma.pickupRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { organizationId: 'org1', status: 'REQUESTED' },
      }));
    });

    it('uses __none__ when ADMIN has no organization', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: null } as any);
      vi.mocked(prisma.pickupRequest.count).mockResolvedValue(0);
      vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([]);

      await getList(makeReq('http://localhost/api/pickups'));
      expect(prisma.pickupRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { organizationId: '__none__' },
      }));
    });

    it('lists all pickups for SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.pickupRequest.count).mockResolvedValue(0);
      vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([]);

      await getList(makeReq('http://localhost/api/pickups'));
      expect(prisma.pickupRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {},
      }));
    });

    it('returns handled error on list failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('list boom'));
      expect((await getList(makeReq('http://localhost/api/pickups'))).status).toBe(500);
    });
  });

  describe('POST create', () => {
    it('creates pickup for machine (201)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'org1' } as any);
      vi.mocked(prisma.pickupRequest.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.pickupRequest.create).mockResolvedValue({ id: 'p1' } as any);

      const res = await POST(makeReq('http://localhost/api/pickups', 'POST', {
        machineId: 'm1',
        reason: 'FULL'
      }));
      
      expect(res.status).toBe(201);
      expect(prisma.pickupRequest.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ machineId: 'm1', organizationId: 'org1' })
      }));
    });

    it('returns existing open pickup if any (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'org1' } as any);
      vi.mocked(prisma.pickupRequest.findFirst).mockResolvedValue({ id: 'existing_p1' } as any);

      const res = await POST(makeReq('http://localhost/api/pickups', 'POST', {
        machineId: 'm1',
      }));
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.existing).toBe(true);
      expect(data.pickup.id).toBe('existing_p1');
    });

    it('returns 404 when machine is missing', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);

      const res = await POST(makeReq('http://localhost/api/pickups', 'POST', { machineId: 'missing' }));
      expect(res.status).toBe(404);
    });

    it('rejects machine from another organization', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'org2' } as any);

      const res = await POST(makeReq('http://localhost/api/pickups', 'POST', { machineId: 'm1' }));
      expect(res.status).toBe(422);
    });

    it('requires organizationId for SUPERADMIN without machine', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);

      const res = await POST(makeReq('http://localhost/api/pickups', 'POST', { reason: 'MANUAL' }));
      expect(res.status).toBe(422);
    });

    it('creates pickup for SUPERADMIN with organizationId', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.pickupRequest.create).mockResolvedValue({ id: 'p2' } as any);

      const res = await POST(makeReq('http://localhost/api/pickups', 'POST', {
        organizationId: 'org9',
        reason: 'SCHEDULED',
        priority: 2,
        notes: 'note',
      }));
      expect(res.status).toBe(201);
      expect(prisma.pickupRequest.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org9',
          priority: 2,
          notes: 'note',
          machineId: null,
        }),
      }));
    });

    it('derives organizationId from machine for SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', organizationId: 'org3' } as any);
      vi.mocked(prisma.pickupRequest.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.pickupRequest.create).mockResolvedValue({ id: 'p3' } as any);

      const res = await POST(makeReq('http://localhost/api/pickups', 'POST', { machineId: 'm1' }));
      expect(res.status).toBe(201);
      expect(prisma.pickupRequest.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org3' }),
      }));
    });

    it('returns handled error on create failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('create boom'));
      expect((await POST(makeReq('http://localhost/api/pickups', 'POST', {
        organizationId: 'org1',
      }))).status).toBe(500);
    });
  });

  describe('GET detail', () => {
    it('forbids unassigned PENGEPUL (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({ id: 'p1', assignedCollectorId: 'other_coll' } as any);

      const res = await getOne(makeReq('http://localhost/api/pickups/p1'), { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(403);
    });

    it('returns 404 when pickup missing', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue(null);
      expect((await getOne(makeReq('http://localhost/api/pickups/p1'), {
        params: Promise.resolve({ id: 'p1' }),
      })).status).toBe(404);
    });

    it('forbids ADMIN outside org scope', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({
        id: 'p1',
        organizationId: 'org2',
        assignedCollectorId: null,
      } as any);
      expect((await getOne(makeReq('http://localhost/api/pickups/p1'), {
        params: Promise.resolve({ id: 'p1' }),
      })).status).toBe(403);
    });

    it('returns pickup for assigned PENGEPUL', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({
        id: 'p1',
        assignedCollectorId: 'coll1',
        organizationId: 'org1',
      } as any);
      const res = await getOne(makeReq('http://localhost/api/pickups/p1'), {
        params: Promise.resolve({ id: 'p1' }),
      });
      expect(res.status).toBe(200);
    });

    it('returns handled error on detail failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('detail boom'));
      expect((await getOne(makeReq('http://localhost/api/pickups/p1'), {
        params: Promise.resolve({ id: 'p1' }),
      })).status).toBe(500);
    });
  });

  describe('PATCH action', () => {
    it('admin can assign collector (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({ id: 'p1', organizationId: 'org1', status: 'REQUESTED' } as any);
      vi.mocked(rbac.assertActivePartnership).mockResolvedValue({ id: 'partner_1' } as any);
      
      const { mockTx } = await import('@/lib/prisma') as any;
      mockTx.pickupRequest.update.mockResolvedValue({ id: 'p1', status: 'ASSIGNED' });

      const res = await PATCH(makeReq('http://localhost/api/pickups/p1', 'PATCH', {
        action: 'assign',
        collectorUserId: 'coll1'
      }), { params: Promise.resolve({ id: 'p1' }) });
      
      expect(res.status).toBe(200);
      expect(mockTx.pickupRequest.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'ASSIGNED', assignedCollectorId: 'coll1' })
      }));
    });

    it('completing resets machine (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({ 
        id: 'p1', 
        assignedCollectorId: 'coll1', 
        status: 'COLLECTED', 
        machineId: 'm1' 
      } as any);
      
      const { mockTx } = await import('@/lib/prisma') as any;
      mockTx.pickupRequest.update.mockResolvedValue({ id: 'p1', status: 'COMPLETED' });
      mockTx.machine.findUnique.mockResolvedValue({ id: 'm1', status: 'FULL' });

      const res = await PATCH(makeReq('http://localhost/api/pickups/p1', 'PATCH', {
        action: 'complete',
      }), { params: Promise.resolve({ id: 'p1' }) });
      
      expect(res.status).toBe(200);
      expect(mockTx.machine.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'm1' },
        data: expect.objectContaining({ fillLevelPercent: 0, status: 'ONLINE' })
      }));
    });

    it('returns 404 when patching missing pickup', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue(null);
      expect((await PATCH(makeReq('http://localhost/api/pickups/p1', 'PATCH', {
        action: 'cancel',
      }), { params: Promise.resolve({ id: 'p1' }) })).status).toBe(404);
    });

    it('forbids ADMIN outside org on patch', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({
        id: 'p1',
        organizationId: 'org2',
        status: 'REQUESTED',
      } as any);
      expect((await PATCH(makeReq('http://localhost/api/pickups/p1', 'PATCH', {
        action: 'cancel',
      }), { params: Promise.resolve({ id: 'p1' }) })).status).toBe(403);
    });

    it('rejects invalid transition', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({
        id: 'p1',
        assignedCollectorId: 'coll1',
        status: 'REQUESTED',
      } as any);
      expect((await PATCH(makeReq('http://localhost/api/pickups/p1', 'PATCH', {
        action: 'complete',
      }), { params: Promise.resolve({ id: 'p1' }) })).status).toBe(409);
    });

    it('requires collectorUserId on assign', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({
        id: 'p1',
        organizationId: 'org1',
        status: 'REQUESTED',
      } as any);
      expect((await PATCH(makeReq('http://localhost/api/pickups/p1', 'PATCH', {
        action: 'assign',
      }), { params: Promise.resolve({ id: 'p1' }) })).status).toBe(422);
    });

    it('keeps non-FULL machine status on complete', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({
        id: 'p1',
        assignedCollectorId: 'coll1',
        status: 'COLLECTED',
        machineId: 'm1',
      } as any);
      const { mockTx } = await import('@/lib/prisma') as any;
      mockTx.pickupRequest.update.mockResolvedValue({ id: 'p1', status: 'COMPLETED' });
      mockTx.machine.findUnique.mockResolvedValue({ id: 'm1', status: 'ONLINE' });

      await PATCH(makeReq('http://localhost/api/pickups/p1', 'PATCH', {
        action: 'complete',
      }), { params: Promise.resolve({ id: 'p1' }) });

      expect(mockTx.machine.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ status: 'ONLINE' }),
      }));
    });

    it('skips machine reset when machine row missing', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({
        id: 'p1',
        assignedCollectorId: 'coll1',
        status: 'COLLECTED',
        machineId: 'm1',
      } as any);
      const { mockTx } = await import('@/lib/prisma') as any;
      mockTx.pickupRequest.update.mockResolvedValue({ id: 'p1', status: 'COMPLETED' });
      mockTx.machine.findUnique.mockResolvedValue(null);
      mockTx.machine.update.mockClear();

      const res = await PATCH(makeReq('http://localhost/api/pickups/p1', 'PATCH', {
        action: 'complete',
      }), { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(200);
      expect(mockTx.machine.update).not.toHaveBeenCalled();
    });

    it('returns handled error on patch failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('patch boom'));
      expect((await PATCH(makeReq('http://localhost/api/pickups/p1', 'PATCH', {
        action: 'start',
      }), { params: Promise.resolve({ id: 'p1' }) })).status).toBe(500);
    });
  });
});
