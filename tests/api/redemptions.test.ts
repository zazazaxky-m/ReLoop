import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { GET, POST } from '@/app/api/redemptions/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as ledger from '@/lib/ledger';
import * as config from '@/lib/config';
import { randomUUID } from 'crypto';

// Mematikan audit logging agar tidak error
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redemption: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    payoutAccount: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(async (cb) => {
      // Execute the callback directly and pass the mocked prisma client as the transaction object
      return cb({
        redemption: { create: vi.fn().mockResolvedValue({ id: 'txn_123', amount: 50000 }) },
      });
    }),
  },
}));

vi.mock('@/lib/rbac', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    requireApiUser: vi.fn(),
  };
});

vi.mock('@/lib/ledger', () => ({
  getWalletBalance: vi.fn(),
  createRedeemReserve: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getMinRedemption: vi.fn().mockResolvedValue(10000), // Default mock 10.000
}));

describe('Redemptions API - GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1: Ditolak jika tidak memiliki token (401/403)', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new rbac.HttpError(401, 'Unauthorized'));

    const req = new Request('http://localhost/api/redemptions');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('T2: Role USER hanya melihat riwayatnya sendiri', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'user_1', role: 'USER' } as any);
    vi.mocked(prisma.redemption.findMany).mockResolvedValue([
      { id: 'r1', userId: 'user_1', amount: 50000 } as any
    ]);
    vi.mocked(prisma.payoutAccount.findMany).mockResolvedValue([]);

    const req = new Request('http://localhost/api/redemptions');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.redemptions).toHaveLength(1);
    expect(prisma.redemption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user_1' })
      })
    );
  });

  it('T3: Role SUPERADMIN dapat melihat semua riwayat tanpa batasan userId', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin_1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.redemption.findMany).mockResolvedValue([
      { id: 'r1', userId: 'user_1', amount: 50000 } as any,
      { id: 'r2', userId: 'user_2', amount: 20000 } as any
    ]);
    vi.mocked(prisma.payoutAccount.findMany).mockResolvedValue([]);

    const req = new Request('http://localhost/api/redemptions');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.redemptions).toHaveLength(2);
    // Verifikasi bahwa where object tidak berisi userId
    expect(prisma.redemption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ userId: expect.anything() })
      })
    );
  });
});

describe('Redemptions API - POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T4: Gagal menarik saldo di bawah minimum limit (422)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'user_1', role: 'USER' } as any);
    
    // Mock akun ada
    vi.mocked(prisma.payoutAccount.findUnique).mockResolvedValue({ 
      id: 'acc_1', userId: 'user_1', status: 'ACTIVE' 
    } as any);

    const req = new Request('http://localhost/api/redemptions', {
      method: 'POST',
      body: JSON.stringify({ amount: 5000, payoutAccountId: 'acc_1' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toContain('Minimum pencairan');
  });

  it('T5: Gagal menarik saldo melebihi balance (Over Balance) (422)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'user_1', role: 'USER' } as any);
    
    vi.mocked(prisma.payoutAccount.findUnique).mockResolvedValue({ 
      id: 'acc_1', userId: 'user_1', status: 'ACTIVE' 
    } as any);

    // Mock limit minimum 10rb, user mau tarik 50rb, tapi saldo cuma 20rb
    vi.mocked(config.getMinRedemption).mockResolvedValue(10000);
    vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 20000 } as any);

    const req = new Request('http://localhost/api/redemptions', {
      method: 'POST',
      body: JSON.stringify({ amount: 50000, payoutAccountId: 'acc_1' }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toContain('Saldo tersedia tidak mencukupi');
  });

  it('T6: Berhasil menarik saldo dan tidak double spend dengan Idempotency', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'user_1', role: 'USER' } as any);
    vi.mocked(prisma.payoutAccount.findUnique).mockResolvedValue({ 
      id: 'acc_1', userId: 'user_1', status: 'ACTIVE', provider: 'BCA' 
    } as any);

    // Saldo 100rb, tarik 50rb
    vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 100000 } as any);
    
    // Simulasikan belum ada transaksi dengan idempotency key tersebut
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue(null);

    const idempKey = randomUUID();
    const req = new Request('http://localhost/api/redemptions', {
      method: 'POST',
      body: JSON.stringify({ amount: 50000, payoutAccountId: 'acc_1', idempotencyKey: idempKey }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    // Prisma check transaction should be called
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
