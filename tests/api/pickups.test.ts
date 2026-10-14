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
  sendPushToUsersBestEffort: vi.fn(),
}));

// The transactional dispatch logic runs against real PostgreSQL in
// tests/integration/pickup-dispatch.test.ts; here only the route wiring.
vi.mock('@/lib/pickup-dispatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pickup-dispatch')>()),
  assignPickup: vi.fn(),
  transitionPickup: vi.fn(),
  createReplacementPickup: vi.fn(),
  escalateOnAdminRead: vi.fn().mockResolvedValue(undefined),
}));

import * as dispatch from '@/lib/pickup-dispatch';

describe('/api/pickups endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (url: string, method = 'GET', body?: any) => new Request(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });

  describe('GET list', () => {
    it('gives PENGEPUL no pool of unassigned tasks to claim (B05)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue(['org1']);

      const res = await getList(makeReq('http://localhost/api/pickups?scope=available'));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        pickups: [],
        pagination: expect.objectContaining({ total: 0 }),
      });
      expect(prisma.pickupRequest.findMany).not.toHaveBeenCalled();
      expect(rbac.activePartnerOrgIds).not.toHaveBeenCalled();
    });

    it('runs the lazy overdue escalation for admin reads and adds the dispatch view', async () => {
      const admin = { id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any;
      vi.mocked(rbac.requireApiUser).mockResolvedValue(admin);
      vi.mocked(prisma.pickupRequest.count).mockResolvedValue(1);
      vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([
        { id: 'p1', status: 'ASSIGNED', expectedStartAt: new Date(Date.now() - 1000), replacedBy: null },
      ] as any);

      const res = await getList(makeReq('http://localhost/api/pickups'));
      expect(dispatch.escalateOnAdminRead).toHaveBeenCalledWith(admin);
      const body = await res.json();
      expect(body.pickups[0].dispatch).toMatchObject({ overdue: true, nextActor: 'COLLECTOR', nextStatus: 'ON_THE_WAY' });
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

    it('creates a replacement for a closed task through the dispatch service', async () => {
      const admin = { id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any;
      vi.mocked(rbac.requireApiUser).mockResolvedValue(admin);
      vi.mocked(dispatch.createReplacementPickup).mockResolvedValueOnce({ pickup: { id: 'p9' } as any, existing: false });
      const created = await POST(makeReq('http://localhost/api/pickups', 'POST', { replacesPickupId: 'p1', priority: 3 }));
      expect(created.status).toBe(201);
      expect(dispatch.createReplacementPickup).toHaveBeenCalledWith(admin, 'p1', { priority: 3, notes: undefined });
      expect(prisma.pickupRequest.create).not.toHaveBeenCalled();

      vi.mocked(dispatch.createReplacementPickup).mockResolvedValueOnce({ pickup: { id: 'p9' } as any, existing: true });
      const retry = await POST(makeReq('http://localhost/api/pickups', 'POST', { replacesPickupId: 'p1' }));
      expect(retry.status).toBe(200);
      expect(await retry.json()).toEqual({ pickup: { id: 'p9' }, existing: true });
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

    it('runs the lazy escalation for this pickup on admin detail reads', async () => {
      const admin = { id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any;
      vi.mocked(rbac.requireApiUser).mockResolvedValue(admin);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({
        id: 'p1', organizationId: 'org1', status: 'REQUESTED', expectedStartAt: null, replacedBy: null,
      } as any);
      const res = await getOne(makeReq('http://localhost/api/pickups/p1'), { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(200);
      expect(dispatch.escalateOnAdminRead).toHaveBeenCalledWith(admin, { pickupIds: ['p1'] });
      expect((await res.json()).pickup.dispatch).toMatchObject({ nextActor: 'ADMIN', nextStatus: 'ASSIGNED' });
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
    const params = { params: Promise.resolve({ id: 'p1' }) };
    const patchReq = (body: unknown) => makeReq('http://localhost/api/pickups/p1', 'PATCH', body);
    const admin = { id: 'admin1', role: 'ADMIN', organizationId: 'org1' } as any;
    const collector = { id: 'coll1', role: 'PENGEPUL', organizationId: null } as any;
    const assigned = { id: 'p1', status: 'ASSIGNED', version: 3, expectedStartAt: null, assignedCollectorId: 'coll1' };

    it('maps the existing collectorUserId field to assignPickup and returns the new version', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue(admin);
      vi.mocked(dispatch.assignPickup).mockResolvedValue(assigned as any);

      const res = await PATCH(patchReq({
        action: 'assign', collectorUserId: 'coll1', expectedVersion: 2, expectedStartAt: '2026-11-01T08:00:00+07:00',
      }), params);

      expect(res.status).toBe(200);
      expect(dispatch.assignPickup).toHaveBeenCalledWith(admin, 'p1', {
        collectorId: 'coll1', expectedVersion: 2, expectedStartAt: '2026-11-01T08:00:00+07:00',
      });
      expect((await res.json()).pickup).toMatchObject({ version: 3, dispatch: { nextActor: 'COLLECTOR' } });
    });

    it('refuses a legacy assign without expectedVersion with an upgrade hint (409)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue(admin);
      const res = await PATCH(patchReq({ action: 'assign', collectorUserId: 'coll1' }), params);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: dispatch.PICKUP_VERSION_REQUIRED, code: 'PICKUP_VERSION_REQUIRED' });
      expect(dispatch.assignPickup).not.toHaveBeenCalled();
    });

    it('never lets a collector self-assign (403 before any version check)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue(collector);
      const res = await PATCH(patchReq({ action: 'assign', collectorUserId: 'coll1' }), params);
      expect(res.status).toBe(403);
      expect(dispatch.assignPickup).not.toHaveBeenCalled();
    });

    it('requires collectorUserId on assign', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue(admin);
      expect((await PATCH(patchReq({ action: 'assign', expectedVersion: 0 }), params)).status).toBe(422);
      expect(dispatch.assignPickup).not.toHaveBeenCalled();
    });

    it('passes field steps, versions and reasons to transitionPickup', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue(collector);
      vi.mocked(dispatch.transitionPickup).mockResolvedValue({ ...assigned, status: 'FAILED', closedReason: 'Mobil mogok' } as any);

      const res = await PATCH(patchReq({ action: 'fail', expectedVersion: 3, reason: 'Mobil mogok', notes: 'catatan' }), params);
      expect(res.status).toBe(200);
      expect(dispatch.transitionPickup).toHaveBeenCalledWith(collector, 'p1', {
        action: 'fail', expectedVersion: 3, reason: 'Mobil mogok', notes: 'catatan',
      });

      await PATCH(patchReq({ action: 'start' }), params);
      expect(dispatch.transitionPickup).toHaveBeenLastCalledWith(collector, 'p1', {
        action: 'start', expectedVersion: undefined, reason: undefined, notes: undefined,
      });
    });

    it('answers a stale version with 409 and a machine-readable code', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue(collector);
      vi.mocked(dispatch.transitionPickup).mockRejectedValue(dispatch.versionConflict());
      const res = await PATCH(patchReq({ action: 'complete', expectedVersion: 1 }), params);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Tugas telah diperbarui; muat ulang', code: 'PICKUP_VERSION_CONFLICT' });
    });

    it('keeps plain HttpError statuses (404, 403, 409) from the service', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue(admin);
      for (const status of [404, 403, 409]) {
        vi.mocked(dispatch.transitionPickup).mockRejectedValueOnce(new (rbac.HttpError as any)(status, 'pesan'));
        const res = await PATCH(patchReq({ action: 'cancel', expectedVersion: 0, reason: 'Alasan' }), params);
        expect(res.status).toBe(status);
        expect(await res.json()).toEqual({ error: 'pesan' });
      }
    });

    it('rejects a malformed expectedVersion before the service', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue(admin);
      for (const expectedVersion of ['1', -1, 1.5]) {
        expect((await PATCH(patchReq({ action: 'cancel', expectedVersion, reason: 'Alasan' }), params)).status).toBe(422);
      }
      expect(dispatch.transitionPickup).not.toHaveBeenCalled();
    });

    it('returns handled error on patch failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('patch boom'));
      expect((await PATCH(patchReq({ action: 'start' }), params)).status).toBe(500);
    });
  });
});
