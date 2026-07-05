import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/machine-session/[code]/route';
import { prisma } from '@/lib/prisma';
import * as mAuth from '@/lib/machine-auth';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machine: { findUnique: vi.fn() },
    depositSession: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/machine-auth', () => ({
  verifyMachineSignature: vi.fn(),
}));

describe('GET /api/machine-session/[code]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = () => new Request('http://localhost/api/machine-session/m1', {
    headers: {
      'x-reloop-timestamp': '1234567890',
      'x-reloop-nonce': 'nonce',
      'x-reloop-signature': 'sig',
    },
  });

  it('fails if machine not found (404)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(404);
  });

  it('fails if signature is invalid (401)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineSignature).mockReturnValue({ ok: false, reason: 'Invalid' } as any);
    
    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(401);
  });

  it('returns null session if no active session exists (200)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret', sessionIdleTimeoutMinutes: 3 } as any);
    vi.mocked(mAuth.verifyMachineSignature).mockReturnValue({ ok: true } as any);
    vi.mocked(prisma.depositSession.findFirst).mockResolvedValue(null);

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session).toBeNull();
    expect(data.lease).toBeNull();
  });

  it('returns active session and lease (200)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret', sessionIdleTimeoutMinutes: 3 } as any);
    vi.mocked(mAuth.verifyMachineSignature).mockReturnValue({ ok: true } as any);
    vi.mocked(prisma.depositSession.findFirst).mockResolvedValue({
      id: 'sess1',
      status: 'ACTIVE',
      timeoutAt: new Date(Date.now() + 60000), // Not expired
      user: { id: 'u1', name: 'John' },
      items: [{ quantity: 2, rewardAmount: 10, wasteType: { id: 'wt1', name: 'Plastic' } }],
    } as any);

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.session.id).toBe('sess1');
    expect(data.session.totalQuantity).toBe(2);
    expect(data.session.totalReward).toBe(10);
    expect(data.lease.id).toBe('lease-sess1');
    expect(data.lease.signature).toBeDefined();
  });

  it('expires session if timeout passed (200)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret', sessionIdleTimeoutMinutes: 3 } as any);
    vi.mocked(mAuth.verifyMachineSignature).mockReturnValue({ ok: true } as any);
    vi.mocked(prisma.depositSession.findFirst).mockResolvedValue({
      id: 'sess1',
      status: 'ACTIVE',
      timeoutAt: new Date(Date.now() - 60000), // Expired
      user: { id: 'u1' },
      items: [],
    } as any);

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(200);
    
    expect(prisma.depositSession.update).toHaveBeenCalledWith({
      where: { id: 'sess1' },
      data: expect.objectContaining({ status: 'EXPIRED' })
    });
    
    const data = await res.json();
    expect(data.session).toBeNull(); // Session should be null because it just expired
  });
});
