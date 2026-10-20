import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/travel-agents/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

const { deferred } = vi.hoisted(() => ({ deferred: [] as Array<() => unknown> }));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn((task: () => unknown) => deferred.push(task)) };
});
vi.mock('@/lib/email-outbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email-outbox')>()),
  deliverEmailOutboxSafely: vi.fn(),
}));

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
          users: [
            { verifiedAt: new Date(), user: { emailVerifiedAt: new Date() } },
            { verifiedAt: null, user: { emailVerifiedAt: new Date() } },
          ],
          invites: [{ createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000), acceptedAt: null }],
        },
        {
          id: 'ta2', name: 'Agent 2', email: 'b@b.com', phone: null, contactPerson: null, status: 'ACTIVE',
          organizations: [],
          trips: [],
          users: [],
          invites: [],
        },
      ] as any);
      vi.mocked(prisma.travelAgent.count).mockResolvedValue(1);

      const res = await GET(new Request('http://localhost/api/travel-agents?organizationId=org1'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.agents[0].compliantCount).toBe(1);
      expect(data.agents[0].nonCompliantCount).toBe(1);
      expect(data.agents[0]).toMatchObject({ memberCount: 2, verifiedMemberCount: 1, latestInvite: { state: 'SENT' } });
      expect(data.agents[1]).toMatchObject({ memberCount: 0, verifiedMemberCount: 0, latestInvite: null });
    });

    it('never links registered accounts to pending agents while listing (A03)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.travelAgent.findMany).mockResolvedValue([]);
      vi.mocked(prisma.travelAgent.count).mockResolvedValue(0);

      const res = await GET(new Request('http://localhost/api/travel-agents'));
      expect(res.status).toBe(200);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.travelAgentUser.upsert).not.toHaveBeenCalled();
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

    function inviteTx(linkStatus: string | null) {
      const tx = {
        travelAgent: { upsert: vi.fn().mockResolvedValue({ id: 'ta1', name: 'Agent', email: 'new@agent.com' }) },
        travelAgentOrganization: {
          upsert: vi.fn().mockResolvedValue({ id: 'link1' }),
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          findUniqueOrThrow: vi.fn().mockResolvedValue({ status: linkStatus ?? 'PENDING' }),
        },
        travelAgentInvite: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({ id: 'inv1' }),
          update: vi.fn(),
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'inv1', status: 'PENDING', email: 'new@agent.com' }),
        },
        emailOutbox: { create: vi.fn().mockResolvedValue({ id: 'outbox-1' }) },
        travelAgentUser: { upsert: vi.fn(), create: vi.fn() },
      };
      vi.mocked(prisma.$transaction).mockImplementation(async (fn: any) => fn(tx));
      return tx;
    }

    it('queues an invitation mail and creates no membership, even when the email has an account (A03)', async () => {
      deferred.length = 0;
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1' } as any);
      const tx = inviteTx(null);

      const res = await POST(new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ name: 'Agent', email: 'New@Agent.com' }),
      }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toMatchObject({ organizationStatus: 'PENDING', delivery: 'QUEUED', invite: { id: 'inv1' } });
      expect(JSON.stringify(body)).not.toContain('tokenHash');
      expect(tx.travelAgentOrganization.upsert).toHaveBeenCalledWith(expect.objectContaining({
        create: expect.objectContaining({ status: 'PENDING', approvedAt: null }),
        update: { invitedById: 'a1', notes: undefined },
      }));
      // Only a suspended or removed link is set back to PENDING (never an INVITED one).
      expect(tx.travelAgentOrganization.updateMany).toHaveBeenCalledWith({
        where: { id: 'link1', status: { in: ['SUSPENDED', 'REMOVED'] } }, data: { status: 'PENDING' },
      });
      expect(tx.travelAgentInvite.create).toHaveBeenCalledWith({
        data: { travelAgentId: 'ta1', organizationId: 'org1', email: 'new@agent.com', status: 'PENDING', invitedById: 'a1' },
        select: { id: true },
      });
      expect(tx.emailOutbox.create).toHaveBeenCalledWith({ data: { kind: 'TRAVEL_AGENT_INVITE', inviteId: 'inv1' }, select: { id: true } });
      expect(tx.travelAgentUser.upsert).not.toHaveBeenCalled();
      expect(tx.travelAgentUser.create).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(deferred).toHaveLength(1);
    });

    it('keeps an INVITED agent INVITED when the invitation is sent again', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      const tx = inviteTx('INVITED');
      tx.travelAgentInvite.findFirst.mockResolvedValue({ id: 'inv-open' });
      tx.travelAgentInvite.update.mockResolvedValue({ id: 'inv-open' });

      const res = await POST(new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ name: 'Agent', email: 'existing@agent.com' }),
      }));
      expect(res.status).toBe(201);
      expect((await res.json()).organizationStatus).toBe('INVITED');
      const upsertArgs = tx.travelAgentOrganization.upsert.mock.calls[0][0] as any;
      expect(upsertArgs.update).not.toHaveProperty('status');
      // The open invitation is reused; its next delivery mints a new token.
      expect(tx.travelAgentInvite.create).not.toHaveBeenCalled();
      expect(tx.emailOutbox.create).toHaveBeenCalledWith({ data: { kind: 'TRAVEL_AGENT_INVITE', inviteId: 'inv-open' }, select: { id: true } });
    });

    it('refuses the reserved erased-account domain', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      const res = await POST(new Request('http://localhost', {
        method: 'POST', body: JSON.stringify({ name: 'Agent', email: 'erased-x@invalid.reloop' }),
      }));
      expect(res.status).toBe(422);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
