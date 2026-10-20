import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/machine-session/[code]/route';
import { prisma } from '@/lib/prisma';
import * as mAuth from '@/lib/machine-auth';
import * as audit from '@/lib/audit';
import { verifyLeaseV2 } from '@/lib/machine-lease';
import { sessionPolicyVersion } from '@/lib/session-policy';

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
    id: 'sess1', userId: 'u1', timeoutAt: new Date(Date.now() + 60_000), startedAt: new Date(), ...over,
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
    db.depositItem.findMany.mockResolvedValue([{ id: 'i1', sessionId: 'sess1' }]);
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

  it('uses startedAt + idle timeout as the deadline when a session has no timeoutAt (a later update never moves it)', async () => {
    authorized();
    const startedAt = new Date(Date.now() - 60_000);
    db.depositSession.findMany.mockResolvedValue([candidate({ timeoutAt: null, startedAt })]);
    db.depositSession.findUnique.mockResolvedValue(fullSession({ status: 'REVIEW', timeoutAt: null, startedAt, updatedAt: new Date() }));

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.lease.expiresAt).toBeGreaterThan(data.lease.issuedAt);
    expect(data.lease.expiresAt).toBeLessThanOrEqual(Math.floor((startedAt.getTime() + 3 * 60_000) / 1000));
  });

  it('closes a REVIEW session without timeoutAt past start + idle instead of leasing it forever, even if just updated', async () => {
    authorized();
    const startedAt = new Date(Date.now() - 4 * 60_000);
    const stale = candidate({ timeoutAt: null, startedAt });
    db.depositSession.findMany.mockResolvedValue([stale]);
    db.depositSession.findUnique.mockResolvedValue({ ...stale, status: 'REVIEW', updatedAt: new Date() });
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

/**
 * B01b: lease protocol v2. A worker announcing `x-reloop-lease-protocol: 2`
 * gets the signed caps (reservation, policy version, ceiling, max items)
 * bound into the HMAC; a v1 worker keeps the v1 contract for compliance
 * sessions and, in shadow mode, money sessions, and is refused money sessions
 * under REWARD_FUNDING_ENFORCED=true.
 */
describe('GET /api/machine-session/[code] lease v2 (B01b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
    db.$queryRaw.mockResolvedValue([{ id: 'locked' }]);
    db.$executeRaw.mockResolvedValue(0);
    db.depositSession.findMany.mockResolvedValue([]);
    db.depositItem.findMany.mockResolvedValue([]);
    db.rewardBudgetReservation = db.rewardBudgetReservation ?? { findUnique: vi.fn() };
    db.rewardBudgetReservation.findUnique = vi.fn().mockResolvedValue(null);
    delete process.env.REWARD_FUNDING_ENFORCED;
  });

  const machine = {
    id: 'm1', machineCode: 'RVM-001', organizationId: 'org1', ingestSecret: 'secret', sessionIdleTimeoutMinutes: 3,
    maxRewardPerSessionRupiah: 20_000, maxItemsPerSession: 5,
    organization: { machineRewardMode: 'MONEY_REWARD' },
    wasteTypes: [{ wasteType: { id: 'wt1', name: 'PET', unit: 'ITEM' } }],
  };
  const policy = {
    version: 1, mode: 'MONEY_REWARD', multiplierBps: 10000, ceilingRupiah: 20_000, maxItems: 5,
    capturedAt: '2026-10-15T08:00:00.000Z',
    wasteTypes: [{ id: 'wt1', unit: 'ITEM', rewardPerUnit: 100, maxRewardRupiah: 100, rewardRateId: 'r1', minWeightGrams: null, maxWeightGrams: null }],
  };
  const policyVersion = sessionPolicyVersion(policy as any);
  const req = (protocol?: string) => new Request('http://localhost/api/machine-session/RVM-001', {
    headers: {
      'x-reloop-timestamp': '1234567890', 'x-reloop-nonce': 'nonce', 'x-reloop-signature': 'sig',
      ...(protocol ? { 'x-reloop-lease-protocol': protocol } : {}),
    },
  });
  const live = (over: Record<string, unknown> = {}) => {
    const timeoutAt = new Date(Date.now() + 60_000);
    db.depositSession.findMany.mockResolvedValue([{ id: 'sess1', userId: 'u1', timeoutAt, startedAt: new Date() }]);
    db.depositSession.findUnique.mockResolvedValue({
      id: 'sess1', status: 'ACTIVE', timeoutAt, updatedAt: new Date(), startedAt: new Date(), campaignId: null,
      policyVersion, policySnapshotJson: policy, user: { id: 'u1', name: 'John' }, items: [], ...over,
    });
    db.rewardBudgetReservation.findUnique.mockResolvedValue({
      id: 'res1', businessKey: 'session:sess1:admission', status: 'ACTIVE', ceilingRupiah: 20_000, remainingRupiah: 19_900 });
  };
  const authorized = (over: Record<string, unknown> = {}) => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ ...machine, ...over } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
  };
  const get = async (protocol?: string) => {
    const res = await GET(req(protocol), { params: Promise.resolve({ code: 'RVM-001' }) });
    expect(res.status).toBe(200);
    return res.json();
  };

  it('issues a v2 lease whose HMAC covers the reservation, policy version and caps, plus the verified snapshot', async () => {
    authorized();
    live();
    const data = await get('2');
    expect(data.leaseProtocol).toBe(2);
    expect(data.lease).toMatchObject({
      version: 2, id: 'lease-sess1', machineCode: 'RVM-001', sessionId: 'sess1', userRef: 'u1',
      reservationId: 'res1', policyVersion, ceilingRupiah: 20_000, maxItems: 5,
      policy: { version: 1, mode: 'MONEY_REWARD', multiplierBps: 10000,
        wasteTypes: [{ id: 'wt1', unit: 'ITEM', rewardPerUnit: 100, maxRewardRupiah: 100 }] },
    });
    expect(data.lease.policy).not.toHaveProperty('ceilingRupiah');
    expect(data.lease.expiresAt).toBeGreaterThan(data.lease.issuedAt);
    expect(verifyLeaseV2('secret', data.lease, 'RVM-001')).toEqual({ ok: true });
    const canonical = JSON.stringify([2, 'lease-sess1', 'RVM-001', 'sess1', 'u1', data.lease.issuedAt, data.lease.expiresAt,
      'res1', policyVersion, 20_000, 5]);
    expect(data.lease.signature).toBe(createHmac('sha256', 'secret').update(canonical, 'utf8').digest('hex'));
    expect(data.session.limits).toEqual({ maxRewardRupiah: 20_000, maxItems: 5 });
    expect(db.$transaction).not.toHaveBeenCalled(); // a session with a snapshot is only read
    // Renewal: the same reservation, ceiling and policy version come back.
    const again = await get('2');
    expect(again.lease).toMatchObject({ reservationId: 'res1', ceilingRupiah: 20_000, maxItems: 5, policyVersion });
    expect(again.lease.issuedAt).toBeGreaterThanOrEqual(data.lease.issuedAt);
  });

  it('keeps the v1 contract for a v1 worker: compliance sessions always, money sessions only in shadow mode', async () => {
    authorized();
    live({ policySnapshotJson: { ...policy, mode: 'COMPLIANCE_ONLY', ceilingRupiah: null } });
    db.rewardBudgetReservation.findUnique.mockResolvedValue(null);
    const compliance = await get();
    expect(compliance.lease).toMatchObject({ id: 'lease-sess1', sessionId: 'sess1', userRef: 'u1' });
    expect(compliance.lease.version).toBeUndefined();
    expect(compliance.lease.reservationId).toBeUndefined();
    const canonical = [compliance.lease.id, 'sess1', compliance.lease.issuedAt, compliance.lease.expiresAt].join('.');
    expect(compliance.lease.signature).toBe(createHmac('sha256', 'secret').update(canonical).digest('hex'));

    live();
    const shadowMoney = await get();
    expect(shadowMoney.lease).toMatchObject({ id: 'lease-sess1', sessionId: 'sess1' });
    expect(shadowMoney.lease.version).toBeUndefined();
    expect(shadowMoney.leaseRefused).toBeUndefined();
  });

  it('refuses a money session to a v1 worker under enforcement (no lease, reason reported), never a compliance one', async () => {
    process.env.REWARD_FUNDING_ENFORCED = 'true';
    try {
      authorized();
      live();
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const refused = await get();
      expect(refused.lease).toBeNull();
      expect(refused.session).toBeNull();
      expect(refused.leaseRefused).toBe('LEASE_PROTOCOL_V2_REQUIRED');
      expect(errors).toHaveBeenCalled();
      errors.mockRestore();
      // The same worker on v2 is served.
      const served = await get('2');
      expect(served.lease.version).toBe(2);
      // A compliance session is still leased to the v1 worker.
      live({ policySnapshotJson: { ...policy, mode: 'COMPLIANCE_ONLY', ceilingRupiah: null } });
      db.rewardBudgetReservation.findUnique.mockResolvedValue(null);
      const compliance = await get();
      expect(compliance.lease).toMatchObject({ sessionId: 'sess1' });
      expect(compliance.leaseRefused).toBeUndefined();
    } finally {
      delete process.env.REWARD_FUNDING_ENFORCED;
    }
  });

  it('a compliance session gets a v2 lease without a money bound (null reservation and ceiling)', async () => {
    authorized({ maxItemsPerSession: null });
    live({ policySnapshotJson: { ...policy, mode: 'COMPLIANCE_ONLY', ceilingRupiah: null, maxItems: null } });
    db.rewardBudgetReservation.findUnique.mockResolvedValue(null);
    const data = await get('2');
    expect(data.lease).toMatchObject({ version: 2, reservationId: null, ceilingRupiah: null, maxItems: null });
    expect(data.lease.policy.mode).toBe('COMPLIANCE_ONLY');
    expect(verifyLeaseV2('secret', data.lease, 'RVM-001')).toEqual({ ok: true });
  });
});
