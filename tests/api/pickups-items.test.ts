import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/pickups/[id]/items/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pickupRequest: { findUnique: vi.fn() },
    pickupItem: { create: vi.fn() },
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
  new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) });

describe('/api/pickups/[id]/items POST', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not PENGEPUL or SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await POST(makeReq({ source: 'MANUAL_WEIGHING' }), makeParams('pk1'));
    expect(res.status).toBe(403);
  });

  it('returns 404 when pickup not found', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'PENGEPUL' } as any);
    vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue(null);
    const res = await POST(makeReq({ source: 'MANUAL_WEIGHING' }), makeParams('pk1'));
    expect(res.status).toBe(404);
  });

  it('returns 403 when PENGEPUL is not assigned collector', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'PENGEPUL' } as any);
    vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({
      id: 'pk1', assignedCollectorId: 'u2', status: 'ARRIVED',
    } as any);
    const res = await POST(makeReq({ source: 'MANUAL_WEIGHING' }), makeParams('pk1'));
    expect(res.status).toBe(403);
  });

  it('returns 409 when pickup status is invalid', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'PENGEPUL' } as any);
    vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({
      id: 'pk1', assignedCollectorId: 'u1', status: 'REQUESTED',
    } as any);
    const res = await POST(makeReq({ source: 'MANUAL_WEIGHING' }), makeParams('pk1'));
    expect(res.status).toBe(409);
  });

  it('creates pickup item successfully (201)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'PENGEPUL' } as any);
    vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({
      id: 'pk1', assignedCollectorId: 'u1', status: 'ARRIVED',
    } as any);
    vi.mocked(prisma.pickupItem.create).mockResolvedValue({ id: 'pi1' } as any);

    const res = await POST(
      makeReq({ wasteTypeId: 'wt1', itemCount: 5, source: 'MANUAL_WEIGHING' }),
      makeParams('pk1'),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.item.id).toBe('pi1');
  });

  it('allows SUPERADMIN regardless of assignedCollectorId', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.pickupRequest.findUnique).mockResolvedValue({
      id: 'pk1', assignedCollectorId: 'u2', status: 'COLLECTED',
    } as any);
    vi.mocked(prisma.pickupItem.create).mockResolvedValue({ id: 'pi1' } as any);

    const res = await POST(makeReq({ source: 'MANUAL_WEIGHING' }), makeParams('pk1'));
    expect(res.status).toBe(201);
  });
});
