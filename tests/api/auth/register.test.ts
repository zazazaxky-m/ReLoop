import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/auth/register/route';
import { prisma } from '@/lib/prisma';
import * as auth from '@/lib/auth';
import * as audit from '@/lib/audit';
import * as rateLimit from '@/lib/rate-limit';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => {
  const mockTx = {
    user: { create: vi.fn() },
    travelAgentInvite: { findMany: vi.fn(), updateMany: vi.fn() },
    travelAgentUser: { upsert: vi.fn() },
    travelAgentOrganization: { updateMany: vi.fn() },
  };
  return {
    prisma: {
      user: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn().mockImplementation((callback) => callback(mockTx)),
    },
    mockTx, // exported for assertions if needed
  };
});

vi.mock('@/lib/auth', () => ({
  hashPassword: vi.fn(),
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

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: true } as any);
  });

  const makeReq = (body: any) => {
    return new NextRequest('http://localhost/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  };

  it('fails if rate limit is exceeded (429)', async () => {
    vi.mocked(rateLimit.checkRateLimit).mockReturnValue({ allowed: false } as any);

    const req = makeReq({ name: 'John Doe', email: 'john@example.com', password: 'password1234', phone: '08123456789' });
    const res = await POST(req);

    expect(res.status).toBe(429);
  });

  it('fails with validation error (422)', async () => {
    const req = makeReq({ name: 'A', email: 'invalid', password: '123', phone: 'abc' });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it('fails if email already registered (409)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1' } as any);
    
    const req = makeReq({ name: 'John Doe', email: 'john@example.com', password: 'password1234', phone: '08123456789' });
    const res = await POST(req);
    
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('Email sudah terdaftar');
  });

  it('registers successfully without invites (200)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(auth.hashPassword).mockResolvedValue('hashed_pwd');
    
    // We need to access mockTx that we defined in vi.mock
    const { mockTx } = await import('@/lib/prisma') as any;
    mockTx.user.create.mockResolvedValue({
      id: 'u1',
      name: 'John Doe',
      email: 'john@example.com',
      role: 'USER',
      tokenVersion: 0,
    });
    mockTx.travelAgentInvite.findMany.mockResolvedValue([]);
    
    const req = makeReq({ name: 'John Doe', email: 'john@example.com', password: 'password1234', phone: '08123456789' });
    const res = await POST(req);
    
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('john@example.com');
    
    expect(mockTx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'john@example.com', passwordHash: 'hashed_pwd' })
    }));
    
    expect(auth.setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ sub: 'u1' }));
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_REGISTER' }));
  });
});
