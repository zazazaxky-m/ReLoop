import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/uploads/hero/route';
import * as rbac from '@/lib/rbac';
import { mkdir, writeFile } from 'fs/promises';

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

describe('/api/uploads/hero POST', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const req = new Request('http://localhost', { method: 'POST' });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 422 when missing image file', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    const formData = new FormData();
    formData.append('image', 'not a file string');
    
    const req = new Request('http://localhost', { method: 'POST', body: formData });
    const res = await POST(req);
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('wajib dipilih');
  });

  it('returns 422 when file size is 0', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    const formData = new FormData();
    const file = new File([], 'test.jpg', { type: 'image/jpeg' });
    formData.append('image', file);
    
    const req = new Request('http://localhost', { method: 'POST', body: formData });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it('returns 422 when file size exceeds 6MB', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    const formData = new FormData();
    const bigArray = new Uint8Array(6 * 1024 * 1024 + 1);
    const file = new File([bigArray], 'test.jpg', { type: 'image/jpeg' });
    formData.append('image', file);
    
    const req = new Request('http://localhost', { method: 'POST', body: formData });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it('returns 422 when file type is not allowed', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    const formData = new FormData();
    const file = new File(['GIF89a'], 'test.gif', { type: 'image/gif' });
    formData.append('image', file);
    
    const req = new Request('http://localhost', { method: 'POST', body: formData });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it('returns 422 when file signature does not match mimetype (JPEG)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    const formData = new FormData();
    const file = new File([new Uint8Array([0x00, 0x00, 0x00])], 'test.jpg', { type: 'image/jpeg' });
    formData.append('image', file);
    
    const req = new Request('http://localhost', { method: 'POST', body: formData });
    const res = await POST(req);
    expect(res.status).toBe(422);
  });

  it('uploads valid JPEG file successfully', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    const formData = new FormData();
    // Valid JPEG signature: 0xFF 0xD8 0xFF
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x00])], 'test.jpg', { type: 'image/jpeg' });
    formData.append('image', file);
    
    const req = new Request('http://localhost', { method: 'POST', body: formData });
    const res = await POST(req);
    
    expect(res.status).toBe(201);
    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalled();
    const data = await res.json();
    expect(data.url).toMatch(/^\/uploads\/hero\/[0-9]+-[a-f0-9-]+\.jpg$/);
  });

  it('uploads valid PNG file successfully', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    const formData = new FormData();
    // Valid PNG signature
    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'test.png', { type: 'image/png' });
    formData.append('image', file);
    
    const req = new Request('http://localhost', { method: 'POST', body: formData });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });

  it('uploads valid WebP file successfully', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    const formData = new FormData();
    // Valid WebP signature RIFF...WEBP
    const bytes = new Uint8Array(12);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    bytes.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    const file = new File([bytes], 'test.webp', { type: 'image/webp' });
    formData.append('image', file);
    
    const req = new Request('http://localhost', { method: 'POST', body: formData });
    const res = await POST(req);
    expect(res.status).toBe(201);
  });
});
