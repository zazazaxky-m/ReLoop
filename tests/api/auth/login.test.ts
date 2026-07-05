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
      organizationId: null
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
});
