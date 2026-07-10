import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PATCH, DELETE } from '@/app/api/regions/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    region: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
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
  new Request('http://localhost/api/regions/r1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

describe('/api/regions/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('PATCH', () => {
    it('returns 403 when not SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await PATCH(makeReq({}), makeParams('r1'));
      expect(res.status).toBe(403);
    });

    it('returns 404 when region not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.region.findUnique).mockResolvedValue(null);
      const res = await PATCH(makeReq({ name: 'New Name' }), makeParams('r1'));
      expect(res.status).toBe(404);
    });

    it('updates region successfully', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.region.findUnique).mockResolvedValue({ id: 'r1', name: 'Old', parentId: null } as any);
      vi.mocked(prisma.region.update).mockResolvedValue({ id: 'r1', name: 'Updated' } as any);

      const res = await PATCH(makeReq({ name: 'Updated' }), makeParams('r1'));
      expect(res.status).toBe(200);
    });

    it('returns 422 when setting self as parent', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.region.findUnique).mockResolvedValue({ id: 'r1', name: 'Region', parentId: null } as any);

      const res = await PATCH(makeReq({ parentId: 'r1' }), makeParams('r1'));
      expect(res.status).toBe(422);
    });

    it('returns 404 when parent region not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.region.findUnique)
        .mockResolvedValueOnce({ id: 'r1', name: 'Region', parentId: null } as any)
        .mockResolvedValueOnce(null); // parent lookup

      const res = await PATCH(makeReq({ parentId: 'nonexistent' }), makeParams('r1'));
      expect(res.status).toBe(404);
    });

    it('returns 422 when hierarchy would create a cycle', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      // r1 exists
      vi.mocked(prisma.region.findUnique)
        .mockResolvedValueOnce({ id: 'r1', name: 'Region', parentId: null } as any)
        // parent lookup for r2 (exists)
        .mockResolvedValueOnce({ id: 'r2', parentId: 'r1' } as any)
        // cursor r2 -> parentId r1 -> cycle detection: r2's parent is r1 which is our id
        .mockResolvedValueOnce({ parentId: 'r1' } as any);

      const res = await PATCH(makeReq({ parentId: 'r2' }), makeParams('r1'));
      expect(res.status).toBe(422);
    });

    it('breaks hierarchy walk when the same cursor is seen twice', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.region.findUnique)
        .mockResolvedValueOnce({ id: 'r1', name: 'Region', parentId: null } as any)
        .mockResolvedValueOnce({ id: 'r2', parentId: 'r3' } as any)
        // first walk step: r2 -> r3
        .mockResolvedValueOnce({ parentId: 'r3' } as any)
        // second walk step: r3 -> r3 (self-loop) triggers seen.has break
        .mockResolvedValueOnce({ parentId: 'r3' } as any);
      vi.mocked(prisma.region.update).mockResolvedValue({ id: 'r1', parentId: 'r2' } as any);

      const res = await PATCH(makeReq({ parentId: 'r2' }), makeParams('r1'));
      expect(res.status).toBe(200);
    });

    it('stops hierarchy walk when parent row disappears', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.region.findUnique)
        .mockResolvedValueOnce({ id: 'r1', name: 'Region', parentId: null } as any)
        .mockResolvedValueOnce({ id: 'r2', parentId: 'ghost' } as any)
        .mockResolvedValueOnce({ parentId: 'ghost' } as any)
        .mockResolvedValueOnce(null);
      vi.mocked(prisma.region.update).mockResolvedValue({ id: 'r1', parentId: 'r2' } as any);

      const res = await PATCH(makeReq({ parentId: 'r2' }), makeParams('r1'));
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE', () => {
    it('returns 403 when not SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await DELETE(new Request('http://localhost'), makeParams('r1'));
      expect(res.status).toBe(403);
    });

    it('returns 404 when region not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.region.findUnique).mockResolvedValue(null);
      const res = await DELETE(new Request('http://localhost'), makeParams('r1'));
      expect(res.status).toBe(404);
    });

    it('returns 409 when region is still in use', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.region.findUnique).mockResolvedValue({
        id: 'r1', name: 'Region', _count: { children: 2, organizations: 0, machines: 0 },
      } as any);

      const res = await DELETE(new Request('http://localhost'), makeParams('r1'));
      expect(res.status).toBe(409);
    });

    it('deletes region successfully when no usage', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.region.findUnique).mockResolvedValue({
        id: 'r1', name: 'Region', type: 'PROVINCE', _count: { children: 0, organizations: 0, machines: 0 },
      } as any);
      vi.mocked(prisma.region.delete).mockResolvedValue({} as any);

      const res = await DELETE(new Request('http://localhost'), makeParams('r1'));
      expect(res.status).toBe(200);
      expect(prisma.region.delete).toHaveBeenCalled();
    });
  });
});
