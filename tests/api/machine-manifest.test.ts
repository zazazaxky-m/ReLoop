import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/machine-media/manifest/[code]/route';
import { prisma } from '@/lib/prisma';
import * as machineAuth from '@/lib/machine-auth';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machine: { findUnique: vi.fn() },
    machineMedia: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/machine-auth', () => ({
  verifyMachineRequest: vi.fn(),
}));

const makeParams = (code: string) => ({ params: Promise.resolve({ code }) });
const makeReq = (code: string) => new Request('http://localhost', {
  headers: new Headers({
    'x-reloop-timestamp': '1234567890',
    'x-reloop-nonce': 'nonce',
    'x-reloop-signature': 'sig',
    'x-reloop-machine': code,
  }),
});

describe('/api/machine-media/manifest/[code] GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when machine not found', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    const res = await GET(makeReq('M1'), makeParams('M1'));
    expect(res.status).toBe(404);
  });

  it('returns 401 when signature verification fails', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: false, reason: 'INVALID_SIGNATURE' } as any);

    const res = await GET(makeReq('M1'), makeParams('M1'));
    expect(res.status).toBe(401);
  });

  it('returns 401 when machine code header mismatches', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);

    const req = makeReq('M2'); 
    const res = await GET(req, makeParams('M1'));
    expect(res.status).toBe(401);
  });

  it('returns manifest with version hash and mapped items', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    
    const mockMedia = [
      { id: 'media1', active: true, sha256: 'hash1', durationSeconds: 10, sortOrder: 1, updatedAt: new Date('2023-01-01'), title: 'Title1', mediaType: 'VIDEO', mimeType: 'video/mp4', fileSize: 1024 },
      { id: 'media2', active: false, sha256: 'hash2', durationSeconds: 5, sortOrder: 2, updatedAt: new Date('2023-01-02'), title: 'Title2', mediaType: 'IMAGE', mimeType: 'image/jpeg', fileSize: 512 },
    ];
    vi.mocked(prisma.machineMedia.findMany).mockResolvedValue(mockMedia as any);

    const res = await GET(makeReq('M1'), makeParams('M1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.enabled).toBe(true);
    expect(data.version).toBeTruthy(); // Should be a hash string
    expect(data.items).toHaveLength(1); // Only active media
    expect(data.items[0].id).toBe('media1');
    expect(data.items[0].downloadPath).toBe('/api/machine-media/download/M1/media1');
    
    expect(data.assets).toHaveLength(2); // All media
    expect(data.assets[1].id).toBe('media2');
  });

  it('returns enabled false if no active media', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(machineAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineMedia.findMany).mockResolvedValue([]);

    const res = await GET(makeReq('M1'), makeParams('M1'));
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.enabled).toBe(false);
    expect(data.items).toHaveLength(0);
    expect(data.assets).toHaveLength(0);
  });
});
