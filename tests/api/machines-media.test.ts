import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/machines/[id]/media/route';
import { PATCH, DELETE } from '@/app/api/machines/[id]/media/[mediaId]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import { mkdir, writeFile, unlink } from 'node:fs/promises';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machine: { findUnique: vi.fn() },
    machineMedia: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/machine-media', () => ({
  machineMediaStorageRoot: '/tmp/storage',
  resolveMachineMediaPath: vi.fn((path) => `/tmp/storage/${path}`),
  serializeMachineMedia: vi.fn((m) => ({ ...m, url: 'http://test' })),
}));

const makeParams = (id: string, mediaId: string = 'media1') => ({ params: Promise.resolve({ id, mediaId }) });

describe('Machine Media API', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET /api/machines/[id]/media', () => {
    it('returns 403 when not SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await GET(new Request('http://localhost'), makeParams('m1'));
      expect(res.status).toBe(403);
    });

    it('returns 404 when machine not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
      const res = await GET(new Request('http://localhost'), makeParams('m1'));
      expect(res.status).toBe(404);
    });

    it('returns machine media', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1' } as any);
      vi.mocked(prisma.machineMedia.findMany).mockResolvedValue([{ id: 'media1' }] as any);

      const res = await GET(new Request('http://localhost'), makeParams('m1'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.media).toHaveLength(1);
    });
  });

  describe('POST /api/machines/[id]/media', () => {
    it('validates file presence', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', machineCode: 'M1' } as any);
      
      const formData = new FormData();
      const res = await POST(new Request('http://localhost', { method: 'POST', body: formData }), makeParams('m1'));
      expect(res.status).toBe(422);
    });

    it('rejects disallowed mime types', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', machineCode: 'M1' } as any);
      const formData = new FormData();
      formData.append('file', new File([new Uint8Array([0x47, 0x49, 0x46])], 'x.gif', { type: 'image/gif' }));
      const res = await POST(new Request('http://localhost', { method: 'POST', body: formData }), makeParams('m1'));
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toContain('JPG');
    });

    it('uploads valid file successfully', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', machineCode: 'M1' } as any);
      vi.mocked(prisma.machineMedia.aggregate).mockResolvedValue({ _max: { sortOrder: 5 } } as any);
      vi.mocked(prisma.machineMedia.create).mockResolvedValue({ id: 'media1' } as any);
      
      const formData = new FormData();
      // Valid JPEG signature
      const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], 'test.jpg', { type: 'image/jpeg' });
      formData.append('file', file);
      
      const res = await POST(new Request('http://localhost', { method: 'POST', body: formData }), makeParams('m1'));
      expect(res.status).toBe(201);
      expect(mkdir).toHaveBeenCalled();
      expect(writeFile).toHaveBeenCalled();
      expect(prisma.machineMedia.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ sortOrder: 6 }),
      }));
    });

    it('returns 404 when machine missing on upload', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
      const formData = new FormData();
      formData.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff])], 'x.jpg', { type: 'image/jpeg' }));
      const res = await POST(new Request('http://localhost', { method: 'POST', body: formData }), makeParams('m1'));
      expect(res.status).toBe(404);
    });

    it('rejects empty image and oversized video', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', machineCode: 'M1' } as any);

      const empty = new FormData();
      empty.append('file', new File([], 'empty.jpg', { type: 'image/jpeg' }));
      expect((await POST(new Request('http://localhost', { method: 'POST', body: empty }), makeParams('m1'))).status).toBe(422);

      const big = new FormData();
      big.append(
        'file',
        new File([new Uint8Array(150 * 1024 * 1024 + 1)], 'big.mp4', { type: 'video/mp4' }),
      );
      expect((await POST(new Request('http://localhost', { method: 'POST', body: big }), makeParams('m1'))).status).toBe(422);
    });

    it('clamps invalid IMAGE durationSeconds to default 8', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', machineCode: 'M1' } as any);
      vi.mocked(prisma.machineMedia.aggregate).mockResolvedValue({ _max: { sortOrder: null } } as any);
      vi.mocked(prisma.machineMedia.create).mockResolvedValue({ id: 'media1' } as any);

      const formData = new FormData();
      formData.append('file', new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], 'x.jpg', { type: 'image/jpeg' }));
      formData.append('durationSeconds', 'not-a-number');
      formData.append('title', '  ');
      const res = await POST(new Request('http://localhost', { method: 'POST', body: formData }), makeParams('m1'));
      expect(res.status).toBe(201);
      expect(prisma.machineMedia.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ durationSeconds: 8, title: null }),
        }),
      );
    });

    it('accepts PNG signature', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', machineCode: 'M1' } as any);
      vi.mocked(prisma.machineMedia.aggregate).mockResolvedValue({ _max: { sortOrder: null } } as any);
      vi.mocked(prisma.machineMedia.create).mockResolvedValue({ id: 'media2' } as any);

      const formData = new FormData();
      const file = new File(
        [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
        'test.png',
        { type: 'image/png' },
      );
      formData.append('file', file);
      expect((await POST(new Request('http://localhost', { method: 'POST', body: formData }), makeParams('m1'))).status).toBe(201);
    });

    it('accepts WebP signature', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', machineCode: 'M1' } as any);
      vi.mocked(prisma.machineMedia.aggregate).mockResolvedValue({ _max: { sortOrder: 0 } } as any);
      vi.mocked(prisma.machineMedia.create).mockResolvedValue({ id: 'media3' } as any);

      const bytes = new Uint8Array(12);
      bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
      bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
      const formData = new FormData();
      formData.append('file', new File([bytes], 'test.webp', { type: 'image/webp' }));
      expect((await POST(new Request('http://localhost', { method: 'POST', body: formData }), makeParams('m1'))).status).toBe(201);
    });

    it('accepts WebM signature', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', machineCode: 'M1' } as any);
      vi.mocked(prisma.machineMedia.aggregate).mockResolvedValue({ _max: { sortOrder: 0 } } as any);
      vi.mocked(prisma.machineMedia.create).mockResolvedValue({ id: 'media4' } as any);

      const formData = new FormData();
      formData.append(
        'file',
        new File([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00])], 'test.webm', { type: 'video/webm' }),
      );
      expect((await POST(new Request('http://localhost', { method: 'POST', body: formData }), makeParams('m1'))).status).toBe(201);
    });

    it('accepts MP4 ftyp signature', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', machineCode: 'M1' } as any);
      vi.mocked(prisma.machineMedia.aggregate).mockResolvedValue({ _max: { sortOrder: 0 } } as any);
      vi.mocked(prisma.machineMedia.create).mockResolvedValue({ id: 'media5' } as any);

      const bytes = new Uint8Array(12);
      bytes.set([0x66, 0x74, 0x79, 0x70], 4); // ftyp
      const formData = new FormData();
      formData.append('file', new File([bytes], 'test.mp4', { type: 'video/mp4' }));
      expect((await POST(new Request('http://localhost', { method: 'POST', body: formData }), makeParams('m1'))).status).toBe(201);
    });

    it('rejects mismatched file signature', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', machineCode: 'M1' } as any);

      const formData = new FormData();
      formData.append('file', new File([new Uint8Array([0x00, 0x01, 0x02])], 'bad.jpg', { type: 'image/jpeg' }));
      expect((await POST(new Request('http://localhost', { method: 'POST', body: formData }), makeParams('m1'))).status).toBe(422);
    });
  });

  describe('PATCH /api/machines/[id]/media/[mediaId]', () => {
    it('returns 404 when media not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machineMedia.findFirst).mockResolvedValue(null);
      
      const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ active: false }) });
      const res = await PATCH(req, makeParams('m1', 'media1'));
      expect(res.status).toBe(404);
    });

    it('updates media', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machineMedia.findFirst).mockResolvedValue({ id: 'media1', mediaType: 'IMAGE' } as any);
      vi.mocked(prisma.machineMedia.update).mockResolvedValue({ id: 'media1' } as any);
      
      const req = new Request('http://localhost', { method: 'PATCH', body: JSON.stringify({ title: 'New', active: false }) });
      const res = await PATCH(req, makeParams('m1', 'media1'));
      expect(res.status).toBe(200);
    });

    it('clears empty title and ignores durationSeconds for VIDEO', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machineMedia.findFirst).mockResolvedValue({ id: 'media1', mediaType: 'VIDEO' } as any);
      vi.mocked(prisma.machineMedia.update).mockResolvedValue({ id: 'media1' } as any);

      const res = await PATCH(
        new Request('http://localhost', {
          method: 'PATCH',
          body: JSON.stringify({ title: '', durationSeconds: 12, active: true }),
        }),
        makeParams('m1', 'media1'),
      );
      expect(res.status).toBe(200);
      expect(prisma.machineMedia.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: null,
            durationSeconds: undefined,
            active: true,
          }),
        }),
      );
    });
  });

  describe('DELETE /api/machines/[id]/media/[mediaId]', () => {
    it('returns 404 when media not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machineMedia.findFirst).mockResolvedValue(null);
      const res = await DELETE(new Request('http://localhost'), makeParams('m1', 'media1'));
      expect(res.status).toBe(404);
    });

    it('deletes media and file', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machineMedia.findFirst).mockResolvedValue({ id: 'media1', storagePath: 'test.jpg' } as any);
      vi.mocked(prisma.machineMedia.delete).mockResolvedValue({} as any);
      
      const res = await DELETE(new Request('http://localhost'), makeParams('m1', 'media1'));
      expect(res.status).toBe(200);
      expect(prisma.machineMedia.delete).toHaveBeenCalled();
      expect(unlink).toHaveBeenCalled();
    });

    it('still succeeds when unlink fails', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machineMedia.findFirst).mockResolvedValue({
        id: 'media1',
        storagePath: 'missing.jpg',
        originalName: 'missing.jpg',
      } as any);
      vi.mocked(prisma.machineMedia.delete).mockResolvedValue({} as any);
      vi.mocked(unlink).mockRejectedValueOnce(new Error('ENOENT'));

      const res = await DELETE(new Request('http://localhost'), makeParams('m1', 'media1'));
      expect(res.status).toBe(200);
    });
  });
});
