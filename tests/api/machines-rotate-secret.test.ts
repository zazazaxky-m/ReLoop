import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/machines/[id]/rotate-secret/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as machineAuth from '@/lib/machine-auth';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machine: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/machine-auth', () => ({ generateIngestSecret: vi.fn() }));

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe('/api/machines/[id]/rotate-secret POST', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await POST(new Request('http://localhost'), makeParams('m1'));
    expect(res.status).toBe(403);
  });

  it('returns 404 when machine not found', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    
    const res = await POST(new Request('http://localhost'), makeParams('m1'));
    expect(res.status).toBe(404);
  });

  it('rotates secret and returns new secret', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', machineCode: 'M1' } as any);
    vi.mocked(machineAuth.generateIngestSecret).mockReturnValue('new-secret-123');
    vi.mocked(prisma.machine.update).mockResolvedValue({} as any);

    const res = await POST(new Request('http://localhost'), makeParams('m1'));
    expect(res.status).toBe(200);
    
    expect(prisma.machine.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { ingestSecret: 'new-secret-123' } })
    );
    const data = await res.json();
    expect(data.ingestSecret).toBe('new-secret-123');
  });
});
