import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/redemptions/[id]/proof/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import { mkdir, writeFile, readFile } from 'node:fs/promises';

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redemption: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('@/lib/rbac', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    requireApiUser: vi.fn(),
  };
});

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
}));

const params = { params: Promise.resolve({ id: 'r1' }) };

function jpegFile(bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]), name = 'proof.jpg') {
  return new File([bytes], name, { type: 'image/jpeg' });
}

describe('POST /api/redemptions/[id]/proof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin_1', role: 'SUPERADMIN' } as any);
  });

  it('returns 404 when redemption missing', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue(null);
    const form = new FormData();
    form.append('file', jpegFile());
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(404);
  });

  it('returns 409 when redemption is terminal', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({ id: 'r1', status: 'SUCCESS' } as any);
    const form = new FormData();
    form.append('file', jpegFile());
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(409);
  });

  it('returns 422 when file missing', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({ id: 'r1', status: 'PROCESSING' } as any);
    const form = new FormData();
    form.append('file', 'not-a-file');
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(422);
  });

  it('returns 422 when file empty', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({ id: 'r1', status: 'PROCESSING' } as any);
    const form = new FormData();
    form.append('file', new File([], 'empty.jpg', { type: 'image/jpeg' }));
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(422);
  });

  it('returns 422 when file too large', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({ id: 'r1', status: 'PROCESSING' } as any);
    const form = new FormData();
    form.append('file', new File([new Uint8Array(6 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }));
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(422);
  });

  it('returns 422 when mime not allowed', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({ id: 'r1', status: 'PROCESSING' } as any);
    const form = new FormData();
    form.append('file', new File([new Uint8Array([0x47, 0x49, 0x46])], 'x.gif', { type: 'image/gif' }));
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(422);
  });

  it('returns 422 when signature mismatches mime', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({ id: 'r1', status: 'PROCESSING' } as any);
    const form = new FormData();
    form.append('file', new File([new Uint8Array([0x00, 0x00, 0x00])], 'x.jpg', { type: 'image/jpeg' }));
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(422);
  });

  it('uploads valid JPEG and returns 201', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({ id: 'r1', status: 'PROCESSING' } as any);
    vi.mocked(prisma.redemption.update).mockResolvedValue({ id: 'r1' } as any);
    const form = new FormData();
    form.append('file', jpegFile());
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(201);
    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
    expect(prisma.redemption.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({ manualTransferProofUrl: expect.stringMatching(/^r1\//) }),
      }),
    );
  });
});

describe('GET /api/redemptions/[id]/proof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin_1', role: 'SUPERADMIN' } as any);
  });

  it('returns 404 when proof not uploaded', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({ manualTransferProofUrl: null } as any);
    const res = await GET(new Request('http://localhost'), params);
    expect(res.status).toBe(404);
  });

  it('streams proof bytes with jpeg content type', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      manualTransferProofUrl: 'r1/proof.jpg',
    } as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
    const res = await GET(new Request('http://localhost'), params);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/jpeg');
    expect(res.headers.get('Cache-Control')).toContain('private');
  });

  it('falls back to octet-stream for unknown extension', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      manualTransferProofUrl: 'r1/proof.bin',
    } as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from([0x01]));
    const res = await GET(new Request('http://localhost'), params);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('treats trailing-dot proof path as empty extension', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      manualTransferProofUrl: 'r1/proof.',
    } as any);
    vi.mocked(readFile).mockResolvedValue(Buffer.from([0x01]));
    const res = await GET(new Request('http://localhost'), params);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('returns 404 when read fails', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      manualTransferProofUrl: 'r1/proof.jpg',
    } as any);
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT'));
    const res = await GET(new Request('http://localhost'), params);
    expect(res.status).toBe(404);
  });
});
