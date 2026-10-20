import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/mobile/overview/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import { getLiabilitySummary } from '@/lib/reconciliation-report';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: { findUnique: vi.fn(), count: vi.fn() },
    rewardLedger: { aggregate: vi.fn(), findFirst: vi.fn(), groupBy: vi.fn() },
    depositItem: { count: vi.fn() },
    machine: { count: vi.fn(), findMany: vi.fn() },
    pickupRequest: { count: vi.fn(), findMany: vi.fn() },
    trip: { count: vi.fn(), findMany: vi.fn() },
    machineEvent: { count: vi.fn() },
    depositSession: { findMany: vi.fn(), count: vi.fn() },
    campaign: { findMany: vi.fn(), count: vi.fn() },
    travelAgentUser: { count: vi.fn() },
    organizationCollectorPartner: { findMany: vi.fn(), count: vi.fn() },
    organization: { count: vi.fn() },
    redemption: { count: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  activePartnerOrgIds: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/config', () => ({
  CONFIG_KEYS: { POINTS_TO_RUPIAH: 'POINTS_TO_RUPIAH' },
  getConfigInt: vi.fn().mockResolvedValue(10),
  getMinRedemption: vi.fn().mockResolvedValue(5000),
}));

vi.mock('@/lib/campaign', () => ({
  isCampaignEligible: vi.fn().mockReturnValue({ eligible: true }),
}));

vi.mock('@/lib/security-events', () => ({
  getDepositReviewQueue: vi.fn(),
  SECURITY_EVENT_TYPES: ['FRAUD_DETECTED'],
  getSecuritySummary: vi.fn().mockResolvedValue({}),
  getSecurityEvents: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/lib/ledger', () => ({
  getWalletBalance: vi.fn().mockResolvedValue({ totalAvailable: 500 }),
  getLedgerHistory: vi.fn().mockResolvedValue([]),
}));

const liability = {
  availableLiability: 15000, pendingLiability: 2000, reservedLiability: 3000, paidTotal: 40000, totalObligation: 20000,
};
vi.mock('@/lib/reconciliation-report', () => ({
  getLiabilitySummary: vi.fn(async () => liability),
}));

vi.mock('@/lib/trip', () => ({
  getInvitedTravelAgentTripFilters: vi.fn(async () => [{ travelAgentId: 'ta1', organizationId: 'org1' }]),
}));

describe('/api/mobile/overview GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns overview for USER role', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
    vi.mocked(prisma.depositSession.findMany).mockResolvedValue([{ id: 's1' }] as any);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([{ id: 'c1' }] as any);
    vi.mocked(prisma.trip.count).mockResolvedValue(2);
    vi.mocked(prisma.rewardLedger.aggregate).mockResolvedValue({ _sum: { amount: 4000 } } as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.balance.totalAvailable).toBe(500);
    expect(data.isTravelAgent).toBe(true);
    expect(data.pointsToRupiah).toBe(10);
    expect(data.recentSessions).toHaveLength(1);
    expect(data.recentLedger).toEqual([]);
    expect(data.minRedemption).toBe(5000);
    expect(data.tourismSummary).toBeDefined();
  });

  it('marks USER without invited agent orgs as non-travel-agent and defaults reward sum', async () => {
    const trip = await import('@/lib/trip');
    vi.mocked(trip.getInvitedTravelAgentTripFilters).mockResolvedValueOnce([]);
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
    vi.mocked(prisma.depositSession.findMany).mockResolvedValue([]);
    vi.mocked(prisma.campaign.findMany).mockResolvedValue([]);
    vi.mocked(prisma.trip.count).mockResolvedValue(0);
    vi.mocked(prisma.rewardLedger.aggregate).mockResolvedValue({ _sum: { amount: null } } as any);

    const res = await GET();
    const data = await res.json();
    expect(data.isTravelAgent).toBe(false);
    expect(data.tourismSummary.trashBagRewardTotal).toBe(0);
  });

  it('returns overview for PENGEPUL role', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue(['org1']);
    
    vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([{ id: 'task1' }] as any);
    vi.mocked(prisma.pickupRequest.count).mockResolvedValue(2);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([{ id: 'm1' }] as any);
    vi.mocked(prisma.organizationCollectorPartner.findMany).mockResolvedValue([{ id: 'partner1' }] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.role).toBe('PENGEPUL');
    expect(data.tasks).toHaveLength(1);
    expect(data.availableTasks).toBe(2);
    expect(data.fullMachines).toHaveLength(1);
    expect(data.partnerships).toHaveLength(1);
  });

  it('uses __none__ org filter when PENGEPUL has no partner orgs', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue([]);
    vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([]);
    vi.mocked(prisma.pickupRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([]);
    vi.mocked(prisma.organizationCollectorPartner.findMany).mockResolvedValue([]);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(prisma.pickupRequest.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: { in: ['__none__'] } }),
      }),
    );
  });

  it('returns overview for ADMIN role (org-scoped)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    
    vi.mocked(prisma.machine.findMany).mockResolvedValue([{ id: 'm1' }, { id: 'm2' }] as any);
    vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([{ id: 'p1' }] as any);
    vi.mocked(prisma.campaign.count).mockResolvedValue(3);
    vi.mocked(prisma.depositSession.count).mockResolvedValue(50);
    vi.mocked(prisma.organizationCollectorPartner.count).mockResolvedValue(5);
    vi.mocked(prisma.trip.count).mockResolvedValue(10);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.role).toBe('ADMIN');
    expect(data.machines).toHaveLength(2);
    expect(data.pickups).toHaveLength(1);
    expect(data.campaignCount).toBe(3);
    expect(data.depositCount).toBe(50);
    expect(data.partnershipCount).toBe(5);
    expect(data.tourismSummary).toBeDefined();
    
    expect(prisma.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { organizationId: 'org1' } }));
  });

  it('returns overview for SUPERADMIN role (global)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    
    vi.mocked(prisma.organization.count).mockResolvedValue(5);
    vi.mocked(prisma.machine.count).mockResolvedValue(10);
    vi.mocked(prisma.user.count).mockResolvedValue(100);
    vi.mocked(prisma.depositItem.count).mockResolvedValue(500);
    vi.mocked(prisma.organizationCollectorPartner.count).mockResolvedValue(2);
    vi.mocked(prisma.redemption.count).mockResolvedValue(3);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.role).toBe('SUPERADMIN');
    expect(data.organizationCount).toBe(5);
    expect(data.machineCount).toBe(10);
    expect(data.userCount).toBe(100);
    expect(data.depositCount).toBe(500);
    // M05: the old field now carries the net spendable liability; the breakdown is additive.
    expect(data.rewardAvailable).toBe(15000);
    expect(data.rewardLiability).toEqual(liability);
    expect(prisma.rewardLedger.aggregate).not.toHaveBeenCalled();
    expect(data.pendingPartners).toBe(2);
    expect(data.pendingRedemptions).toBe(3);
  });

  it('scopes ADMIN without organizationId to __none__', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1',
      role: 'ADMIN',
      organizationId: null,
    } as any);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([]);
    vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([]);
    vi.mocked(prisma.campaign.count).mockResolvedValue(0);
    vi.mocked(prisma.depositSession.count).mockResolvedValue(0);
    vi.mocked(prisma.organizationCollectorPartner.count).mockResolvedValue(0);
    vi.mocked(prisma.trip.count).mockResolvedValue(0);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(prisma.machine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: '__none__' } }),
    );
  });

  it('returns complianceRate 0 when ADMIN has no trips', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1',
      role: 'ADMIN',
      organizationId: 'org1',
    } as any);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([]);
    vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([]);
    vi.mocked(prisma.campaign.count).mockResolvedValue(0);
    vi.mocked(prisma.depositSession.count).mockResolvedValue(0);
    vi.mocked(prisma.organizationCollectorPartner.count).mockResolvedValue(0);
    vi.mocked(prisma.trip.count).mockResolvedValue(0);

    const res = await GET();
    const data = await res.json();
    expect(data.tourismSummary.complianceRate).toBe(0);
  });

  it('reports SUPERADMIN rewardAvailable 0 when nothing is spendable', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.organization.count).mockResolvedValue(0);
    vi.mocked(prisma.machine.count).mockResolvedValue(0);
    vi.mocked(prisma.user.count).mockResolvedValue(0);
    vi.mocked(prisma.depositItem.count).mockResolvedValue(0);
    vi.mocked(getLiabilitySummary).mockResolvedValueOnce({
      availableLiability: 0, pendingLiability: 0, reservedLiability: 0, paidTotal: 100000, totalObligation: 0,
    });
    vi.mocked(prisma.organizationCollectorPartner.count).mockResolvedValue(0);
    vi.mocked(prisma.redemption.count).mockResolvedValue(0);

    const res = await GET();
    const data = await res.json();
    expect(data.rewardAvailable).toBe(0);
    expect(data.rewardLiability.paidTotal).toBe(100000);
  });

  it('handles unexpected errors', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('boom'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
