import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/mobile/map/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as mapData from '@/lib/map-data';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machine: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  activePartnerOrgIds: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/map-data', () => ({
  loadPublicMapCampaigns: vi.fn().mockResolvedValue([]),
  MAX_MAP_MACHINES: 100,
}));

describe('/api/mobile/map GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all machines for SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([{ id: 'm1', wasteTypes: [] }] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(prisma.machine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ latitude: { not: null } }) }),
    );
  });

  it('returns org-scoped machines for ADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([{ id: 'm1', wasteTypes: [] }] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(prisma.machine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: { in: ['org1'] } }) }),
    );
  });

  it('returns empty array if PENGEPUL has no active partners', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue([]);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.machines).toHaveLength(0);
    expect(prisma.machine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: { in: ['__none__'] } }) }),
    );
  });

  it('returns partner-scoped machines for PENGEPUL', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue(['org1', 'org2']);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([{ id: 'm1', wasteTypes: [] }] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(prisma.machine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ organizationId: { in: ['org1', 'org2'] } }) }),
    );
  });

  it('returns mapped markers for USER', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([
      { id: 'm1', name: 'Machine 1', latitude: 10, longitude: 20, wasteTypes: [] },
    ] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.machines[0].name).toBe('Machine 1');
  });

  it('maps campaign markers for non-PENGEPUL roles', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([
      {
        id: 'm1',
        name: 'M1',
        machineCode: 'MC1',
        status: 'ONLINE',
        fillLevelPercent: 10,
        capacityKg: 50,
        organization: { id: 'org1', name: 'Org' },
        latitude: 1,
        longitude: 2,
        wasteTypes: [{ wasteType: { id: 'wt1', name: 'PET' } }],
      },
    ] as any);
    vi.mocked(mapData.loadPublicMapCampaigns).mockResolvedValue([
      {
        id: 'camp1',
        name: 'Campaign A',
        organizationId: 'org1',
        organizationName: 'Org One',
        rewardMultiplier: 1.5,
        latitude: -6.2,
        longitude: 106.8,
      },
    ] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.campaigns).toEqual([
      {
        id: 'camp1',
        name: 'Campaign A',
        organization: { id: 'org1', name: 'Org One' },
        rewardMultiplier: 1.5,
        latitude: -6.2,
        longitude: 106.8,
      },
    ]);
    expect(data.machines[0].supportedWasteTypes).toEqual([{ id: 'wt1', name: 'PET' }]);
  });

  it('skips campaigns for PENGEPUL and uses empty org scope for ADMIN without org', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: null } as any);
    vi.mocked(prisma.machine.findMany).mockResolvedValue([] as any);
    vi.mocked(mapData.loadPublicMapCampaigns).mockResolvedValue([] as any);

    const res = await GET();
    expect(res.status).toBe(200);
    expect(prisma.machine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: { in: ['__none__'] } }),
      }),
    );
  });

  it('handles unexpected errors', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('boom'));
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
