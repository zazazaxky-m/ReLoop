import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/auth/login/route';
import { prisma } from '@/lib/prisma';
import * as auth from '@/lib/auth';
import * as audit from '@/lib/audit';
import * as rateLimit from '@/lib/rate-limit';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/auth', () => ({
  verifyPassword: vi.fn(),
  setSessionCookie: vi.fn(),
  buildSessionPayload: vi.fn((user) => ({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    organizationId: user.organizationId,
    tokenVersion: user.tokenVersion,
  })),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn(),
}));

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (body: any, ip: string = '127.0.0.1') => {
    return new NextRequest('http://localhost/api/auth/login', {
      method: 'POST',
      headers: {
        'x-forwarded-for': ip,
      },
      body: JSON.stringify(body),
    });
  };

  it('fails if rate limit is exceeded (429)', async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: false } as any);
    
    const req = makeReq({ email: 'test@example.com', password: 'pass' });
    const res = await POST(req);
    
    expect(res.status).toBe(429);
  });

  it('fails with validation error if email invalid (422)', async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: true } as any);
    
    const req = makeReq({ email: 'not-an-email', password: 'pass' });
    const res = await POST(req);
    
    expect(res.status).toBe(422);
  });

  it('fails if user not found (401)', async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: true } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    
    const req = makeReq({ email: 'test@example.com', password: 'pass' });
    const res = await POST(req);
    
    expect(res.status).toBe(401);
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'LOGIN_FAILED' }));
    // The audit chain is immutable: the typed address must never be written to it.
    const failed = vi.mocked(audit.logAudit).mock.calls.find(([entry]) => entry.action === 'LOGIN_FAILED')![0];
    expect(JSON.stringify(failed).toLowerCase()).not.toContain('test@example.com');
    expect(failed.entityId).toMatch(/^[0-9a-f]{16,}$/);
  });

  it('fails if password incorrect (401)', async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: true } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1', email: 'test@example.com', passwordHash: 'hash' } as any);
    vi.mocked(auth.verifyPassword).mockResolvedValue(false); // bad password
    
    const req = makeReq({ email: 'test@example.com', password: 'wrong' });
    const res = await POST(req);
    
    expect(res.status).toBe(401);
  });

  it('fails if account is inactive (403)', async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: true } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ 
      id: 'u1', 
      email: 'test@example.com', 
      passwordHash: 'hash',
      status: 'SUSPENDED'
    } as any);
    vi.mocked(auth.verifyPassword).mockResolvedValue(true);
    
    const req = makeReq({ email: 'test@example.com', password: 'pass' });
    const res = await POST(req);
    
    expect(res.status).toBe(403);
  });

  it('succeeds, sets cookie, logs audit, returns user (200)', async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: true } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ 
      id: 'u1', 
      name: 'John',
      email: 'test@example.com', 
      passwordHash: 'hash',
      status: 'ACTIVE',
      role: 'USER',
      organizationId: null,
      tokenVersion: 0,
      mfaEnabled: false,
    } as any);
    vi.mocked(auth.verifyPassword).mockResolvedValue(true);
    
    const req = makeReq({ email: 'test@example.com', password: 'pass' });
    const res = await POST(req);
    
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('test@example.com');
    expect(body.redirectTo).toBe('/dashboard/user');

    expect(auth.setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({
      sub: 'u1',
      role: 'USER'
    }));

    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_LOGIN' }));
  });

  it('returns MFA challenge for privileged users with MFA enabled (200)', async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: true } as any);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'admin-1',
      name: 'Admin',
      email: 'admin@example.com',
      passwordHash: 'hash',
      status: 'ACTIVE',
      role: 'ADMIN',
      organizationId: 'org-1',
      tokenVersion: 0,
      mfaEnabled: true,
    } as any);
    vi.mocked(auth.verifyPassword).mockResolvedValue(true);

    const req = makeReq({ email: 'admin@example.com', password: 'pass' });
    const res = await POST(req);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.requiresMfa).toBe(true);
    expect(body.challengeToken).toBeTruthy();
    expect(auth.setSessionCookie).not.toHaveBeenCalled();
  });
});
