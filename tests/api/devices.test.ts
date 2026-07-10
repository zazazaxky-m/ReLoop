import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST as RegisterPOST } from '@/app/api/devices/register/route';
import { POST as UnregisterPOST } from '@/app/api/devices/unregister/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    deviceToken: { upsert: vi.fn(), deleteMany: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

const makeReq = (body: any) =>
  new Request('http://localhost/api/devices/register', {
    method: 'POST',
    body: JSON.stringify(body),
  });

describe('Device Token API', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('POST /api/devices/register', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(401, 'Unauthorized'));
      const res = await RegisterPOST(makeReq({ token: 'abcdef1234', platform: 'android' }));
      expect(res.status).toBe(401);
    });

    it('registers device token successfully', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.deviceToken.upsert).mockResolvedValue({} as any);

      const res = await RegisterPOST(makeReq({ token: 'abcdef1234', platform: 'android' }));
      expect(res.status).toBe(200);
      expect(prisma.deviceToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token: 'abcdef1234' },
          update: { userId: 'u1', platform: 'android' },
        }),
      );
    });

    it('returns 422 for invalid platform', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      const res = await RegisterPOST(makeReq({ token: 'abcdef1234', platform: 'windows' }));
      expect(res.status).toBe(422);
    });

    it('returns 422 for token too short', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      const res = await RegisterPOST(makeReq({ token: 'short', platform: 'ios' }));
      expect(res.status).toBe(422);
    });
  });

  describe('POST /api/devices/unregister', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(401, 'Unauthorized'));
      const res = await UnregisterPOST(makeReq({ token: 'abcdef1234' }));
      expect(res.status).toBe(401);
    });

    it('unregisters device token successfully', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.deviceToken.deleteMany).mockResolvedValue({ count: 1 } as any);

      const res = await UnregisterPOST(makeReq({ token: 'abcdef1234' }));
      expect(res.status).toBe(200);
      expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { token: 'abcdef1234', userId: 'u1' },
        }),
      );
    });

    it('returns 422 for invalid token', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      const res = await UnregisterPOST(makeReq({ token: 'short' }));
      expect(res.status).toBe(422);
    });
  });
});
