import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PATCH, DELETE } from '@/app/api/payout-accounts/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    payoutAccount: { findUnique: vi.fn(), update: vi.fn() },
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

describe('/api/payout-accounts/[id]', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('PATCH', () => {
    it('returns 403 when not USER role', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({}) });
      const res = await PATCH(req, makeParams('pa1'));
      expect(res.status).toBe(403);
    });

    it('returns 404 when account not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.payoutAccount.findUnique).mockResolvedValue(null);
      const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ accountName: 'New' }) });
      const res = await PATCH(req, makeParams('pa1'));
      expect(res.status).toBe(404);
    });

    it('returns 403 when not account owner', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.payoutAccount.findUnique).mockResolvedValue({ id: 'pa1', userId: 'u2' } as any);
      const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ accountName: 'X' }) });
      const res = await PATCH(req, makeParams('pa1'));
      expect(res.status).toBe(403);
    });

    it('updates account successfully', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.payoutAccount.findUnique).mockResolvedValue({ id: 'pa1', userId: 'u1' } as any);
      vi.mocked(prisma.payoutAccount.update).mockResolvedValue({ id: 'pa1', accountName: 'Updated' } as any);

      const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ accountName: 'Updated' }) });
      const res = await PATCH(req, makeParams('pa1'));
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE', () => {
    it('returns 404 when account not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.payoutAccount.findUnique).mockResolvedValue(null);
      const res = await DELETE(new Request('http://localhost'), makeParams('pa1'));
      expect(res.status).toBe(404);
    });

    it('soft-disables account successfully', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.payoutAccount.findUnique).mockResolvedValue({ id: 'pa1', userId: 'u1' } as any);
      vi.mocked(prisma.payoutAccount.update).mockResolvedValue({ id: 'pa1', status: 'DISABLED' } as any);

      const res = await DELETE(new Request('http://localhost'), makeParams('pa1'));
      expect(res.status).toBe(200);
      expect(prisma.payoutAccount.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'DISABLED' } }),
      );
    });
  });
});
