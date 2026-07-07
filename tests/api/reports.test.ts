import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/reports/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    depositItem: { findMany: vi.fn() },
    rewardLedger: { findMany: vi.fn() },
    pickupRequest: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
}));

vi.mock('@/lib/csv', () => ({
  toCsv: vi.fn((data) => `csv_content_with_${data.length}_rows`),
  csvResponse: vi.fn((csv, filename) => new Response(csv, { headers: { 'Content-Disposition': `attachment; filename="${filename}"` } })),
}));

describe('/api/reports GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (type: string) => new Request(`http://localhost/api/reports?type=${type}`);

  it('generates deposits report', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.depositItem.findMany).mockResolvedValue([
      { createdAt: new Date(), wasteType: { name: 'Plastic' }, quantity: 1, status: 'ACCEPTED' }
    ] as any);

    const res = await GET(makeReq('deposits'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('csv_content_with_1_rows');
    expect(res.headers.get('Content-Disposition')).toContain('deposits-');
    expect(prisma.depositItem.findMany).toHaveBeenCalled();
  });

  it('generates rewards report', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.rewardLedger.findMany).mockResolvedValue([
      { createdAt: new Date(), user: { email: 'test@example.com' }, amount: 100 }
    ] as any);

    const res = await GET(makeReq('rewards'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('rewards-');
    expect(prisma.rewardLedger.findMany).toHaveBeenCalled();
  });

  it('generates pickups report', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([
      { createdAt: new Date(), status: 'COMPLETED', _count: { items: 5 } }
    ] as any);

    const res = await GET(makeReq('pickups'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('pickups-');
    expect(prisma.pickupRequest.findMany).toHaveBeenCalled();
  });

  it('returns 422 for unknown type', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
    const res = await GET(makeReq('unknown'));
    expect(res.status).toBe(422);
  });
});
