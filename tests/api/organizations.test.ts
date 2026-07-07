import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/organizations/route';
import { PATCH } from '@/app/api/organizations/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as audit from '@/lib/audit';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

describe('/api/organizations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (method = 'GET', body?: any) => new Request('http://localhost/api/organizations', {
    method,
    body: body ? JSON.stringify(body) : undefined,
  });

  describe('GET list', () => {
    it('returns list of organizations for authorized user (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.organization.count).mockResolvedValue(1);
      vi.mocked(prisma.organization.findMany).mockResolvedValue([{ id: 'org1', name: 'Org 1' }] as any);

      const res = await GET(new Request("http://localhost/api/organizations"));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.organizations).toHaveLength(1);
    });

    it('denies access if unauthorized (401)', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(401, 'Unauthorized'));
      const res = await GET(new Request("http://localhost/api/organizations"));
      expect(res.status).toBe(401);
    });
  });

  describe('POST create', () => {
    it('requires SUPERADMIN role (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await POST(makeReq('POST', { name: 'New Org' }));
      expect(res.status).toBe(403);
    });

    it('creates organization successfully (201)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1' } as any);
      vi.mocked(prisma.organization.create).mockResolvedValue({ id: 'org1', name: 'New Org' } as any);

      const res = await POST(makeReq('POST', { name: 'New Org', type: 'SCHOOL' }));
      expect(res.status).toBe(201);
      
      expect(prisma.organization.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ name: 'New Org', type: 'SCHOOL' })
      }));
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ORGANIZATION_CREATE' }));
    });
  });

  describe('PATCH update', () => {
    const makePatchReq = (body: any) => new Request('http://localhost/api/organizations/org1', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

    it('requires SUPERADMIN role (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await PATCH(makePatchReq({ name: 'Updated' }), { params: Promise.resolve({ id: 'org1' }) });
      expect(res.status).toBe(403);
    });

    it('updates organization successfully (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1' } as any);
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({ id: 'org1' } as any);
      vi.mocked(prisma.organization.update).mockResolvedValue({ id: 'org1', name: 'Updated' } as any);

      const res = await PATCH(makePatchReq({ name: 'Updated' }), { params: Promise.resolve({ id: 'org1' }) });
      expect(res.status).toBe(200);
      
      expect(prisma.organization.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'org1' },
        data: { name: 'Updated' }
      }));
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'ORGANIZATION_UPDATE' }));
    });

    it('returns 404 if org not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'super1' } as any);
      vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);

      const res = await PATCH(makePatchReq({ name: 'Updated' }), { params: Promise.resolve({ id: 'org1' }) });
      expect(res.status).toBe(404);
    });
  });
});
