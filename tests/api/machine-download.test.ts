import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/machine-media/download/[code]/[id]/route';
import { prisma } from '@/lib/prisma';
import * as machineAuth from '@/lib/machine-auth';
import { readFile } from 'node:fs/promises';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machine: { findUnique: vi.fn() },
    machineMedia: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/machine-auth', () => ({
  verifyMachineRequest: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('@/lib/machine-media', () => ({
  resolveMachineMediaPath: vi.fn((p) => `/tmp/media/${p}`),
}));

const makeParams = (code: string, id: string) => ({ params: Promise.resolve({ code, id }) });
const makeReq = (code: string) => new Request('http://localhost', {
  headers: new Headers({
    'x-reloop-timestamp': '1234567890',
    'x-reloop-nonce': 'nonce',
    'x-reloop-signature': 'sig',
    'x-reloop-machine': code,
  }),
});

describe('/api/machine-media/download/[code]/[id] GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when machine not found', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    const res = await GET(makeReq('M1'), makeParams('M1', 'media1'));
    expect(res.status).toBe(404);
  });

  it('returns 401 when signature verification fails', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: false } as any);

    const res = await GET(makeReq('M1'), makeParams('M1', 'media1'));
    expect(res.status).toBe(401);
  });

  it('returns 401 when machine code header mismatches', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);

    // Mismatched header vs route param
    const req = makeReq('M2'); 
    const res = await GET(req, makeParams('M1', 'media1'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when active media not found', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineMedia.findFirst).mockResolvedValue(null);

    const res = await GET(makeReq('M1'), makeParams('M1', 'media1'));
    expect(res.status).toBe(404);
  });

  it('returns file content with headers', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineMedia.findFirst).mockResolvedValue({
      id: 'media1', storagePath: 'video.mp4', mimeType: 'video/mp4', sha256: 'hash123'
    } as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from('fake-video-data'));

    const res = await GET(makeReq('M1'), makeParams('M1', 'media1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(res.headers.get('X-Media-SHA256')).toBe('hash123');
    expect(readFile).toHaveBeenCalledWith('/tmp/media/video.mp4');
  });

  it('returns 404 when readFile throws (handled by catch)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineMedia.findFirst).mockResolvedValue({
      id: 'media1', storagePath: 'missing.mp4', mimeType: 'video/mp4', sha256: 'hash123'
    } as any);
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const res = await GET(makeReq('M1'), makeParams('M1', 'media1'));
    expect(res.status).toBe(404);
  });
});
