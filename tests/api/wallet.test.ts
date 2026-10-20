import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/wallet/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as ledger from '@/lib/ledger';
import * as config from '@/lib/config';

// Mock Prisma
vi.mock('@/lib/prisma', () => ({
  prisma: {
    payoutAccount: {
      findMany: vi.fn(),
    },
    redemption: {
      findMany: vi.fn(),
    },
    travelAgentUser: {
      count: vi.fn(),
    },
    rewardReconciliationCase: {
      findMany: vi.fn(async () => []),
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

vi.mock('@/lib/ledger', () => ({
  getWalletBalance: vi.fn(),
  getLedgerHistory: vi.fn(),
  countLedgerHistory: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getConfigInt: vi.fn(),
  getMinRedemption: vi.fn(),
  CONFIG_KEYS: { POINTS_TO_RUPIAH: 'POINTS_TO_RUPIAH' },
}));

describe('Wallet API - GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1: Menolak request jika tidak terotentikasi (401)', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new rbac.HttpError(401, 'Unauthorized'));

    const res = await GET(new Request("http://localhost/api/wallet"));

    expect(res.status).toBe(401);
  });

  it('T2: Mengembalikan ringkasan dompet pengguna dengan format yang benar', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'user_1', role: 'USER' } as any);
    
    vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 150000, pending: 0, redeemed: 50000, totalEarned: 200000 } as any);
    vi.mocked(ledger.countLedgerHistory).mockResolvedValue(1);
    vi.mocked(ledger.getLedgerHistory).mockResolvedValue([
      { id: 'tx_1', amount: 150000, type: 'EARN' } as any
    ]);
    
    vi.mocked(prisma.payoutAccount.findMany).mockResolvedValue([]);
    vi.mocked(prisma.redemption.findMany).mockResolvedValue([]);
    vi.mocked(prisma.travelAgentUser.count).mockResolvedValue(0); // Bukan agen travel
    
    vi.mocked(config.getMinRedemption).mockResolvedValue(10000);
    vi.mocked(config.getConfigInt).mockResolvedValue(1);

    const res = await GET(new Request("http://localhost/api/wallet"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.balance.available).toBe(150000);
    expect(body.isTravelAgent).toBe(false);
    expect(body.history).toHaveLength(1);
    expect(ledger.getWalletBalance).toHaveBeenCalledWith('user_1');
    expect(body.heldForReview).toBe(0);
    expect(body.withdrawable).toBe(150000);
  });

  it('T3: Memisahkan saldo yang ditahan kasus rekonsiliasi dari saldo yang dapat dicairkan', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'user_1', role: 'USER' } as any);
    vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 150000, pending: 0, redeemed: 0, totalEarned: 150000 } as any);
    vi.mocked(ledger.countLedgerHistory).mockResolvedValue(0);
    vi.mocked(ledger.getLedgerHistory).mockResolvedValue([]);
    vi.mocked(prisma.payoutAccount.findMany).mockResolvedValue([]);
    vi.mocked(prisma.redemption.findMany).mockResolvedValue([]);
    vi.mocked(prisma.travelAgentUser.count).mockResolvedValue(0);
    vi.mocked(prisma.rewardReconciliationCase.findMany).mockResolvedValue([
      { id: 'c1', depositItemId: 'item-1', amount: 20000 },
      { id: 'c2', depositItemId: 'item-1', amount: 20000 },
    ] as any);
    vi.mocked(config.getMinRedemption).mockResolvedValue(10000);
    vi.mocked(config.getConfigInt).mockResolvedValue(1);

    const body = await (await GET(new Request("http://localhost/api/wallet"))).json();

    expect(body.balance.available).toBe(150000);
    expect(body.heldForReview).toBe(20000);
    expect(body.withdrawable).toBe(130000);
  });
});
