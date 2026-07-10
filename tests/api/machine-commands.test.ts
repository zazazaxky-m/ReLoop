import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/machine-commands/[code]/route';
import { prisma } from '@/lib/prisma';
import * as mAuth from '@/lib/machine-auth';

vi.mock('@/lib/prisma', () => {
  const mockTx = {
    machineRemoteCommand: { findFirst: vi.fn(), update: vi.fn() },
  };
  return {
    prisma: {
      machine: { findUnique: vi.fn() },
      machineRemoteCommand: { updateMany: vi.fn() },
      $transaction: vi.fn().mockImplementation((cb) => cb(mockTx)),
    },
    mockTx,
  };
});

vi.mock('@/lib/machine-auth', () => ({
  verifyMachineRequest: vi.fn(),
}));

describe('GET /api/machine-commands/[code]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = () => new Request('http://localhost/api/machine-commands/m1', {
    headers: {
      'x-reloop-timestamp': '1234567890',
      'x-reloop-nonce': 'nonce',
      'x-reloop-signature': 'sig',
      'x-reloop-machine': 'm1',
    },
  });

  it('fails if machine not found (404)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(404);
  });

  it('fails if signature invalid (401)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'mach_1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: false } as any);
    
    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(401);
  });

  it('fails if machine header does not match code (401)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'mach_1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'other' }) });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toContain('tidak cocok');
  });

  it('returns null if no pending commands (200)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'mach_1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    
    const { mockTx } = await import('@/lib/prisma') as any;
    mockTx.machineRemoteCommand.findFirst.mockResolvedValue(null);

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.command).toBeNull();
    
    expect(prisma.machineRemoteCommand.updateMany).toHaveBeenCalled();
  });

  it('returns command and marks it as DISPATCHED (200)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'mach_1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    
    const { mockTx } = await import('@/lib/prisma') as any;
    mockTx.machineRemoteCommand.findFirst.mockResolvedValue({
      id: 'cmd_1',
      status: 'QUEUED',
      command: 'REFRESH_STATE',
      payloadJson: { foo: 'bar' },
      expiresAt: new Date(Date.now() + 10000)
    });
    mockTx.machineRemoteCommand.update.mockResolvedValue({
      id: 'cmd_1',
      status: 'DISPATCHED',
      command: 'REFRESH_STATE',
      payloadJson: { foo: 'bar' },
      expiresAt: new Date(Date.now() + 10000)
    });

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(200);
    
    expect(mockTx.machineRemoteCommand.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'cmd_1' },
      data: expect.objectContaining({ status: 'DISPATCHED' })
    }));
    
    const data = await res.json();
    expect(data.command.id).toBe('cmd_1');
    expect(data.command.command).toBe('REFRESH_STATE');
    expect(data.command.payload).toEqual({ foo: 'bar' });
  });

  it('returns already-DISPATCHED pending command without updating', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'mach_1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    const { mockTx } = await import('@/lib/prisma') as any;
    mockTx.machineRemoteCommand.findFirst.mockResolvedValue({
      id: 'cmd_2',
      status: 'DISPATCHED',
      command: 'REBOOT',
      payloadJson: null,
      expiresAt: new Date(Date.now() + 10000),
    });

    const res = await GET(makeReq(), { params: Promise.resolve({ code: 'm1' }) });
    expect(res.status).toBe(200);
    expect(mockTx.machineRemoteCommand.update).not.toHaveBeenCalled();
    const data = await res.json();
    expect(data.command.id).toBe('cmd_2');
  });
});
