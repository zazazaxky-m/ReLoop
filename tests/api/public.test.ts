import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET as getCampaigns } from '@/app/api/public/campaigns/route';
import { GET as getMachines } from '@/app/api/public/machines/route';
import { GET as getMachine } from '@/app/api/public/machines/[code]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    campaign: { findMany: vi.fn() },
    machine: { findMany: vi.fn(), findUnique: vi.fn() },
    depositSession: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  activePartnerOrgIds: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

describe('/api/public endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (url: string) => new Request(url);

  describe('campaigns', () => {
    it('returns active public campaigns', async () => {
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([
        { id: 'c1', allowedEmailDomainsJson: ['@test.com'], organization: { name: 'Org 1' } }
      ] as any);

      const res = await getCampaigns(makeReq('http://localhost/api/public/campaigns') as any);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.campaigns).toHaveLength(1);
      expect(data.campaigns[0].allowedEmailDomains).toEqual(['@test.com']);
      expect(prisma.campaign.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { visibility: 'PUBLIC', status: 'ACTIVE' }
      }));
    });
  });

  describe('machines', () => {
    it('returns all public machines', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(prisma.machine.findMany).mockResolvedValue([
        { id: 'm1', wasteTypes: [{ wasteType: { name: 'Plastic' } }], organization: { name: 'Org 1' } }
      ] as any);

      const res = await getMachines(makeReq('http://localhost/api/public/machines') as any);
      expect(res.status).toBe(200);
      
      const data = await res.json();
      expect(data.machines).toHaveLength(1);
      expect(data.machines[0].supportedWasteTypes[0].name).toBe('Plastic');
      expect(data.machines[0].organizationName).toBe('Org 1');
    });

    it('filters for collector partners', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'coll1', role: 'PENGEPUL' } as any);
      vi.mocked(rbac.activePartnerOrgIds).mockResolvedValue(['org1']);
      vi.mocked(prisma.machine.findMany).mockResolvedValue([] as any);

      const res = await getMachines(makeReq('http://localhost/api/public/machines?scope=partners') as any);
      expect(res.status).toBe(200);
      
      expect(prisma.machine.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          organizationId: { in: ['org1'] }
        })
      }));
    });
  });

  describe('machines/[code]', () => {
    it('returns machine details by code', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ 
        id: 'm1', 
        wasteTypes: [{ wasteType: { name: 'Plastic' } }], 
        organization: { name: 'Org 1', id: 'org1' } 
      } as any);
      vi.mocked(prisma.depositSession.findMany).mockResolvedValue([{ id: 'sess1' }] as any);

      const res = await getMachine(
        makeReq('http://localhost/api/public/machines/MAC01') as any, 
        { params: Promise.resolve({ code: 'MAC01' }) }
      );
      
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.machine.organizationName).toBe('Org 1');
      expect(data.recentSessions).toHaveLength(1);
    });

    it('returns 404 if machine not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);

      const res = await getMachine(
        makeReq('http://localhost/api/public/machines/MAC01') as any, 
        { params: Promise.resolve({ code: 'MAC01' }) }
      );
      expect(res.status).toBe(404);
    });
  });
});
