import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/mobile/reports/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    pickupRequest: { count: vi.fn() },
    depositItem: { count: vi.fn() },
    rewardLedger: { aggregate: vi.fn() },
    user: { count: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

describe('/api/mobile/reports GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 for USER role', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns global report for SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    
    vi.mocked(prisma.pickupRequest.count).mockResolvedValue(10);
    vi.mocked(prisma.depositItem.count).mockResolvedValue(20);
    vi.mocked(prisma.rewardLedger.aggregate).mockResolvedValue({ _sum: { amount: 1500 } } as any);
    vi.mocked(prisma.user.count).mockResolvedValue(5);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.pickupCount).toBe(10);
    expect(data.depositItemCount).toBe(20);
    expect(data.rewardAvailable).toBe(1500);
    
    // Check global scope
    expect(prisma.pickupRequest.count).toHaveBeenCalledWith({ where: {} });
  });

  it('returns org-scoped report for ADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    
    vi.mocked(prisma.pickupRequest.count).mockResolvedValue(10);
    vi.mocked(prisma.depositItem.count).mockResolvedValue(20);
    vi.mocked(prisma.rewardLedger.aggregate).mockResolvedValue({ _sum: { amount: null } } as any);
    vi.mocked(prisma.user.count).mockResolvedValue(5);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rewardAvailable).toBe(0); // tests fallback for null sum
    
    // Check scoped
    expect(prisma.pickupRequest.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org1' } })
    );
  });

  it('uses __none__ if ADMIN has no organizationId', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: null } as any);
    
    vi.mocked(prisma.pickupRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.depositItem.count).mockResolvedValue(0);
    vi.mocked(prisma.rewardLedger.aggregate).mockResolvedValue({ _sum: { amount: 0 } } as any);
    vi.mocked(prisma.user.count).mockResolvedValue(0);

    const res = await GET();
    expect(res.status).toBe(200);
    
    expect(prisma.pickupRequest.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: '__none__' } })
    );
  });
});
