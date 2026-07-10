import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/payout-accounts/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    payoutAccount: {
      findMany: vi.fn(),
      create: vi.fn(),
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

describe('Payout Accounts API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('T1: Mengembalikan akun yang tidak disabled', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'user_1', role: 'USER' } as any);
      vi.mocked(prisma.payoutAccount.findMany).mockResolvedValue([
        { id: 'acc_1', provider: 'GOPAY' } as any
      ]);

      const res = await GET();
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.accounts).toHaveLength(1);
      
      expect(prisma.payoutAccount.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user_1',
            status: { not: 'DISABLED' }
          })
        })
      );
    });

    it('returns handled error on GET failure', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('get boom'));
      expect((await GET()).status).toBe(500);
    });
  });

  describe('POST', () => {
    it('T2: Berhasil membuat akun pencairan baru', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'user_1', role: 'USER' } as any);
      vi.mocked(prisma.payoutAccount.create).mockResolvedValue({
        id: 'acc_1', provider: 'GOPAY', accountIdentifier: '08123456'
      } as any);

      const req = new Request('http://localhost/api/payout-accounts', {
        method: 'POST',
        body: JSON.stringify({ provider: 'GOPAY', accountIdentifier: '08123456' }),
      });

      const res = await POST(req);
      const body = await res.json();

      expect(res.status).toBe(201); // 201 Created
      expect(body.account.provider).toBe('GOPAY');
    });

    it('T3: Gagal jika data tidak lengkap (Validasi Zod)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'user_1', role: 'USER' } as any);
      
      const req = new Request('http://localhost/api/payout-accounts', {
        method: 'POST',
        body: JSON.stringify({ provider: 'INVALID_PROVIDER', accountIdentifier: '' }),
      });

      const res = await POST(req);
      expect(res.status).toBe(422); // Bad Request karena Zod error
    });
  });
});
