import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/pickups/[id]/items/route';
import * as rbac from '@/lib/rbac';
import * as dispatch from '@/lib/pickup-dispatch';
import * as audit from '@/lib/audit';

const mockTx = { pickupItem: { create: vi.fn() } };

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

// B05: the lock, the in-lock re-read and the partnership check live in
// lockPickupForFieldWork (exercised against real PostgreSQL in
// tests/integration/pickup-dispatch.test.ts); here only the route wiring.
vi.mock('@/lib/pickup-dispatch', () => ({ lockPickupForFieldWork: vi.fn() }));
vi.mock('@/lib/wallet-service', () => ({ runWalletTransaction: vi.fn((fn: (tx: unknown) => unknown) => fn(mockTx)) }));
vi.mock('@/lib/audit', () => ({ logAuditInTransaction: vi.fn() }));

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });
const makeReq = (body: any) =>
  new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) });
const locked = (status: string) => ({ id: 'pk1', organizationId: 'org1', status, version: 4, assignedCollectorId: 'u1' });

describe('/api/pickups/[id]/items POST', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not PENGEPUL or SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await POST(makeReq({ source: 'MANUAL_WEIGHING' }), makeParams('pk1'));
    expect(res.status).toBe(403);
    expect(dispatch.lockPickupForFieldWork).not.toHaveBeenCalled();
  });

  it('passes the lock helper refusals through (404 missing, 403 not assigned or partnership inactive)', async () => {
    const collector = { id: 'u1', role: 'PENGEPUL' } as any;
    vi.mocked(rbac.requireApiUser).mockResolvedValue(collector);
    for (const status of [404, 403]) {
      vi.mocked(dispatch.lockPickupForFieldWork).mockRejectedValueOnce(new (rbac as any).HttpError(status, 'pesan'));
      const res = await POST(makeReq({ source: 'MANUAL_WEIGHING' }), makeParams('pk1'));
      expect(res.status).toBe(status);
      expect(await res.json()).toEqual({ error: 'pesan' });
    }
    expect(dispatch.lockPickupForFieldWork).toHaveBeenCalledWith(mockTx, collector, 'pk1');
    expect(mockTx.pickupItem.create).not.toHaveBeenCalled();
  });

  it('returns 409 when the locked status does not allow material records', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'PENGEPUL' } as any);
    for (const status of ['REQUESTED', 'ASSIGNED', 'ON_THE_WAY', 'CANCELLED', 'FAILED']) {
      vi.mocked(dispatch.lockPickupForFieldWork).mockResolvedValueOnce(locked(status) as any);
      expect((await POST(makeReq({ source: 'MANUAL_WEIGHING' }), makeParams('pk1'))).status).toBe(409);
    }
    expect(mockTx.pickupItem.create).not.toHaveBeenCalled();
  });

  it('creates the item and its audit entry in the same transaction (201)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'PENGEPUL' } as any);
    vi.mocked(dispatch.lockPickupForFieldWork).mockResolvedValue(locked('ARRIVED') as any);
    mockTx.pickupItem.create.mockResolvedValue({ id: 'pi1' });

    const res = await POST(
      makeReq({ wasteTypeId: 'wt1', itemCount: 5, source: 'MANUAL_WEIGHING' }),
      makeParams('pk1'),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).item.id).toBe('pi1');
    expect(mockTx.pickupItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ pickupRequestId: 'pk1', itemCount: 5 }) });
    expect(audit.logAuditInTransaction).toHaveBeenCalledWith(mockTx, expect.objectContaining({
      action: 'PICKUP_ITEM_RECORD', entityId: 'pi1', metadata: { pickupRequestId: 'pk1', pickupVersion: 4, status: 'ARRIVED' },
    }));
  });

  it('allows SUPERADMIN through the same lock helper', async () => {
    const superadmin = { id: 'super1', role: 'SUPERADMIN' } as any;
    vi.mocked(rbac.requireApiUser).mockResolvedValue(superadmin);
    vi.mocked(dispatch.lockPickupForFieldWork).mockResolvedValue(locked('COLLECTED') as any);
    mockTx.pickupItem.create.mockResolvedValue({ id: 'pi1' });

    const res = await POST(makeReq({ source: 'MANUAL_WEIGHING' }), makeParams('pk1'));
    expect(res.status).toBe(201);
    expect(dispatch.lockPickupForFieldWork).toHaveBeenCalledWith(mockTx, superadmin, 'pk1');
  });
});
