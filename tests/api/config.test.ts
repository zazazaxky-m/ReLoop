import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, PATCH } from '@/app/api/config/route';
import * as rbac from '@/lib/rbac';
import * as config from '@/lib/config';
import * as audit from '@/lib/audit';

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/config', () => ({
  CONFIG_KEYS: {
    MIN_REDEMPTION: 'min_redemption',
    POINTS_TO_RUPIAH: 'points_to_rupiah',
  },
  getAllConfig: vi.fn(),
  setConfig: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

describe('/api/config endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('requires SUPERADMIN role (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await GET();
      expect(res.status).toBe(403);
    });

    it('returns all config (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
      vi.mocked(config.getAllConfig).mockResolvedValue({ min_redemption: '1000' });
      
      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.config.min_redemption).toBe('1000');
    });
  });

  describe('PATCH', () => {
    const makePatchReq = (body: any) => new Request('http://localhost/api/config', {
      method: 'PATCH',
      body: JSON.stringify(body),
    });

    it('requires SUPERADMIN role (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await PATCH(makePatchReq({}));
      expect(res.status).toBe(403);
    });

    it('fails on validation error (422)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
      const res = await PATCH(makePatchReq({ min_redemption: -100 })); // Below min
      expect(res.status).toBe(422);
    });

    it('updates config successfully (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
      vi.mocked(config.getAllConfig).mockResolvedValue({ min_redemption: '5000' });
      
      const req = makePatchReq({ min_redemption: 5000 });
      const res = await PATCH(req);
      
      expect(res.status).toBe(200);
      expect(config.setConfig).toHaveBeenCalledWith('min_redemption', '5000');
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'CONFIG_UPDATE' }));
      
      const data = await res.json();
      expect(data.updated.min_redemption).toBe('5000');
    });
  });
});
