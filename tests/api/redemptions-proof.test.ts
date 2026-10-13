import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/redemptions/[id]/proof/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { HttpError } from '@/lib/rbac';
import { attachRedemptionProof } from '@/lib/wallet-service';

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

// The locked attach (owner + status recheck, CAS) is the wallet service's job;
// tests/integration/payout-transitions.test.ts proves it on real PostgreSQL.
vi.mock('@/lib/wallet-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/wallet-service')>()),
  attachRedemptionProof: vi.fn(),
}));

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
  unlink: vi.fn(),
}));

const params = { params: Promise.resolve({ id: 'r1' }) };

function jpegFile(bytes = new Uint8Array([0xff, 0xd8, 0xff, 0x00]), name = 'proof.jpg') {
  return new File([bytes], name, { type: 'image/jpeg' });
}

describe('POST /api/redemptions/[id]/proof', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin_1', role: 'SUPERADMIN' } as any);
    vi.mocked(unlink).mockResolvedValue(undefined);
  });

  it('returns 404 when redemption missing', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue(null);
    const form = new FormData();
    form.append('file', jpegFile());
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(404);
  });

  it('returns 409 when redemption is terminal, before storing anything', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({ userId: 'u1', status: 'SUCCESS' } as any);
    const form = new FormData();
    form.append('file', jpegFile());
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(409);
    expect(writeFile).not.toHaveBeenCalled();
    expect(attachRedemptionProof).not.toHaveBeenCalled();
  });

  it('refuses every role but SUPERADMIN before reading the request (403)', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new HttpError(403, 'Akses ditolak untuk peran ini'));
    const form = new FormData();
    form.append('file', jpegFile());
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(403);
    expect(rbac.requireApiUser).toHaveBeenCalledWith(['SUPERADMIN']);
    expect(prisma.redemption.findUnique).not.toHaveBeenCalled();
    expect(attachRedemptionProof).not.toHaveBeenCalled();
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

  it('stores a valid JPEG under the request id and attaches it for the owner it was uploaded for (201)', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({ userId: 'u1', status: 'PROCESSING' } as any);
    vi.mocked(attachRedemptionProof).mockResolvedValue({ redemption: { id: 'r1' } } as any);
    const form = new FormData();
    form.append('file', jpegFile());
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(201);
    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
    expect(attachRedemptionProof).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'admin_1', role: 'SUPERADMIN' }),
      'r1',
      expect.objectContaining({ expectedUserId: 'u1', relativePath: expect.stringMatching(/^r1\//), mime: 'image/jpeg' }),
    );
    expect(prisma.redemption.update).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('deletes the stored file when the locked attach refuses it', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({ userId: 'u1', status: 'PROCESSING' } as any);
    vi.mocked(attachRedemptionProof).mockRejectedValue(
      new HttpError(409, 'Data pemilik pencairan berubah. Muat ulang lalu coba lagi.'));
    const form = new FormData();
    form.append('file', jpegFile());
    const res = await POST(new Request('http://localhost', { method: 'POST', body: form }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Data pemilik pencairan berubah. Muat ulang lalu coba lagi.' });
    expect(unlink).toHaveBeenCalledWith(vi.mocked(writeFile).mock.calls[0][0]);
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
