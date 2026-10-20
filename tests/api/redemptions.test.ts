import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/redemptions/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as walletService from '@/lib/wallet-service';
import { encrypt } from '@/lib/encryption';

// Mematikan audit logging agar tidak error
vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

// Mock Prisma (GET reads it directly; POST goes through lib/wallet-service)
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redemption: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    payoutAccount: {
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/rbac', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    requireApiUser: vi.fn(),
  };
});

// Keep the real request schema; the transaction itself is covered by
// tests/lib/wallet-service.test.ts and tests/integration/redemption-race.test.ts.
vi.mock('@/lib/wallet-service', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    requestRedemption: vi.fn(),
  };
});

const post = (body: unknown) =>
  POST(new Request('http://localhost/api/redemptions', { method: 'POST', body: JSON.stringify(body) }));

const storedRedemption = (overrides: Record<string, unknown> = {}) => ({
  id: 'r_new',
  userId: 'user_1',
  amount: 50000,
  payoutAccountId: 'acc_1',
  provider: 'DANA',
  status: 'REQUESTED',
  idempotencyKey: 'client-key-1',
  requestHash: 'a'.repeat(64),
  ...overrides,
});

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
    vi.mocked(prisma.redemption.count).mockResolvedValue(1);
    vi.mocked(prisma.redemption.findMany).mockResolvedValue([
      {
        id: 'r1', userId: 'user_1', amount: 50000, payoutAccountId: 'acc_1', requestHash: 'h'.repeat(64),
        payoutDestinationSource: 'REQUEST_SNAPSHOT', payoutDestinationProvider: 'DANA',
        payoutDestinationIdentifier: encrypt('081234567890'), payoutDestinationName: encrypt('Nama Saat Pengajuan'),
        payoutDestinationCapturedAt: new Date('2026-10-13T00:00:00Z'),
      } as any,
    ]);
    vi.mocked(prisma.payoutAccount.findMany).mockResolvedValue([
      { id: 'acc_1', userId: 'user_1', provider: 'DANA', accountIdentifier: '081234567890', accountName: 'Nama Baru' } as any,
    ]);

    const req = new Request('http://localhost/api/redemptions');
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.redemptions).toHaveLength(1);
    expect(prisma.redemption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: 'user_1' }) })
    );
    // Internal idempotency hash and destination ciphertext never leave the server.
    const [row] = body.redemptions;
    expect(row).not.toHaveProperty('requestHash');
    expect(row).not.toHaveProperty('payoutDestinationIdentifier');
    expect(row).not.toHaveProperty('payoutDestinationName');
    // The destination is the request-time snapshot, not the renamed account.
    expect(row.payoutDestination).toEqual({
      source: 'REQUEST_SNAPSHOT', provider: 'DANA', accountIdentifier: '081234567890',
      accountName: 'Nama Saat Pengajuan', capturedAt: '2026-10-13T00:00:00.000Z', erased: false,
    });
  });

  it('shows a destination erased on a data deletion request as erased, not as unavailable', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin_1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.redemption.count).mockResolvedValue(1);
    vi.mocked(prisma.redemption.findMany).mockResolvedValue([
      {
        id: 'r_erased', userId: 'user_1', amount: 50000, status: 'SUCCESS', payoutAccountId: 'acc_1',
        payoutDestinationSource: 'REQUEST_SNAPSHOT', payoutDestinationProvider: 'DANA',
        payoutDestinationIdentifier: null, payoutDestinationName: null,
        payoutDestinationCapturedAt: new Date('2026-10-13T00:00:00Z'),
      } as any,
    ]);
    vi.mocked(prisma.payoutAccount.findMany).mockResolvedValue([]);

    const body = await (await GET(new Request('http://localhost/api/redemptions'))).json();
    expect(body.redemptions[0].payoutDestination).toEqual({
      source: 'REQUEST_SNAPSHOT', provider: 'DANA', accountIdentifier: null, accountName: null,
      capturedAt: '2026-10-13T00:00:00.000Z', erased: true,
    });
  });

  it('shows a legacy request without snapshot with the current account, flagged as legacy', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin_1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.redemption.count).mockResolvedValue(2);
    vi.mocked(prisma.redemption.findMany).mockResolvedValue([
      { id: 'r_legacy', userId: 'user_1', amount: 50000, payoutAccountId: 'acc_1', payoutDestinationSource: null } as any,
      { id: 'r_foreign', userId: 'user_2', amount: 50000, payoutAccountId: 'acc_1', payoutDestinationSource: null } as any,
    ]);
    vi.mocked(prisma.payoutAccount.findMany).mockResolvedValue([
      { id: 'acc_1', userId: 'user_1', provider: 'OVO', accountIdentifier: '0811', accountName: 'Pemilik' } as any,
    ]);

    const body = await (await GET(new Request('http://localhost/api/redemptions'))).json();
    expect(body.redemptions[0].payoutDestination).toEqual({
      source: 'LEGACY_ACCOUNT_FALLBACK', provider: 'OVO', accountIdentifier: '0811', accountName: 'Pemilik', capturedAt: null,
      erased: false,
    });
    // Never borrow another user's account as a legacy destination.
    expect(body.redemptions[1].payoutDestination).toEqual({
      source: 'LEGACY_UNAVAILABLE', provider: null, accountIdentifier: null, accountName: null, capturedAt: null,
      erased: false,
    });
  });

  it('T3: Role SUPERADMIN dapat melihat semua riwayat tanpa batasan userId', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin_1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.redemption.count).mockResolvedValue(2);
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

  it('attaches payout accounts when redemptions have payoutAccountId', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin_1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.redemption.count).mockResolvedValue(1);
    vi.mocked(prisma.redemption.findMany).mockResolvedValue([
      {
        id: 'r1',
        userId: 'user_1',
        payoutAccountId: 'acc_1',
        amount: 50000,
        user: { id: 'user_1', name: 'A', email: 'a@x.com' },
      } as any,
    ]);
    vi.mocked(prisma.payoutAccount.findMany).mockResolvedValue([
      { id: 'acc_1', provider: 'BCA' } as any,
    ]);

    const res = await GET(new Request('http://localhost/api/redemptions?queue=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redemptions[0].payoutAccount).toEqual(
      expect.objectContaining({ id: 'acc_1' }),
    );
    expect(prisma.payoutAccount.findMany).toHaveBeenCalled();
  });

  it('filters by status query param', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin_1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.redemption.count).mockResolvedValue(0);
    vi.mocked(prisma.redemption.findMany).mockResolvedValue([]);
    vi.mocked(prisma.payoutAccount.findMany).mockResolvedValue([]);

    const res = await GET(new Request('http://localhost/api/redemptions?status=REQUESTED'));
    expect(res.status).toBe(200);
    expect(prisma.redemption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'REQUESTED' } }),
    );
  });

  it('returns null payoutAccount when account id is missing from lookup', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin_1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.redemption.count).mockResolvedValue(1);
    vi.mocked(prisma.redemption.findMany).mockResolvedValue([
      {
        id: 'r1',
        userId: 'user_1',
        payoutAccountId: 'acc_missing',
        amount: 50000,
        user: { id: 'user_1', name: 'A', email: 'a@x.com' },
      } as any,
    ]);
    vi.mocked(prisma.payoutAccount.findMany).mockResolvedValue([]);

    const res = await GET(new Request('http://localhost/api/redemptions'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redemptions[0].payoutAccount).toBeNull();
  });
});

describe('Redemptions API - POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'user_1', role: 'USER' } as any);
  });

  it('T1: ditolak tanpa sesi (401) sebelum memproses body', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new rbac.HttpError(401, 'Tidak terautentikasi'));
    const res = await post({ amount: 50000, payoutAccountId: 'acc_1' });
    expect(res.status).toBe(401);
    expect(walletService.requestRedemption).not.toHaveBeenCalled();
  });

  it.each([
    ['pecahan', 10000.5],
    ['negatif', -10000],
    ['nol', 0],
    ['melebihi integer database', 2_147_483_648],
    ['di luar safe integer', Number.MAX_SAFE_INTEGER + 2],
    ['string', '10000'],
  ])('menolak amount %s (422) sebelum menyentuh database', async (_label, amount) => {
    const res = await post({ amount, payoutAccountId: 'acc_1', idempotencyKey: 'client-key-1' });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe('Validasi gagal');
    expect(body.issues.map((i: { path: string }) => i.path)).toContain('amount');
    expect(walletService.requestRedemption).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('menolak idempotencyKey yang tidak valid (422)', async () => {
    for (const idempotencyKey of ['', 'a'.repeat(81), 'ada spasi', 42]) {
      const res = await post({ amount: 50000, payoutAccountId: 'acc_1', idempotencyKey });
      expect(res.status).toBe(422);
    }
    expect(walletService.requestRedemption).not.toHaveBeenCalled();
  });

  it('T6: meneruskan key klien ke service dan mengembalikan 201 tanpa requestHash', async () => {
    vi.mocked(walletService.requestRedemption).mockResolvedValue({
      redemption: storedRedemption() as any,
      idempotent: false,
    });

    const res = await post({ amount: 50000, payoutAccountId: 'acc_1', idempotencyKey: 'client-key-1' });
    expect(res.status).toBe(201);
    expect(walletService.requestRedemption).toHaveBeenCalledWith(
      { id: 'user_1', role: 'USER' },
      { amount: 50000, payoutAccountId: 'acc_1', idempotencyKey: 'client-key-1' },
    );
    const body = await res.json();
    expect(body).toMatchObject({ idempotent: false, idempotencyKey: 'client-key-1', redemption: { id: 'r_new' } });
    expect(body.redemption).not.toHaveProperty('requestHash');
  });

  it('membuat idempotencyKey untuk klien lama dan mengembalikannya', async () => {
    vi.mocked(walletService.requestRedemption).mockImplementation(async (_actor, input) => ({
      redemption: storedRedemption({ idempotencyKey: input.idempotencyKey }) as any,
      idempotent: false,
    }));

    const res = await post({ amount: 50000, payoutAccountId: 'acc_1' });
    expect(res.status).toBe(201);
    const generated = vi.mocked(walletService.requestRedemption).mock.calls[0][1].idempotencyKey;
    expect(generated).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect((await res.json()).idempotencyKey).toBe(generated);
  });

  it('mengembalikan request lama (200, idempotent) untuk key yang sama', async () => {
    vi.mocked(walletService.requestRedemption).mockResolvedValue({
      redemption: storedRedemption({ id: 'r_existing' }) as any,
      idempotent: true,
    });

    const res = await post({ amount: 50000, payoutAccountId: 'acc_1', idempotencyKey: 'client-key-1' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
    expect(body.redemption.id).toBe('r_existing');
  });

  it.each([
    [422, 'Minimum pencairan Rp10.000'],
    [422, 'Saldo tersedia tidak mencukupi'],
    [404, 'Akun pencairan tidak ditemukan'],
    [409, 'Akun pencairan dinonaktifkan'],
    [409, walletService.REDEMPTION_KEY_CONFLICT],
    [503, 'Sistem sedang sibuk. Silakan coba lagi.'],
  ])('meneruskan keputusan service %i: %s', async (status, message) => {
    vi.mocked(walletService.requestRedemption).mockRejectedValue(new rbac.HttpError(status, message));
    const res = await post({ amount: 50000, payoutAccountId: 'acc_1', idempotencyKey: 'client-key-1' });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error: message });
  });

  it('handles unexpected POST errors via handleApiError', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(walletService.requestRedemption).mockRejectedValue(new Error('db down'));

    const res = await post({ amount: 50000, payoutAccountId: 'acc_1' });

    expect(res.status).toBe(500);
    consoleError.mockRestore();
  });
});
