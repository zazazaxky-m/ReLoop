import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PATCH } from '@/app/api/users/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as audit from '@/lib/audit';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

const makeReq = (body: any) =>
  new Request('http://localhost/api/users/u1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

describe('/api/users/[id] PATCH', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await PATCH(makeReq({}), makeParams('u1'));
    expect(res.status).toBe(403);
  });

  it('returns 404 when user not found', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    const res = await PATCH(makeReq({ status: 'ACTIVE' }), makeParams('u1'));
    expect(res.status).toBe(404);
  });

  it('updates user successfully (200)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', role: 'USER', status: 'ACTIVE', organizationId: null,
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({
      id: 'u1', role: 'USER', status: 'INACTIVE', organizationId: null,
    } as any);

    const res = await PATCH(makeReq({ status: 'INACTIVE' }), makeParams('u1'));
    expect(res.status).toBe(200);
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'USER_UPDATE', entityId: 'u1' }),
    );
  });

  it('returns 422 when changing to ADMIN without organizationId', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', role: 'USER', status: 'ACTIVE', organizationId: null,
    } as any);

    const res = await PATCH(makeReq({ role: 'ADMIN' }), makeParams('u1'));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain('organisasi');
  });

  it('returns 409 when trying to demote last active superadmin', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', role: 'SUPERADMIN', status: 'ACTIVE', organizationId: null,
    } as any);
    vi.mocked(prisma.user.count).mockResolvedValue(1);

    const res = await PATCH(makeReq({ role: 'USER' }), makeParams('u1'));
    expect(res.status).toBe(409);
  });

  it('allows demoting superadmin when others exist', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', role: 'SUPERADMIN', status: 'ACTIVE', organizationId: null,
    } as any);
    vi.mocked(prisma.user.count).mockResolvedValue(3);
    vi.mocked(prisma.user.update).mockResolvedValue({ id: 'u1', role: 'USER', status: 'ACTIVE' } as any);

    const res = await PATCH(makeReq({ role: 'USER' }), makeParams('u1'));
    expect(res.status).toBe(200);
  });

  it('increments tokenVersion when role changes', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', role: 'USER', status: 'ACTIVE', organizationId: null,
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({ id: 'u1' } as any);

    await PATCH(makeReq({ role: 'PENGEPUL' }), makeParams('u1'));
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenVersion: { increment: 1 } }),
      }),
    );
  });

  it('does not increment tokenVersion when role and status do not change', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', role: 'USER', status: 'ACTIVE', organizationId: null,
    } as any);
    vi.mocked(prisma.user.update).mockResolvedValue({ id: 'u1' } as any);

    await PATCH(makeReq({ phone: '123' }), makeParams('u1'));
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.not.objectContaining({ tokenVersion: expect.anything() }),
      }),
    );
  });

  it('returns 409 when suspending last active superadmin', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u1', role: 'SUPERADMIN', status: 'ACTIVE', organizationId: null,
    } as any);
    vi.mocked(prisma.user.count).mockResolvedValue(1);

    const res = await PATCH(makeReq({ status: 'SUSPENDED' }), makeParams('u1'));
    expect(res.status).toBe(409);
  });

  it('handles unexpected errors', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('Unexpected error'));
    const res = await PATCH(makeReq({ status: 'SUSPENDED' }), makeParams('u1'));
    expect(res.status).toBe(500);
  });
});
