import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/machine-commands/[code]/[id]/result/route';
import { prisma } from '@/lib/prisma';
import * as machineAuth from '@/lib/machine-auth';
import * as realtime from '@/lib/realtime';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machine: { findUnique: vi.fn(), update: vi.fn() },
    machineRemoteCommand: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock('@/lib/machine-auth', () => ({
  verifyMachineRequest: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/realtime', () => ({ publishRealtime: vi.fn() }));

const makeParams = (code: string, id: string) => ({ params: Promise.resolve({ code, id }) });
const makeReq = (code: string, body: any) => new Request('http://localhost', {
  method: 'POST',
  body: JSON.stringify(body),
  headers: new Headers({
    'x-reloop-timestamp': '1234567890',
    'x-reloop-nonce': 'nonce',
    'x-reloop-signature': 'sig',
    'x-reloop-machine': code,
  }),
});

describe('/api/machine-commands/[code]/[id]/result POST', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when machine not found', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    const res = await POST(makeReq('M1', { success: true }), makeParams('M1', 'cmd1'));
    expect(res.status).toBe(404);
  });

  it('returns 401 when signature verification fails', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: false, reason: 'INVALID_SIGNATURE' } as any);

    const res = await POST(makeReq('M1', { success: true }), makeParams('M1', 'cmd1'));
    expect(res.status).toBe(401);
  });

  it('returns 401 when header mismatch', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);

    const res = await POST(makeReq('M2', { success: true }), makeParams('M1', 'cmd1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when command not found', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineRemoteCommand.findFirst).mockResolvedValue(null);

    const res = await POST(makeReq('M1', { success: true }), makeParams('M1', 'cmd1'));
    expect(res.status).toBe(404);
  });

  it('returns duplicate flag if command already terminal', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineRemoteCommand.findFirst).mockResolvedValue({ id: 'cmd1', status: 'SUCCEEDED' } as any);

    const res = await POST(makeReq('M1', { success: true }), makeParams('M1', 'cmd1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.duplicate).toBe(true);
  });

  it('updates command and machine state on success', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineRemoteCommand.findFirst).mockResolvedValue({ id: 'cmd1', status: 'DISPATCHED' } as any);
    vi.mocked(prisma.machineRemoteCommand.update).mockResolvedValue({ id: 'cmd1' } as any);

    const body = { success: true, result: { runtimeState: 'FULL', sensors: { fill_percent: 100 } } };
    const res = await POST(makeReq('M1', body), makeParams('M1', 'cmd1'));
    expect(res.status).toBe(200);
    
    expect(prisma.machineRemoteCommand.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) })
    );
    expect(prisma.machine.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FULL', fillLevelPercent: 100 }) })
    );
    expect(realtime.publishRealtime).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'REMOTE_COMMAND_COMPLETED', machineCode: 'M1' })
    );
  });

  it('updates command and handles error mapping on failure', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineRemoteCommand.findFirst).mockResolvedValue({ id: 'cmd1', status: 'DISPATCHED' } as any);
    vi.mocked(prisma.machineRemoteCommand.update).mockResolvedValue({ id: 'cmd1' } as any);

    const body = { success: false, error: 'Motor blocked' };
    const res = await POST(makeReq('M1', body), makeParams('M1', 'cmd1'));
    expect(res.status).toBe(200);
    
    expect(prisma.machineRemoteCommand.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', errorMessage: 'Motor blocked' }) })
    );
  });

  it('defaults failure errorMessage when error is omitted', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineRemoteCommand.findFirst).mockResolvedValue({ id: 'cmd1', status: 'DISPATCHED' } as any);
    vi.mocked(prisma.machineRemoteCommand.update).mockResolvedValue({ id: 'cmd1' } as any);

    const res = await POST(makeReq('M1', { success: false }), makeParams('M1', 'cmd1'));
    expect(res.status).toBe(200);
    expect(prisma.machineRemoteCommand.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ errorMessage: 'Perintah gagal' }),
      }),
    );
  });

  it.each([
    ['SAFE_STATE', 'ERROR'],
    ['ERROR', 'ERROR'],
    ['MAINTENANCE', 'MAINTENANCE'],
    ['IDLE', 'ONLINE'],
  ] as const)('maps runtimeState %s to machine status %s', async (runtimeState, status) => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineRemoteCommand.findFirst).mockResolvedValue({ id: 'cmd1', status: 'DISPATCHED' } as any);
    vi.mocked(prisma.machineRemoteCommand.update).mockResolvedValue({ id: 'cmd1' } as any);

    const res = await POST(
      makeReq('M1', { success: true, result: { runtimeState } }),
      makeParams('M1', 'cmd1'),
    );
    expect(res.status).toBe(200);
    expect(prisma.machine.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status }) }),
    );
  });
});
