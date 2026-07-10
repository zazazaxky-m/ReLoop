import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PATCH } from '@/app/api/reward-rates/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    rewardRate: { findUnique: vi.fn(), update: vi.fn() },
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

describe('/api/reward-rates/[id] PATCH', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not authorized', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await PATCH(makeReq({ active: false }), makeParams('rr1'));
    expect(res.status).toBe(403);
  });

  it('returns 404 when rate not found', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.rewardRate.findUnique).mockResolvedValue(null);
    const res = await PATCH(makeReq({ active: false }), makeParams('rr1'));
    expect(res.status).toBe(404);
  });

  it('activates rate', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.rewardRate.findUnique).mockResolvedValue({ id: 'rr1', organizationId: null, campaign: null } as any);
    vi.mocked(prisma.rewardRate.update).mockResolvedValue({ id: 'rr1', active: true } as any);

    const res = await PATCH(makeReq({ active: true }), makeParams('rr1'));
    expect(res.status).toBe(200);
    expect(prisma.rewardRate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ active: true, effectiveTo: null }) }),
    );
  });

  it('deactivates rate', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.rewardRate.findUnique).mockResolvedValue({ id: 'rr1', organizationId: null, campaign: null } as any);
    vi.mocked(prisma.rewardRate.update).mockResolvedValue({ id: 'rr1', active: false } as any);

    const res = await PATCH(makeReq({ active: false }), makeParams('rr1'));
    expect(res.status).toBe(200);
    expect(prisma.rewardRate.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ active: false }) }),
    );
  });

  it('ADMIN cannot edit global rate (403)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.rewardRate.findUnique).mockResolvedValue({ id: 'rr1', organizationId: null, campaign: null } as any);

    const res = await PATCH(makeReq({ active: false }), makeParams('rr1'));
    expect(res.status).toBe(403);
  });

  it('ADMIN cannot edit rate from different org (403)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.rewardRate.findUnique).mockResolvedValue({ id: 'rr1', organizationId: 'org2', campaign: null } as any);

    const res = await PATCH(makeReq({ active: false }), makeParams('rr1'));
    expect(res.status).toBe(403);
  });

  it('ADMIN can edit rate from own org', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.rewardRate.findUnique).mockResolvedValue({ id: 'rr1', organizationId: 'org1', campaign: null } as any);
    vi.mocked(prisma.rewardRate.update).mockResolvedValue({ id: 'rr1' } as any);

    const res = await PATCH(makeReq({ active: false }), makeParams('rr1'));
    expect(res.status).toBe(200);
  });

  it('ADMIN can edit rate scoped via campaign org', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.rewardRate.findUnique).mockResolvedValue({
      id: 'rr1', organizationId: null, campaign: { organizationId: 'org1' },
    } as any);
    vi.mocked(prisma.rewardRate.update).mockResolvedValue({ id: 'rr1' } as any);

    const res = await PATCH(makeReq({ active: true }), makeParams('rr1'));
    expect(res.status).toBe(200);
  });
});
