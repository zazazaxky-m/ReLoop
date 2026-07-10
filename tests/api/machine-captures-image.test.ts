import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/machine-captures/[id]/image/[asset]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import { readFile } from 'node:fs/promises';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machineCapture: { findUnique: vi.fn() },
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

vi.mock('@/lib/machine-captures', () => ({
  resolveCapturePath: vi.fn((p) => `/tmp/captures/${p}`),
}));

const makeParams = (id: string, asset: string) => ({ params: Promise.resolve({ id, asset }) });

describe('/api/machine-captures/[id]/image/[asset] GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when not SUPERADMIN (handled by catch)', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await GET(new Request('http://localhost'), makeParams('c1', 'scene'));
    expect(res.status).toBe(404); // The catch block always returns 404
  });

  it('returns 404 when capture not found', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machineCapture.findUnique).mockResolvedValue(null);
    const res = await GET(new Request('http://localhost'), makeParams('c1', 'scene'));
    expect(res.status).toBe(404);
  });

  it('returns scene image successfully', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machineCapture.findUnique).mockResolvedValue({
      scenePath: 'scene.jpg', facePathsJson: [],
    } as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from('fake-image-data'));

    const res = await GET(new Request('http://localhost'), makeParams('c1', 'scene'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    const blob = await res.blob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('returns face image successfully (1-indexed)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machineCapture.findUnique).mockResolvedValue({
      scenePath: 'scene.jpg', facePathsJson: ['face1.jpg', 'face2.jpg'],
    } as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from('fake-face-data'));

    const res = await GET(new Request('http://localhost'), makeParams('c1', 'face-2'));
    expect(res.status).toBe(200);
    expect(readFile).toHaveBeenCalledWith('/tmp/captures/face2.jpg');
  });

  it('returns 404 when asset name is invalid', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machineCapture.findUnique).mockResolvedValue({
      scenePath: 'scene.jpg', facePathsJson: ['face1.jpg'],
    } as any);

    const res = await GET(new Request('http://localhost'), makeParams('c1', 'invalid'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when face index is out of bounds', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machineCapture.findUnique).mockResolvedValue({
      scenePath: 'scene.jpg', facePathsJson: ['face1.jpg'],
    } as any);

    const res = await GET(new Request('http://localhost'), makeParams('c1', 'face-5'));
    expect(res.status).toBe(404);
  });

  it('returns 404 when readFile throws', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machineCapture.findUnique).mockResolvedValue({
      scenePath: 'scene.jpg', facePathsJson: [],
    } as any);
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));

    const res = await GET(new Request('http://localhost'), makeParams('c1', 'scene'));
    expect(res.status).toBe(404);
  });

  it('filters non-string face paths before indexing', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machineCapture.findUnique).mockResolvedValue({
      scenePath: 'scene.jpg',
      facePathsJson: [null, 'face-ok.jpg', 42],
    } as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from('face'));

    const res = await GET(new Request('http://localhost'), makeParams('c1', 'face-1'));
    expect(res.status).toBe(200);
    expect(readFile).toHaveBeenCalledWith('/tmp/captures/face-ok.jpg');
  });

  it('treats non-array facePathsJson as empty faces', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.machineCapture.findUnique).mockResolvedValue({
      scenePath: 'scene.jpg',
      facePathsJson: { not: 'an-array' },
    } as any);

    const res = await GET(new Request('http://localhost'), makeParams('c1', 'face-1'));
    expect(res.status).toBe(404);
  });
});
