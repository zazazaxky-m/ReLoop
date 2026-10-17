import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { HttpError, type CurrentUser } from '@/lib/rbac';
import { decrypt, isEncrypted } from '@/lib/encryption';
import {
  REDEMPTION_KEY_CONFLICT,
  redemptionRequestHash,
  requestRedemption,
} from '@/lib/wallet-service';

// Unit-level contract of the wallet transaction (call order, tx usage, error
// mapping). Real concurrency is proven in tests/integration/redemption-race.test.ts.

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    redemption: { findUnique: vi.fn() },
    rewardLedger: { groupBy: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

const actor = { id: 'user_1', role: 'USER' } as CurrentUser;
const input = { amount: 50_000, payoutAccountId: 'acc_1', idempotencyKey: 'client-key-1' };

interface FakeState {
  userRows: { id: string }[];
  ownedAccountRows: { id: string }[];
  account: { id: string; userId: string; status: string; provider: string; accountIdentifier?: string; accountName?: string | null } | null;
  existing: Record<string, unknown> | null;
  ledger: { entryType: string; status: string; _sum: { amount: number } }[];
  openCases?: { id: string; depositItemId: string | null; amount: number }[];
  minRedemption: string | null;
}

function fakeTx(state: FakeState) {
  const calls: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async (strings: TemplateStringsArray) => {
      calls.push(`exec:${strings.join('?').trim()}`);
      return 0;
    }),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM "User"')) {
        calls.push('lock:User');
        return state.userRows;
      }
      if (sql.includes('FROM "PayoutAccount"')) {
        calls.push('lock:PayoutAccount');
        return state.ownedAccountRows;
      }
      throw new Error(`unexpected raw query ${sql}`);
    }),
    redemption: {
      findUnique: vi.fn(async () => {
        calls.push('read:idempotency');
        return state.existing;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        calls.push('write:Redemption');
        return { id: 'r_new', ...data };
      }),
    },
    payoutAccount: {
      findUnique: vi.fn(async () => {
        calls.push('read:PayoutAccount');
        return state.account;
      }),
    },
    systemConfig: {
      findUnique: vi.fn(async () => {
        calls.push('read:min_redemption');
        return state.minRedemption === null ? null : { value: state.minRedemption };
      }),
    },
    rewardReconciliationCase: {
      findMany: vi.fn(async () => {
        calls.push('read:openCases');
        return state.openCases ?? [];
      }),
    },
    rewardLedger: {
      groupBy: vi.fn(async () => {
        calls.push('read:balance');
        return state.ledger;
      }),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        calls.push('write:RewardLedger');
        return { id: 'l_new', ...data };
      }),
    },
  };
  return { tx, calls };
}

function defaults(overrides: Partial<FakeState> = {}): FakeState {
  return {
    userRows: [{ id: 'user_1' }],
    ownedAccountRows: [{ id: 'acc_1' }],
    account: { id: 'acc_1', userId: 'user_1', status: 'VERIFIED', provider: 'DANA', accountIdentifier: '081234567890', accountName: 'Pengguna Satu' },
    existing: null,
    ledger: [{ entryType: 'EARN', status: 'AVAILABLE', _sum: { amount: 80_000 } }],
    minRedemption: null,
    ...overrides,
  };
}

function useTransaction(state: FakeState) {
  const fake = fakeTx(state);
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (tx: unknown) => unknown) => fn(fake.tx)) as any);
  return fake;
}

describe('requestRedemption', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(logAudit).mockResolvedValue(undefined);
  });

  it.each([
    ['fraction', 10_000.5],
    ['negative', -10_000],
    ['zero', 0],
    ['int4 overflow', 2_147_483_648],
    ['unsafe integer', Number.MAX_SAFE_INTEGER + 2],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects a %s amount before any database access', async (_label, amount) => {
    await expect(requestRedemption(actor, { ...input, amount })).rejects.toBeInstanceOf(ZodError);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects non-USER actors before any database access', async () => {
    await expect(requestRedemption({ ...actor, role: 'SUPERADMIN' } as CurrentUser, input))
      .rejects.toMatchObject({ status: 403 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('locks the user first, reads and writes only through tx, in ReadCommitted', async () => {
    const { tx, calls } = useTransaction(defaults());

    const result = await requestRedemption(actor, input);

    expect(result.idempotent).toBe(false);
    expect(calls).toEqual([
      "exec:SET LOCAL lock_timeout = '5s'",
      'lock:User',
      'read:idempotency',
      'lock:PayoutAccount',
      'read:PayoutAccount',
      'read:min_redemption',
      'read:balance',
      'read:openCases',
      'write:Redemption',
      'write:RewardLedger',
    ]);
    expect(vi.mocked(prisma.$transaction).mock.calls[0][1]).toMatchObject({
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
    expect(tx.redemption.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user_1', amount: 50_000, payoutAccountId: 'acc_1', provider: 'DANA',
        idempotencyKey: 'client-key-1', requestHash: redemptionRequestHash(input), status: 'REQUESTED',
        payoutDestinationSource: 'REQUEST_SNAPSHOT', payoutDestinationProvider: 'DANA',
        payoutDestinationCapturedAt: expect.any(Date),
      }),
    });
    // The destination is copied encrypted inside the same transaction as the reserve.
    const created = vi.mocked(tx.redemption.create).mock.calls[0][0].data as Record<string, string>;
    expect(isEncrypted(created.payoutDestinationIdentifier)).toBe(true);
    expect(decrypt(created.payoutDestinationIdentifier)).toBe('081234567890');
    expect(decrypt(created.payoutDestinationName)).toBe('Pengguna Satu');
    expect(tx.payoutAccount.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ accountIdentifier: true, accountName: true }) }));
    expect(tx.rewardLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amount: -50_000, status: 'PENDING', businessKey: 'redemption:r_new:reserve' }),
    });
    // Nothing bypassed the transaction client.
    expect(prisma.rewardLedger.groupBy).not.toHaveBeenCalled();
    expect(prisma.systemConfig.findUnique).not.toHaveBeenCalled();
    expect(prisma.redemption.findUnique).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'REDEMPTION_REQUEST', entityId: 'r_new' }));
  });

  it('hashes the canonical amount + destination only', () => {
    expect(redemptionRequestHash({ amount: 1, payoutAccountId: 'a' })).toMatch(/^[0-9a-f]{64}$/);
    expect(redemptionRequestHash({ amount: 1, payoutAccountId: 'a' }))
      .toBe(redemptionRequestHash({ payoutAccountId: 'a', amount: 1 }));
    expect(redemptionRequestHash({ amount: 2, payoutAccountId: 'a' }))
      .not.toBe(redemptionRequestHash({ amount: 1, payoutAccountId: 'a' }));
  });

  it('replays an existing request with the same body without writing or auditing again', async () => {
    const existing = { id: 'r_old', amount: 50_000, payoutAccountId: 'acc_1', requestHash: redemptionRequestHash(input) };
    const { tx, calls } = useTransaction(defaults({ existing }));

    await expect(requestRedemption(actor, input)).resolves.toEqual({ redemption: existing, idempotent: true });
    expect(calls).not.toContain('lock:PayoutAccount');
    expect(tx.redemption.create).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('answers 409 for the same key with a different body (hashed and legacy rows)', async () => {
    useTransaction(defaults({ existing: { id: 'r_old', amount: 50_000, payoutAccountId: 'acc_1', requestHash: 'f'.repeat(64) } }));
    await expect(requestRedemption(actor, input)).rejects.toMatchObject({ status: 409, message: REDEMPTION_KEY_CONFLICT });

    useTransaction(defaults({ existing: { id: 'r_legacy', amount: 50_000, payoutAccountId: 'acc_1', requestHash: null } }));
    await expect(requestRedemption(actor, input)).resolves.toMatchObject({ idempotent: true });
    await expect(requestRedemption(actor, { ...input, amount: 40_000 })).rejects.toMatchObject({ status: 409 });
  });

  it.each([
    ['account not owned', { ownedAccountRows: [], account: null }, 404, 'Akun pencairan tidak ditemukan'],
    ['account disabled', { account: { id: 'acc_1', userId: 'user_1', status: 'DISABLED', provider: 'DANA' } }, 409, 'Akun pencairan dinonaktifkan'],
    ['below minimum', { minRedemption: '60000' }, 422, 'Minimum pencairan Rp60.000'],
    ['insufficient balance', { ledger: [{ entryType: 'EARN', status: 'AVAILABLE', _sum: { amount: 49_999 } }] }, 422, 'Saldo tersedia tidak mencukupi'],
    ['missing user row', { userRows: [] }, 404, 'Pengguna tidak ditemukan'],
  ])('rejects when %s', async (_label, overrides, status, message) => {
    const { tx } = useTransaction(defaults(overrides as Partial<FakeState>));
    await expect(requestRedemption(actor, input)).rejects.toMatchObject({ status, message });
    expect(tx.redemption.create).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('keeps money held by open debit cases out of reach, counting each deposit item once', async () => {
    const { tx } = useTransaction(defaults({
      ledger: [{ entryType: 'EARN', status: 'AVAILABLE', _sum: { amount: 80_000 } }],
      openCases: [
        { id: 'c1', depositItemId: 'item-1', amount: 20_000 },
        { id: 'c2', depositItemId: 'item-1', amount: 20_000 },
        { id: 'c3', depositItemId: null, amount: 15_000 },
      ],
    }));
    await expect(requestRedemption(actor, { ...input, amount: 50_000 })).rejects.toMatchObject({
      status: 422,
      message: 'Saldo tersedia tidak mencukupi: Rp35.000 sedang ditahan untuk pemeriksaan',
    });
    expect(tx.redemption.create).not.toHaveBeenCalled();
    expect(tx.rewardReconciliationCase.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user_1', status: 'OPEN', reasonCode: 'ANOMALY_ALREADY_PAID_OUT' },
    }));
    useTransaction(defaults({ openCases: [{ id: 'c1', depositItemId: 'item-1', amount: 20_000 }] }));
    await expect(requestRedemption(actor, { ...input, amount: 50_000, idempotencyKey: 'k2' })).resolves.toMatchObject({ idempotent: false });
  });

  it('keeps a committed request successful when the audit write fails after commit', async () => {
    useTransaction(defaults());
    vi.mocked(logAudit).mockRejectedValue(new Error('audit store down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const afterCommit = vi.fn(async () => {});

    await expect(requestRedemption(actor, input, { afterCommit })).resolves.toMatchObject({
      idempotent: false, redemption: { id: 'r_new' },
    });
    expect(afterCommit).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('after commit'), 'audit store down');
    consoleError.mockRestore();
  });

  it('maps lock/transaction contention to a retryable 503', async () => {
    for (const error of [
      new Prisma.PrismaClientKnownRequestError('lock timeout', { code: 'P2010', clientVersion: '6', meta: { code: '55P03' } }),
      new Prisma.PrismaClientKnownRequestError('tx start timeout', { code: 'P2028', clientVersion: '6' }),
    ]) {
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(error);
      await expect(requestRedemption(actor, input)).rejects.toMatchObject({ status: 503 });
    }
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(new HttpError(422, 'Saldo tersedia tidak mencukupi'));
    await expect(requestRedemption(actor, input)).rejects.toMatchObject({ status: 422 });
  });

  it('falls back to the committed row when the (user, key) unique index fires', async () => {
    const conflict = new Prisma.PrismaClientKnownRequestError('unique', {
      code: 'P2002', clientVersion: '6', meta: { target: ['userId', 'idempotencyKey'] } });
    const existing = { id: 'r_other_writer', amount: 50_000, payoutAccountId: 'acc_1', requestHash: redemptionRequestHash(input) };
    vi.mocked(prisma.$transaction).mockRejectedValueOnce(conflict);
    vi.mocked(prisma.redemption.findUnique).mockResolvedValueOnce(existing as any);
    await expect(requestRedemption(actor, input)).resolves.toEqual({ redemption: existing, idempotent: true });
    expect(prisma.redemption.findUnique).toHaveBeenCalledWith({
      where: { userId_idempotencyKey: { userId: 'user_1', idempotencyKey: 'client-key-1' } },
    });

    vi.mocked(prisma.$transaction).mockRejectedValueOnce(conflict);
    vi.mocked(prisma.redemption.findUnique).mockResolvedValueOnce({ ...existing, requestHash: 'f'.repeat(64) } as any);
    await expect(requestRedemption(actor, input)).rejects.toMatchObject({ status: 409 });
  });
});
