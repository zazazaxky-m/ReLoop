import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/travel-agents/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    travelAgentOrganization: { findMany: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    travelAgentInvite: { create: vi.fn(), updateMany: vi.fn() },
    travelAgent: { findMany: vi.fn(), count: vi.fn(), upsert: vi.fn() },
    travelAgentUser: { upsert: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  assertOrgScope: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/tourism', () => ({
  normalizeTravelAgentEmail: vi.fn((e: string) => e.toLowerCase()),
}));
vi.mock('@/lib/pagination', async (importOriginal) => {
  const actual = await importOriginal();
  return actual as any;
});

describe('/api/travel-agents', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET', () => {
    it('returns 422 when no organizationId', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      const res = await GET(new Request('http://localhost/api/travel-agents'));
      expect(res.status).toBe(422);
    });

    it('returns agents for ADMIN (uses own org)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.travelAgentOrganization.findMany).mockResolvedValue([]);
      vi.mocked(prisma.travelAgent.findMany).mockResolvedValue([]);
      vi.mocked(prisma.travelAgent.count).mockResolvedValue(0);

      const res = await GET(new Request('http://localhost/api/travel-agents'));
      expect(res.status).toBe(200);
    });

    it('returns agents for SUPERADMIN with query param', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.travelAgentOrganization.findMany).mockResolvedValue([]);
      vi.mocked(prisma.travelAgent.findMany).mockResolvedValue([
        {
          id: 'ta1', name: 'Agent', email: 'a@a.com', phone: null, contactPerson: null, status: 'ACTIVE',
          organizations: [{ status: 'INVITED' }],
          trips: [{ id: 't1', complianceStatus: 'COMPLIANT' }, { id: 't2', complianceStatus: 'NON_COMPLIANT' }],
        },
        {
          id: 'ta2', name: 'Agent 2', email: 'b@b.com', phone: null, contactPerson: null, status: 'ACTIVE',
          organizations: [],
          trips: [],
        },
      ] as any);
      vi.mocked(prisma.travelAgent.count).mockResolvedValue(1);

      const res = await GET(new Request('http://localhost/api/travel-agents?organizationId=org1'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.agents[0].compliantCount).toBe(1);
      expect(data.agents[0].nonCompliantCount).toBe(1);
    });

    it('auto-accepts pending invites if users are registered', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.travelAgentOrganization.findMany).mockResolvedValue([
        { id: 'link1', travelAgent: { id: 'ta1', email: 'registered@test.com' } },
        { id: 'link2', travelAgent: { id: 'ta2', email: 'unregistered@test.com' } },
      ] as any);
      
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: 'u1', email: 'registered@test.com' }
      ] as any);
      
      vi.mocked(prisma.travelAgent.findMany).mockResolvedValue([]);
      vi.mocked(prisma.travelAgent.count).mockResolvedValue(0);

      const res = await GET(new Request('http://localhost/api/travel-agents'));
      expect(res.status).toBe(200);
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('POST', () => {
    it('returns 422 when no organizationId', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ name: 'Agent', email: 'a@a.com' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(422);
    });

    it('invites new travel agent (user not registered)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          travelAgent: { upsert: vi.fn().mockResolvedValue({ id: 'ta1' }) },
          travelAgentOrganization: { upsert: vi.fn() },
          travelAgentInvite: { create: vi.fn().mockResolvedValue({ id: 'inv1' }) },
          travelAgentUser: { upsert: vi.fn() },
        };
        return fn(mockTx);
      });

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ name: 'Agent', email: 'new@agent.com' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    it('invites existing user with INVITED status', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => {
        const mockTx = {
          travelAgent: { upsert: vi.fn().mockResolvedValue({ id: 'ta1' }) },
          travelAgentOrganization: { upsert: vi.fn() },
          travelAgentInvite: { create: vi.fn().mockResolvedValue({ id: 'inv1' }) },
          travelAgentUser: { upsert: vi.fn() },
        };
        return fn(mockTx);
      });

      const req = new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ name: 'Agent', email: 'existing@agent.com' }),
      });
      const res = await POST(req);
      expect(res.status).toBe(201);
    });
  });
});
