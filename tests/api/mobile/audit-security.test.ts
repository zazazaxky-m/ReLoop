import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/mobile/audit-security/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import { getSecurityEvents, getSecuritySummary } from '@/lib/security-events';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/security-events', () => ({
  getSecurityEvents: vi.fn(),
  getSecuritySummary: vi.fn(),
}));

vi.mock('@/lib/display-user', () => ({
  displayUsers: vi.fn((users) => users.map((u: any) => ({ ...u, name: u.name + ' (decrypted)' }))),
}));

describe('/api/mobile/audit-security GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await GET(new Request('http://localhost/api/mobile/audit-security'));
    expect(res.status).toBe(403);
  });

  it('returns assembled audit and security data', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { id: 'al1', actorId: 'u1' },
      { id: 'al2', actorId: null },
    ] as any);
    
    vi.mocked(getSecurityEvents).mockResolvedValue([{ id: 'se1' }] as any);
    vi.mocked(getSecuritySummary).mockResolvedValue({ alerts24h: 5 } as any);
    
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: 'u1', name: 'Alice', role: 'ADMIN' },
    ] as any);

    const res = await GET(new Request('http://localhost/api/mobile/audit-security?take=10&machineId=m1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.auditLogs).toHaveLength(2);
    expect(data.auditLogs[0].actor.name).toBe('Alice (decrypted)');
    expect(data.auditLogs[1].actor).toBeNull();
    
    expect(data.securityEvents).toHaveLength(1);
    expect(data.securitySummary.alerts24h).toBe(5);
    
    expect(getSecurityEvents).toHaveBeenCalledWith(expect.objectContaining({
      take: 10,
      machineId: 'm1',
    }));
  });

  it('clamps take parameter between 1 and 200', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);
    vi.mocked(getSecurityEvents).mockResolvedValue([] as any);
    vi.mocked(getSecuritySummary).mockResolvedValue({} as any);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);

    await GET(new Request('http://localhost/api/mobile/audit-security?take=500'));
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 200 }));
    
    await GET(new Request('http://localhost/api/mobile/audit-security?take=0'));
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 1 }));
  });

  it('defaults take and skips actor lookup when no actorIds', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { id: 'al1', actorId: null },
    ] as any);
    vi.mocked(getSecurityEvents).mockResolvedValue([] as any);
    vi.mocked(getSecuritySummary).mockResolvedValue({} as any);

    const res = await GET(new Request('http://localhost/api/mobile/audit-security'));
    expect(res.status).toBe(200);
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(getSecurityEvents).toHaveBeenCalledWith(expect.objectContaining({ machineId: undefined }));
  });

  it('maps missing actorId lookup to null actor', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { id: 'al1', actorId: 'missing-user' },
    ] as any);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(getSecurityEvents).mockResolvedValue([] as any);
    vi.mocked(getSecuritySummary).mockResolvedValue({} as any);

    const res = await GET(new Request('http://localhost/api/mobile/audit-security'));
    const data = await res.json();
    expect(data.auditLogs[0].actor).toBeNull();
  });

  it('serializes the BigInt chain position (A05) as a string instead of failing', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
      { id: 'al1', actorId: null, chainVersion: 2, chainSequence: 9007199254740993n },
      { id: 'al2', actorId: null, chainVersion: 1, chainSequence: null },
    ] as any);
    vi.mocked(getSecurityEvents).mockResolvedValue([] as any);
    vi.mocked(getSecuritySummary).mockResolvedValue({} as any);

    const res = await GET(new Request('http://localhost/api/mobile/audit-security'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.auditLogs.map((l: any) => [l.chainVersion, l.chainSequence])).toEqual([[2, '9007199254740993'], [1, null]]);
  });
});
