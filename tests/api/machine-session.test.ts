import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/machine-session/[code]/route';
import { prisma } from '@/lib/prisma';
import * as mAuth from '@/lib/machine-auth';
import * as audit from '@/lib/audit';

const db = vi.hoisted(() => {
  const db: Record<string, any> = {
    machine: { findUnique: vi.fn() },
    depositSession: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    depositItem: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return db;
});

vi.mock('@/lib/prisma', () => ({ prisma: db }));

vi.mock('@/lib/machine-auth', () => ({
  verifyMachineRequest: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

/** Table name of every row lock taken, in order (lib/db-locks.ts). */
const lockOrder = () => db.$queryRaw.mock.calls
  .map((call: unknown[]) => (call[0] as TemplateStringsArray).join('?').match(/FROM "(\w+)"/)?.[1]);

describe('GET /api/machine-session/[code]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
    db.$queryRaw.mockResolvedValue([{ id: 'locked' }]);
    db.$executeRaw.mockResolvedValue(0);
    db.depositSession.findMany.mockResolvedValue([]);
    db.depositItem.findMany.mockResolvedValue([]);
  });

  const makeReq = () => new Request('http://localhost/api/machine-session/m1', {
    headers: {
      'x-reloop-timestamp': '1234567890',
      'x-reloop-nonce': 'nonce',
      'x-reloop-signature': 'sig',
    },
  });
  const machine = { id: 'm1', ingestSecret: 'secret', sessionIdleTimeoutMinutes: 3 };
  const authorized = () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(machine as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
  };
  const candidate = (over: Record<string, unknown>) => ({
    id: 'sess1', userId: 'u1', timeoutAt: new Date(Date.now() + 60_000), updatedAt: new Date(), ...over,
  });
  const fullSession = (over: Record<string, unknown>) => ({
    id: 'sess1', status: 'ACTIVE', timeoutAt: new Date(Date.now() + 60_000), updatedAt: new Date(), startedAt: new Date(),
    user: { id: 'u1', name: 'John' }, items: [], ...over,
  });

  it('fails if machine not found (404)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(404);
  });

  it('fails if signature is invalid (401)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: false, reason: 'Invalid' } as any);

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(401);
    expect(db.depositSession.findMany).not.toHaveBeenCalled();
  });

  it('returns null session if no active session exists (200)', async () => {
    authorized();
    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session).toBeNull();
    expect(data.lease).toBeNull();
    expect(data.sessionConflict).toBeUndefined();
  });

  it('returns active session and a signed lease that never outlives the session deadline (200)', async () => {
    authorized();
    const timeoutAt = new Date(Date.now() + 60_000);
    db.depositSession.findMany.mockResolvedValue([candidate({ timeoutAt })]);
    db.depositSession.findUnique.mockResolvedValue(fullSession({
      timeoutAt,
      items: [{ id: 'i1', quantity: 2, rewardAmount: 10, status: 'ACCEPTED', wasteType: { id: 'wt1', name: 'Plastic' } }],
    }));

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.session.id).toBe('sess1');
    expect(data.session.totalQuantity).toBe(2);
    expect(data.session.totalReward).toBe(10);
    expect(data.lease.id).toBe('lease-sess1');
    expect(data.lease.expiresAt).toBeLessThanOrEqual(Math.floor(timeoutAt.getTime() / 1000));
    expect(data.lease.expiresAt).toBeGreaterThan(data.lease.issuedAt);
    // Unchanged machine contract: HMAC over id.sessionId.issuedAt.expiresAt.
    const canonical = [data.lease.id, data.lease.sessionId, data.lease.issuedAt, data.lease.expiresAt].join('.');
    expect(data.lease.signature).toBe(createHmac('sha256', 'secret').update(canonical).digest('hex'));
    expect(db.$transaction).not.toHaveBeenCalled(); // a live session is only read
  });

  it('caps a lease at 300 s', async () => {
    authorized();
    const timeoutAt = new Date(Date.now() + 60 * 60_000);
    db.depositSession.findMany.mockResolvedValue([candidate({ timeoutAt })]);
    db.depositSession.findUnique.mockResolvedValue(fullSession({ timeoutAt }));
    const data = await (await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) })).json();
    expect(data.lease.expiresAt - data.lease.issuedAt).toBe(300);
  });

  it('expires a timed-out session through the timeout policy and its undecided item goes to review (200)', async () => {
    authorized();
    const stale = candidate({ timeoutAt: new Date(Date.now() - 60_000) });
    db.depositSession.findMany.mockResolvedValue([stale]);
    db.depositSession.findUnique.mockResolvedValue({ ...stale, status: 'ACTIVE' });
    db.depositItem.findMany.mockResolvedValue([{ id: 'i1' }]);
    db.depositItem.findUnique.mockResolvedValue({ status: 'PENDING', acceptanceEventId: null, validationReasonCode: null });
    db.depositItem.updateMany.mockResolvedValue({ count: 1 });

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(200);
    expect(lockOrder()).toEqual(['User', 'Machine', 'DepositSession', 'DepositItem']);
    expect(db.depositItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'i1', status: 'PENDING', acceptanceEventId: null },
      data: { status: 'REVIEW', validationReasonCode: 'SESSION_TIMEOUT' },
    });
    expect(prisma.depositSession.update).toHaveBeenCalledWith({
      where: { id: 'sess1' },
      data: expect.objectContaining({ status: 'EXPIRED' }),
    });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DEPOSIT_SESSION_EXPIRE', entityId: 'sess1',
      metadata: { reason: 'TIMEOUT', closedBy: 'machine-poll', heldItemIds: ['i1'] },
    }));

    const data = await res.json();
    expect(data.session).toBeNull(); // Session should be null because it just expired
    expect(data.lease).toBeNull();
  });

  it('keeps a session whose deadline moved on under the lock (re-read), and leases it', async () => {
    authorized();
    db.depositSession.findMany.mockResolvedValue([candidate({ timeoutAt: new Date(Date.now() - 1_000) })]);
    const extended = fullSession({ timeoutAt: new Date(Date.now() + 60_000) });
    db.depositSession.findUnique.mockResolvedValue(extended);
    const data = await (await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) })).json();
    expect(db.depositSession.update).not.toHaveBeenCalled();
    expect(data.lease.sessionId).toBe('sess1');
  });

  it('never leases one of several live sessions: no lease, sessionConflict', async () => {
    authorized();
    db.depositSession.findMany.mockResolvedValue([
      candidate({ id: 'older', startedAt: new Date(Date.now() - 60_000) }), candidate({ id: 'newer', userId: 'u2' })]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const data = await (await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) })).json();
    expect(data).toMatchObject({ lease: null, session: null, sessionConflict: true });
    expect(db.depositSession.findUnique).not.toHaveBeenCalled();
    expect(db.depositSession.update).not.toHaveBeenCalled();
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('returns 401 when ingest secret is missing', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: 'm1',
      ingestSecret: null,
      sessionIdleTimeoutMinutes: 3,
    } as any);
    expect((await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) })).status).toBe(401);
  });

  it('uses updatedAt + idle timeout as the deadline when a session has no timeoutAt', async () => {
    authorized();
    const updatedAt = new Date(Date.now() - 60_000);
    db.depositSession.findMany.mockResolvedValue([candidate({ timeoutAt: null, updatedAt })]);
    db.depositSession.findUnique.mockResolvedValue(fullSession({ status: 'REVIEW', timeoutAt: null, updatedAt }));

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.lease.expiresAt).toBeGreaterThan(data.lease.issuedAt);
    expect(data.lease.expiresAt).toBeLessThanOrEqual(Math.floor((updatedAt.getTime() + 3 * 60_000) / 1000));
  });

  it('closes an idle REVIEW session without timeoutAt instead of leasing it forever', async () => {
    authorized();
    const updatedAt = new Date(Date.now() - 4 * 60_000);
    const stale = candidate({ timeoutAt: null, updatedAt });
    db.depositSession.findMany.mockResolvedValue([stale]);
    db.depositSession.findUnique.mockResolvedValue({ ...stale, status: 'REVIEW' });
    const data = await (await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) })).json();
    expect(data.lease).toBeNull();
    expect(db.depositSession.update).toHaveBeenCalledWith({
      where: { id: 'sess1' }, data: expect.objectContaining({ status: 'EXPIRED' }) });
  });

  it('maps linked waste types into the idle response', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: 'm1',
      ingestSecret: 'secret',
      sessionIdleTimeoutMinutes: 3,
      wasteTypes: [
        { wasteType: { id: 'wt1', name: 'PET', unit: 'ITEM' } },
        { wasteType: { id: 'wt2', name: 'Kaleng', unit: 'KG' } },
      ],
    } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.wasteTypes).toEqual([
      { id: 'wt1', name: 'PET', unit: 'ITEM' },
      { id: 'wt2', name: 'Kaleng', unit: 'KG' },
    ]);
  });
});
