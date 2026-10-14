import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, PATCH } from '@/app/api/sessions/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as ledger from '@/lib/ledger';
import * as audit from '@/lib/audit';

const db = vi.hoisted(() => {
  const db: Record<string, any> = {
    depositSession: { findUnique: vi.fn(), update: vi.fn() },
    machine: { findUnique: vi.fn() },
    depositItem: { count: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return db;
});

vi.mock('@/lib/prisma', () => ({ prisma: db }));

/** Table name of every row lock taken, in order (lib/db-locks.ts). */
const lockOrder = () => db.$queryRaw.mock.calls
  .map((call: unknown[]) => (call[0] as TemplateStringsArray).join('?').match(/FROM "(\w+)"/)?.[1]);

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
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
    db.$queryRaw.mockResolvedValue([{ id: 'locked' }]);
    db.$executeRaw.mockResolvedValue(0);
    db.depositItem.count.mockResolvedValue(0);
    db.machine.findUnique.mockResolvedValue({ sessionIdleTimeoutMinutes: 3 });
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
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue({ id: 'sess1', userId: 'u1', machineId: 'm1', status: 'ACTIVE' } as any);
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
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue({ id: 'sess1', userId: 'u1', machineId: 'm1', status: 'ACTIVE' } as any);
      vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 150 } as any);

      const res = await PATCH(makeReq('PATCH', { action: 'finish' }), { params: Promise.resolve({ id: 'sess1' }) });
      
      expect(res.status).toBe(200);
      
      expect(prisma.depositSession.update).toHaveBeenCalledWith({
        where: { id: 'sess1' },
        data: expect.objectContaining({ status: 'COMPLETED' }) // Based on transitionSession('ACTIVE', 'FINISH')
      });
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'DEPOSIT_SESSION_FINISH' }));
      // R03: User -> Machine -> DepositSession, then the undecided-item check under those locks.
      expect(lockOrder()).toEqual(['User', 'Machine', 'DepositSession']);
      expect(db.depositItem.count).toHaveBeenCalledWith({ where: { sessionId: 'sess1', status: 'PENDING', acceptanceEventId: null } });
    });

    it('refuses finish and cancel while the machine still decides an item (409), changing nothing', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue({
        id: 'sess1', userId: 'u1', machineId: 'm1', status: 'PROCESSING_ITEM', timeoutAt: new Date(Date.now() + 60_000), startedAt: new Date() } as any);
      db.depositItem.count.mockResolvedValue(1);
      for (const action of ['finish', 'cancel']) {
        const res = await PATCH(makeReq('PATCH', { action }), { params: Promise.resolve({ id: 'sess1' }) });
        expect(res.status).toBe(409);
        expect(await res.json()).toEqual({ error: 'Mesin masih memproses item terakhir Anda. Tunggu sebentar, lalu coba lagi.' });
      }
      expect(prisma.depositSession.update).not.toHaveBeenCalled();
      expect(audit.logAudit).not.toHaveBeenCalled();
    });

    it('after the deadline (every lease expired) closes through the timeout policy instead of waiting forever', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      const stale = { id: 'sess1', userId: 'u1', machineId: 'm1', status: 'PROCESSING_ITEM', timeoutAt: new Date(Date.now() - 1_000), startedAt: new Date(Date.now() - 600_000) };
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue(stale as any);
      db.depositItem.count.mockResolvedValue(1);
      db.depositItem.findMany.mockResolvedValue([{ id: 'i1', sessionId: 'sess1' }]);
      db.depositItem.findUnique.mockResolvedValue({ status: 'PENDING', acceptanceEventId: null, validationReasonCode: null });
      db.depositItem.updateMany.mockResolvedValue({ count: 1 });
      vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 0 } as any);

      const res = await PATCH(makeReq('PATCH', { action: 'finish' }), { params: Promise.resolve({ id: 'sess1' }) });
      expect(res.status).toBe(200);
      expect(db.depositItem.updateMany).toHaveBeenCalledWith({
        where: { id: 'i1', status: 'PENDING', acceptanceEventId: null },
        data: { status: 'REVIEW', validationReasonCode: 'SESSION_TIMEOUT' },
      });
      expect(prisma.depositSession.update).toHaveBeenCalledWith({
        where: { id: 'sess1' }, data: expect.objectContaining({ status: 'EXPIRED' }) });
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'DEPOSIT_SESSION_EXPIRE', metadata: { reason: 'TIMEOUT', closedBy: 'owner', heldItemIds: ['i1'] } }));
    });

    it('answers a finish the state machine does not allow with 409 instead of 500', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue({ id: 'sess1', userId: 'u1', machineId: 'm1', status: 'RESERVED' } as any);
      const res = await PATCH(makeReq('PATCH', { action: 'finish' }), { params: Promise.resolve({ id: 'sess1' }) });
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'Sesi tidak dapat diselesaikan saat ini.' });
      expect(prisma.depositSession.update).not.toHaveBeenCalled();
    });
    it('returns session if already COMPLETED, CANCELLED, or EXPIRED', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.depositSession.findUnique).mockResolvedValue({ id: 'sess1', userId: 'u1', machineId: 'm1', status: 'COMPLETED' } as any);
      
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
