import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/machine-media/[id]/content/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import { readFile } from 'node:fs/promises';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machineMedia: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

vi.mock('@/lib/machine-media', () => ({
  resolveMachineMediaPath: vi.fn((p) => `/tmp/media/${p}`),
}));

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe('/api/machine-media/[id]/content GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when not SUPERADMIN (handled by catch)', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await GET(new Request('http://localhost'), makeParams('m1'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when media not found', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machineMedia.findUnique).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), makeParams('m1'));
    expect(res.status).toBe(404);
  });

  it('returns file content with headers', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machineMedia.findUnique).mockResolvedValue({
      storagePath: 'video.mp4', mimeType: 'video/mp4',
    } as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from('fake-video-data'));

    const res = await GET(new Request('http://localhost'), makeParams('m1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp4');
    expect(readFile).toHaveBeenCalledWith('/tmp/media/video.mp4');
  });

  it('returns 404 when file read fails', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machineMedia.findUnique).mockResolvedValue({
      storagePath: 'missing.mp4', mimeType: 'video/mp4',
    } as any);
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const res = await GET(new Request('http://localhost'), makeParams('m1'));
    expect(res.status).toBe(404);
  });
});
