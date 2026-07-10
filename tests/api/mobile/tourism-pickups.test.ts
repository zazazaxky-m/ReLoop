import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/mobile/tourism-pickups/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trip: { findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
    travelAgent: { findMany: vi.fn() },
    trashBagAssignment: { groupBy: vi.fn() },
    manualValidation: { groupBy: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  activePartnerOrgIds: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

describe('/api/mobile/tourism-pickups GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not PENGEPUL', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns empty list if PENGEPUL has no active partners', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.trips).toEqual([]);
    expect(prisma.trip.findMany).not.toHaveBeenCalled();
  });

  it('returns assembled trip data', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue(['org1']);
    
    vi.mocked(prisma.trip.findMany).mockResolvedValue([
      { id: 't1', groupName: 'Group A', campaignId: 'c1', travelAgentId: 'ta1', complianceStatus: 'COMPLIANT', complianceScore: 100 },
      { id: 't2', groupName: 'Group B', campaignId: 'c1', travelAgentId: null, complianceStatus: 'PENDING', complianceScore: null },
    ] as any);
    
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([
      { id: 'c1', name: 'Camp 1', organization: { name: 'Org 1' } },
    ] as any);
    
    vi.mocked(prisma.travelAgent.findMany).mockResolvedValue([
      { id: 'ta1', name: 'Agent X' },
    ] as any);
    
    vi.mocked(prisma.trashBagAssignment.groupBy).mockResolvedValue([
      { tripId: 't1', _count: { id: 5 } },
    ] as any);
    
    vi.mocked(prisma.manualValidation.groupBy).mockResolvedValue([
      { tripId: 't1', _count: { id: 1 } },
    ] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.trips).toHaveLength(2);
    expect(data.trips[0].bagCount).toBe(5);
    expect(data.trips[0].pickedUp).toBe(true);
    expect(data.trips[0].travelAgentName).toBe('Agent X');
    expect(data.trips[0].organizationName).toBe('Org 1');
    
    expect(data.trips[1].bagCount).toBe(0);
    expect(data.trips[1].pickedUp).toBe(false);
    expect(data.trips[1].travelAgentName).toBeNull();
  });

  it('falls back campaign/org names when campaign map misses', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue(['org1']);
    vi.mocked(prisma.trip.findMany).mockResolvedValue([
      {
        id: 't3',
        groupName: 'Orphan',
        campaignId: 'missing',
        travelAgentId: 'ta-missing',
        complianceStatus: 'PENDING',
        complianceScore: null,
      },
    ] as any);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
    vi.mocked(prisma.travelAgent.findMany).mockResolvedValue([]);
    vi.mocked(prisma.trashBagAssignment.groupBy).mockResolvedValue([]);
    vi.mocked(prisma.manualValidation.groupBy).mockResolvedValue([]);

    const res = await GET();
    const data = await res.json();
    expect(data.trips[0].campaignName).toBe('-');
    expect(data.trips[0].organizationName).toBe('-');
    expect(data.trips[0].travelAgentName).toBeNull();
  });
});
