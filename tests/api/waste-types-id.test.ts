import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PATCH, DELETE } from '@/app/api/waste-types/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    wasteType: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    depositItem: { count: vi.fn() },
    machineWasteType: { count: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });
const makeReq = (body: any) =>
  new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) });

describe('/api/waste-types/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('PATCH', () => {
    it('handles unexpected errors', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('Unexpected PATCH error'));
      const req = new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ name: 'Update' }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: 'wt1' }) });
      expect(res.status).toBe(500);
    });

    it('returns 422 when minWeightGrams > maxWeightGrams', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.wasteType.findUnique).mockResolvedValue({ id: 'wt1', organizationId: null } as any);
      const req = new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ minWeightGrams: 100, maxWeightGrams: 50 }),
      });
      const res = await PATCH(req, { params: Promise.resolve({ id: 'wt1' }) });
      expect(res.status).toBe(422);
    });
    it('returns 403 when not authorized', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await PATCH(makeReq({ name: 'X' }), makeParams('wt1'));
      expect(res.status).toBe(403);
    });

    it('returns 404 when waste type not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.wasteType.findUnique).mockResolvedValue(null);
      const res = await PATCH(makeReq({ name: 'Updated' }), makeParams('wt1'));
      expect(res.status).toBe(404);
    });

    it('SUPERADMIN can edit any waste type', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.wasteType.findUnique).mockResolvedValue({ id: 'wt1', organizationId: null } as any);
      vi.mocked(prisma.wasteType.update).mockResolvedValue({ id: 'wt1', name: 'Updated' } as any);

      const res = await PATCH(makeReq({ name: 'Updated' }), makeParams('wt1'));
      expect(res.status).toBe(200);
    });

    it('ADMIN cannot edit global waste type (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.wasteType.findUnique).mockResolvedValue({ id: 'wt1', organizationId: null } as any);

      const res = await PATCH(makeReq({ name: 'Updated' }), makeParams('wt1'));
      expect(res.status).toBe(403);
    });

    it('ADMIN cannot edit other org waste type (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.wasteType.findUnique).mockResolvedValue({ id: 'wt1', organizationId: 'org2' } as any);

      const res = await PATCH(makeReq({ name: 'Updated' }), makeParams('wt1'));
      expect(res.status).toBe(403);
    });

    it('ADMIN can edit own org waste type', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.wasteType.findUnique).mockResolvedValue({ id: 'wt1', organizationId: 'org1' } as any);
      vi.mocked(prisma.wasteType.update).mockResolvedValue({ id: 'wt1' } as any);

      const res = await PATCH(makeReq({ name: 'Updated' }), makeParams('wt1'));
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE', () => {
    it('soft-deactivates when waste type has items or machine links', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.wasteType.findUnique).mockResolvedValue({ id: 'wt1', organizationId: null } as any);
      vi.mocked(prisma.depositItem.count).mockResolvedValue(5);
      vi.mocked(prisma.machineWasteType.count).mockResolvedValue(0);
      vi.mocked(prisma.wasteType.update).mockResolvedValue({ id: 'wt1' } as any);

      const res = await DELETE(new Request('http://localhost'), makeParams('wt1'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.deactivated).toBe(true);
    });

    it('hard-deletes when waste type has no references', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.wasteType.findUnique).mockResolvedValue({ id: 'wt1', organizationId: null } as any);
      vi.mocked(prisma.depositItem.count).mockResolvedValue(0);
      vi.mocked(prisma.machineWasteType.count).mockResolvedValue(0);
      vi.mocked(prisma.wasteType.delete).mockResolvedValue({} as any);

      const res = await DELETE(new Request('http://localhost'), makeParams('wt1'));
      expect(res.status).toBe(200);
      expect(prisma.wasteType.delete).toHaveBeenCalled();
    });

    it('handles unexpected errors', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('Unexpected DELETE error'));
      const res = await DELETE(new Request('http://localhost'), makeParams('wt1'));
      expect(res.status).toBe(500);
    });
  });
});
