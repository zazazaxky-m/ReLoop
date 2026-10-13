import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/auth/register/route';
import { prisma } from '@/lib/prisma';
import * as auth from '@/lib/auth';
import * as audit from '@/lib/audit';
import * as rateLimit from '@/lib/rate-limit';
import { NextRequest } from 'next/server';

const { deferred } = vi.hoisted(() => ({ deferred: [] as Array<() => unknown> }));
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return { ...actual, after: vi.fn((task: () => unknown) => deferred.push(task)) };
});

vi.mock('@/lib/prisma', () => {
  // A03: registration touches only the user and its verification mail; any
  // invitation/membership access would hit these spies.
  const mockTx = {
    user: { create: vi.fn() },
    emailOutbox: { create: vi.fn() },
    travelAgentInvite: { findMany: vi.fn(), updateMany: vi.fn() },
    travelAgentUser: { upsert: vi.fn(), create: vi.fn() },
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

vi.mock('@/lib/email-outbox', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/email-outbox')>()),
  deliverEmailOutboxSafely: vi.fn(),
}));

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

  it('refuses the reserved erased-account domain, so an erased address cannot be squatted (422)', async () => {
    for (const email of ['erased-ckuser123@invalid.reloop', 'Erased-X@INVALID.RELOOP', 'a@sub.invalid.reloop']) {
      const res = await POST(makeReq({ name: 'John Doe', email, password: 'password1234', phone: '08123456789' }));
      expect(res.status).toBe(422);
    }
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('fails if email already registered (409)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1' } as any);
    
    const req = makeReq({ name: 'John Doe', email: 'john@example.com', password: 'password1234', phone: '08123456789' });
    const res = await POST(req);
    
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('Email sudah terdaftar');
  });

  it('registers with 201, queues a verification mail after the response, and claims no invitation (A03)', async () => {
    deferred.length = 0;
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(auth.hashPassword).mockResolvedValue('hashed_pwd');

    const { mockTx } = await import('@/lib/prisma') as any;
    mockTx.user.create.mockResolvedValue({
      id: 'u2',
      name: 'Agent Owner',
      email: 'owner@example.com',
      role: 'USER',
      tokenVersion: 0,
    });
    mockTx.emailOutbox.create.mockResolvedValue({ id: 'outbox-1' });

    const req = makeReq({ name: 'Agent Owner', email: 'Owner@Example.com', password: 'password1234', phone: '08123456789' });
    const res = await POST(req);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user).toMatchObject({ id: 'u2', email: 'owner@example.com', role: 'USER', emailVerified: false });
    expect(body.emailVerificationQueued).toBe(true);
    expect(mockTx.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ email: 'owner@example.com', passwordHash: 'hashed_pwd' })
    }));
    expect(mockTx.emailOutbox.create).toHaveBeenCalledWith({
      data: { kind: 'EMAIL_VERIFICATION', userId: 'u2', emailLookup: expect.stringMatching(/^[0-9a-f]{64}$/) },
      select: { id: true },
    });
    // No invitation is looked up, consumed or turned into a membership.
    expect(mockTx.travelAgentInvite.findMany).not.toHaveBeenCalled();
    expect(mockTx.travelAgentInvite.updateMany).not.toHaveBeenCalled();
    expect(mockTx.travelAgentUser.upsert).not.toHaveBeenCalled();
    expect(mockTx.travelAgentUser.create).not.toHaveBeenCalled();
    expect(mockTx.travelAgentOrganization.updateMany).not.toHaveBeenCalled();
    expect(auth.setSessionCookie).toHaveBeenCalledWith(expect.objectContaining({ sub: 'u2' }));
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_REGISTER' }));
    // The mail is sent only after the response.
    expect(deferred).toHaveLength(1);
  });
});
