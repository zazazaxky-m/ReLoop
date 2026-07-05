import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET as getList, POST } from '@/app/api/pickups/route';
import { GET as getOne, PATCH } from '@/app/api/pickups/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as audit from '@/lib/audit';

vi.mock('@/lib/prisma', () => {
  const mockTx = {
    pickupRequest: { update: vi.fn() },
    machine: { findUnique: vi.fn(), update: vi.fn() },
  };
  return {
    prisma: {
      pickupRequest: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
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
  });

  describe('GET detail', () => {
    it('forbids unassigned PENGEPUL (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({ id: 'p1', assignedCollectorId: 'other_coll' } as any);

      const res = await getOne(makeReq('http://localhost/api/pickups/p1'), { params: Promise.resolve({ id: 'p1' }) });
      expect(res.status).toBe(403);
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
  });
});
