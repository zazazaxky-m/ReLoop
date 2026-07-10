import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PATCH } from '@/app/api/travel-agents/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    travelAgentOrganization: { findUnique: vi.fn(), update: vi.fn() },
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

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe('/api/travel-agents/[id] PATCH', () => {
  beforeEach(() => vi.clearAllMocks());

  it('suspends an invited travel agent', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue({
      id: 'link1',
      status: 'INVITED',
      approvedAt: new Date(),
      travelAgent: { id: 'ta1', name: 'Agent', email: 'a@x.com' },
    } as any);
    vi.mocked(prisma.travelAgentOrganization.update).mockResolvedValue({
      id: 'link1',
      status: 'SUSPENDED',
      travelAgent: { id: 'ta1', name: 'Agent', email: 'a@x.com' },
    } as any);

    const req = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ organizationStatus: 'SUSPENDED' }),
    });
    const res = await PATCH(req, makeParams('ta1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.agent.organizationStatus).toBe('SUSPENDED');
  });

  it('rejects suspending a pending agent', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue({
      id: 'link1',
      status: 'PENDING',
      travelAgent: { id: 'ta1', name: 'Agent', email: 'a@x.com' },
    } as any);

    const req = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ organizationStatus: 'SUSPENDED' }),
    });
    const res = await PATCH(req, makeParams('ta1'));
    expect(res.status).toBe(422);
  });

  it('allows SUPERADMIN to pass organizationId', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue({
      id: 'link1', status: 'SUSPENDED',
      travelAgent: { id: 'ta1', name: 'Agent', email: 'a@x.com' },
    } as any);
    vi.mocked(prisma.travelAgentOrganization.update).mockResolvedValue({
      id: 'link1', status: 'INVITED',
      travelAgent: { id: 'ta1', name: 'Agent', email: 'a@x.com' },
    } as any);

    const req = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ organizationStatus: 'INVITED', organizationId: 'org2' }),
    });
    const res = await PATCH(req, makeParams('ta1'));
    expect(res.status).toBe(200);
  });

  it('returns 422 if SUPERADMIN does not provide organizationId', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    
    const req = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ organizationStatus: 'INVITED' }),
    });
    const res = await PATCH(req, makeParams('ta1'));
    expect(res.status).toBe(422);
  });

  it('returns 404 if travel agent link not found', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue(null);
    
    const req = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ organizationStatus: 'INVITED' }),
    });
    const res = await PATCH(req, makeParams('ta1'));
    expect(res.status).toBe(404);
  });

  it('allows PENDING to be updated to REMOVED', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue({
      id: 'link1', status: 'PENDING',
      travelAgent: { id: 'ta1', name: 'Agent', email: 'a@x.com' },
    } as any);
    vi.mocked(prisma.travelAgentOrganization.update).mockResolvedValue({
      id: 'link1', status: 'REMOVED',
      travelAgent: { id: 'ta1', name: 'Agent', email: 'a@x.com' },
    } as any);
    
    const req = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ organizationStatus: 'REMOVED' }),
    });
    const res = await PATCH(req, makeParams('ta1'));
    expect(res.status).toBe(200);
  });

  it('sets approvedAt if INVITED and currently null', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.travelAgentOrganization.findUnique).mockResolvedValue({
      id: 'link1', status: 'SUSPENDED', approvedAt: null,
      travelAgent: { id: 'ta1', name: 'Agent', email: 'a@x.com' },
    } as any);
    vi.mocked(prisma.travelAgentOrganization.update).mockResolvedValue({
      id: 'link1', status: 'INVITED',
      travelAgent: { id: 'ta1', name: 'Agent', email: 'a@x.com' },
    } as any);
    
    const req = new Request('http://localhost', {
      method: 'PATCH',
      body: JSON.stringify({ organizationStatus: 'INVITED' }),
    });
    await PATCH(req, makeParams('ta1'));
    expect(prisma.travelAgentOrganization.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          approvedAt: expect.any(Date),
        })
      })
    );
  });
});
