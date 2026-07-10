import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, PATCH } from '@/app/api/sessions/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as ledger from '@/lib/ledger';
import * as audit from '@/lib/audit';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    depositSession: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/ledger', () => ({
  getWalletBalance: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

describe('/api/sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (method = 'GET', body?: any) => new Request('http://localhost/api/sessions/sess1', {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });

  describe('GET', () => {
    it('requires USER role', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await GET(makeReq(), { params: Promise.resolve({ id: 'sess1' }) });
      expect(res.status).toBe(403);
    });

    it('fails if session not found (404)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue(null);
      const res = await GET(makeReq(), { params: Promise.resolve({ id: 'sess1' }) });
      expect(res.status).toBe(404);
    });

    it('fails if session does not belong to user (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue({ id: 'sess1', userId: 'other_user' } as any);
      const res = await GET(makeReq(), { params: Promise.resolve({ id: 'sess1' }) });
      expect(res.status).toBe(403);
    });

    it('returns session if belongs to user (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue({ id: 'sess1', userId: 'u1' } as any);
      
      const res = await GET(makeReq(), { params: Promise.resolve({ id: 'sess1' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.session.id).toBe('sess1');
    });
  });

  describe('PATCH', () => {
    it('fails if session not found (404)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue(null);
      const res = await PATCH(makeReq('PATCH', { action: 'finish' }), { params: Promise.resolve({ id: 'sess1' }) });
      expect(res.status).toBe(404);
    });

    it('fails if session does not belong to user (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue({ id: 'sess1', userId: 'other_user' } as any);
      const res = await PATCH(makeReq('PATCH', { action: 'finish' }), { params: Promise.resolve({ id: 'sess1' }) });
      expect(res.status).toBe(403);
    });

    it('cancels session and returns updated balance (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue({ id: 'sess1', userId: 'u1', status: 'ACTIVE' } as any);
      vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 100 } as any);

      const res = await PATCH(makeReq('PATCH', { action: 'cancel' }), { params: Promise.resolve({ id: 'sess1' }) });
      
      expect(res.status).toBe(200);
      
      expect(prisma.depositSession.update).toHaveBeenCalledWith({
        where: { id: 'sess1' },
        data: expect.objectContaining({ status: 'CANCELLED' })
      });
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEPOSIT_SESSION_CANCEL' }));
      
      const data = await res.json();
      expect(data.balance.available).toBe(100);
    });

    it('finishes session (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue({ id: 'sess1', userId: 'u1', status: 'ACTIVE' } as any);
      vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 150 } as any);

      const res = await PATCH(makeReq('PATCH', { action: 'finish' }), { params: Promise.resolve({ id: 'sess1' }) });
      
      expect(res.status).toBe(200);
      
      expect(prisma.depositSession.update).toHaveBeenCalledWith({
        where: { id: 'sess1' },
        data: expect.objectContaining({ status: 'COMPLETED' }) // Based on transitionSession('ACTIVE', 'FINISH')
      });
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEPOSIT_SESSION_FINISH' }));
    });
    it('returns session if already COMPLETED, CANCELLED, or EXPIRED', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue({ id: 'sess1', userId: 'u1', status: 'COMPLETED' } as any);
      
      const res = await PATCH(makeReq('PATCH', { action: 'finish' }), { params: Promise.resolve({ id: 'sess1' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.session.id).toBe('sess1');
      expect(prisma.depositSession.update).not.toHaveBeenCalled();
    });

    it('returns 500 on unexpected errors', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.depositSession.findUnique).mockRejectedValue(new Error('db error'));
      
      const res = await PATCH(makeReq('PATCH', { action: 'finish' }), { params: Promise.resolve({ id: 'sess1' }) });
      expect(res.status).toBe(500);
    });
  });
});
