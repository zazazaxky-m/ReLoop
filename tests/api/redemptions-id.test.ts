import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PATCH } from '@/app/api/redemptions/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import { logAudit } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';
import { decrypt, isEncrypted } from '@/lib/encryption';

// Route + real wallet service + real ledger settlement over a fake transaction
// client: proves the state machine, lock order and compare-and-set contract.
// Real concurrency is proven in tests/integration/payout-transitions.test.ts.

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    redemption: { findUnique: vi.fn() },
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

type Row = Record<string, any>;

interface FakeDb {
  redemption: Row | null;
  reserve: Row | null;
  account: Row | null;
  calls: string[];
  tx: any;
}

function redemptionRow(overrides: Row = {}): Row {
  return {
    id: 'r1', userId: 'u1', amount: 20_000, status: 'PROCESSING', provider: 'DANA', payoutAccountId: 'acc_1',
    manualTransferProofUrl: null, providerReference: null, note: null, processedBySuperadminId: null,
    requestHash: 'h'.repeat(64), payoutDestinationSource: 'REQUEST_SNAPSHOT', payoutDestinationProvider: 'DANA',
    payoutDestinationIdentifier: 'ciphertext-id', payoutDestinationName: 'ciphertext-name',
    payoutDestinationCapturedAt: new Date('2026-10-13T00:00:00Z'), reconciliationRequired: false,
    reconciliationNote: null, reconciliationFlaggedAt: null, ...overrides,
  };
}

function reserveRow(overrides: Row = {}): Row {
  return {
    id: 'l1', userId: 'u1', amount: -20_000, status: 'PENDING', entryType: 'REDEEM',
    referenceType: 'Redemption', referenceId: 'r1', ...overrides,
  };
}

function withDb(redemption: Row | null, reserve: Row | null = reserveRow(), account: Row | null = null): FakeDb {
  const db: FakeDb = { redemption, reserve, account, calls: [], tx: null };
  const matches = (row: Row, where: Row) =>
    Object.entries(where).every(([key, value]) => row[key] === value);
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = strings.join('?');
      if (sql.includes('FROM "User"')) {
        db.calls.push('lock:User');
        return [{ id: 'u1' }];
      }
      if (sql.includes('FROM "Redemption"')) {
        db.calls.push('lock:Redemption');
        return db.redemption ? [{ id: db.redemption.id }] : [];
      }
      throw new Error(`unexpected raw query ${sql}`);
    }),
    redemption: {
      findUnique: vi.fn(async ({ where, select }: { where: Row; select?: Row }) => {
        db.calls.push(select ? 'read:Redemption(partial)' : 'read:Redemption');
        if (!db.redemption || db.redemption.id !== where.id) return null;
        if (!select) return { ...db.redemption };
        return Object.fromEntries(Object.keys(select).map((key) => [key, db.redemption![key]]));
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        db.calls.push('cas:Redemption');
        if (!db.redemption || !matches(db.redemption, where)) return { count: 0 };
        for (const [key, value] of Object.entries(data)) if (value !== undefined) db.redemption[key] = value;
        return { count: 1 };
      }),
    },
    rewardLedger: {
      findMany: vi.fn(async () => {
        db.calls.push('read:reserve');
        return db.reserve ? [{ ...db.reserve }] : [];
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        db.calls.push('cas:RewardLedger');
        if (!db.reserve || !matches(db.reserve, where)) return { count: 0 };
        db.reserve.status = data.status;
        return { count: 1 };
      }),
      findUnique: vi.fn(async () => (db.reserve ? { ...db.reserve } : null)),
    },
    payoutAccount: {
      findFirst: vi.fn(async () => {
        db.calls.push('read:PayoutAccount');
        return db.account;
      }),
    },
  };
  db.tx = tx;
  vi.mocked(prisma.$transaction).mockImplementation((async (fn: (client: unknown) => unknown) => {
    db.calls.push('BEGIN');
    const result = await fn(tx);
    db.calls.push('COMMIT');
    return result;
  }) as any);
  vi.mocked(logAudit).mockImplementation(async () => {
    db.calls.push('audit');
  });
  vi.mocked(createNotification).mockImplementation((async () => {
    db.calls.push('notify');
  }) as any);
  return db;
}

const makeReq = (body: any) =>
  new Request('http://localhost/api/redemptions/r1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

async function patch(body: any, id = 'r1') {
  const res = await PATCH(makeReq(body), { params: Promise.resolve({ id }) });
  return { status: res.status, body: await res.json() };
}

describe('PATCH /api/redemptions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin_1', role: 'SUPERADMIN' } as any);
  });

  it('rejects success skipped straight from REQUESTED (409)', async () => {
    const db = withDb(redemptionRow({ status: 'REQUESTED' }));
    const res = await patch({ action: 'success', providerReference: 'REF1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Transisi status pencairan tidak valid');
    expect(res.body.error).not.toContain('REQUESTED');
    expect(db.calls).not.toContain('cas:Redemption');
  });

  it('rejects success skipped straight from APPROVED (409)', async () => {
    withDb(redemptionRow({ status: 'APPROVED' }));
    expect((await patch({ action: 'success', providerReference: 'REF1' })).status).toBe(409);
  });

  it('rejects success from PROCESSING without proof or reference (422)', async () => {
    const db = withDb(redemptionRow());
    const res = await patch({ action: 'success' });
    expect(res.status).toBe(422);
    expect(res.body.error).toContain('referensi transfer atau unggah bukti');
    expect(db.reserve!.status).toBe('PENDING');
  });

  it('does not accept a proof stored for another request as proof for this one (422)', async () => {
    withDb(redemptionRow({ manualTransferProofUrl: 'r_other/proof.jpg' }));
    expect((await patch({ action: 'success' })).status).toBe(422);
  });

  it('settles success under User -> Redemption locks with CAS, then audits and notifies after commit', async () => {
    const db = withDb(redemptionRow());
    const res = await patch({ action: 'success', providerReference: 'REF1' });

    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(false);
    expect(res.body.redemption).toMatchObject({ id: 'r1', status: 'SUCCESS', providerReference: 'REF1' });
    expect(db.reserve!.status).toBe('REDEEMED');
    expect(db.calls).toEqual([
      'BEGIN',
      'read:Redemption(partial)',
      'lock:User',
      'lock:Redemption',
      'read:Redemption',
      'read:reserve',
      'cas:Redemption',
      'read:Redemption(partial)',
      'read:reserve',
      'cas:RewardLedger',
      'read:Redemption',
      'COMMIT',
      'audit',
      'notify',
    ]);
    expect(vi.mocked(prisma.$transaction).mock.calls[0][1]).toMatchObject({ isolationLevel: 'ReadCommitted' });
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1', type: 'REDEMPTION_STATUS', data: { redemptionId: 'r1', status: 'SUCCESS' } }));
  });

  it('never returns the request hash or destination ciphertext', async () => {
    withDb(redemptionRow());
    const res = await patch({ action: 'success', providerReference: 'REF1' });
    expect(res.body.redemption).not.toHaveProperty('requestHash');
    expect(res.body.redemption).not.toHaveProperty('payoutDestinationIdentifier');
    expect(res.body.redemption).not.toHaveProperty('payoutDestinationName');
    expect(res.body.redemption.payoutDestinationSource).toBe('REQUEST_SNAPSHOT');
  });

  it('accepts success from PROCESSING when this request has its own proof (200)', async () => {
    withDb(redemptionRow({ manualTransferProofUrl: 'r1/proof.jpg' }));
    expect((await patch({ action: 'success' })).status).toBe(200);
  });

  it('still allows approve from REQUESTED and keeps the reserve held', async () => {
    const db = withDb(redemptionRow({ status: 'REQUESTED' }));
    const res = await patch({ action: 'approve' });
    expect(res.status).toBe(200);
    expect(db.redemption!.status).toBe('APPROVED');
    expect(db.reserve!.status).toBe('PENDING');
    expect(db.calls).not.toContain('cas:RewardLedger');
  });

  it('a USER cannot force success on their own redemption (403)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
    withDb(redemptionRow());
    expect((await patch({ action: 'success', providerReference: 'REF1' })).status).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns idempotent when status already matches target and the reserve agrees', async () => {
    const db = withDb(redemptionRow({ status: 'APPROVED' }));
    const res = await patch({ action: 'approve' });
    expect(res.status).toBe(200);
    expect(res.body.idempotent).toBe(true);
    expect(db.calls).not.toContain('cas:Redemption');
    expect(logAudit).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalled();
  });

  it('repeats a terminal success idempotently only when the reserve is already REDEEMED', async () => {
    withDb(redemptionRow({ status: 'SUCCESS', providerReference: 'REF1' }), reserveRow({ status: 'REDEEMED' }));
    expect(await patch({ action: 'success', providerReference: 'REF1' })).toMatchObject({ status: 200, body: { idempotent: true } });

    const diverged = withDb(redemptionRow({ status: 'SUCCESS', providerReference: 'REF1' }), reserveRow({ status: 'PENDING' }));
    const res = await patch({ action: 'success', providerReference: 'REF1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/tidak sesuai/);
    expect(diverged.calls).not.toContain('cas:RewardLedger');
  });

  it('refuses a terminal replay with a different reference or note (409) and changes nothing', async () => {
    const stored = { status: 'SUCCESS', providerReference: 'REF-1', note: 'Sudah ditransfer' };
    for (const body of [
      { action: 'success', providerReference: 'REF-2' },
      { action: 'success', providerReference: 'REF-1', note: 'Transfer kedua' },
    ]) {
      const db = withDb(redemptionRow(stored), reserveRow({ status: 'REDEEMED' }));
      const res = await patch(body);
      expect(res.status).toBe(409);
      expect(db.redemption).toMatchObject(stored);
      expect(db.calls).not.toContain('cas:Redemption');
    }
    withDb(redemptionRow(stored), reserveRow({ status: 'REDEEMED' }));
    expect((await patch({ action: 'success', providerReference: 'REF-2' })).body.error).toBe(
      'Pencairan ini sudah dicatat dengan nomor referensi lain. Periksa kemungkinan transfer ganda sebelum melanjutkan.');
    expect((await patch({ action: 'success', note: 'lain' })).body.error).toBe(
      'Pencairan ini sudah dicatat dengan catatan berbeda. Muat ulang untuk melihat data terbaru.');
    // Identical or bare retries stay idempotent.
    for (const body of [{ action: 'success' }, { action: 'success', providerReference: 'REF-1', note: 'Sudah ditransfer' }]) {
      expect(await patch(body)).toMatchObject({ status: 200, body: { idempotent: true } });
    }
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('answers the opposite terminal outcome with 409, never a successful no-op', async () => {
    const db = withDb(redemptionRow({ status: 'SUCCESS' }), reserveRow({ status: 'REDEEMED' }));
    const res = await patch({ action: 'fail' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Status pencairan sudah berubah');
    expect(db.reserve!.status).toBe('REDEEMED');
  });

  it('settles ledger as failed on fail action', async () => {
    const db = withDb(redemptionRow());
    const res = await patch({ action: 'fail', note: 'rejected' });
    expect(res.status).toBe(200);
    expect(db.redemption).toMatchObject({ status: 'FAILED', note: 'rejected' });
    expect(db.reserve!.status).toBe('REVERSED');
  });

  it('settles ledger as failed on user cancel without a self-notification', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
    const db = withDb(redemptionRow({ status: 'REQUESTED' }));
    const res = await patch({ action: 'cancel' });
    expect(res.status).toBe(200);
    expect(db.redemption!.status).toBe('REVERSED');
    expect(db.reserve!.status).toBe('REVERSED');
    expect(createNotification).not.toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'REDEMPTION_CANCEL', actorId: 'u1' }));
  });

  it('returns 404 when redemption is missing', async () => {
    withDb(null);
    const res = await patch({ action: 'approve' }, 'missing');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Pengajuan pencairan tidak ditemukan');
  });

  it('rejects USER cancelling another users redemption before locking their wallet', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u2', role: 'USER' } as any);
    const db = withDb(redemptionRow({ status: 'REQUESTED' }));
    expect((await patch({ action: 'cancel' })).status).toBe(403);
    expect(db.calls).not.toContain('lock:User');
    expect(db.redemption!.status).toBe('REQUESTED');
  });

  it.each([
    ['missing', null, /tidak ditemukan/],
    ['for another amount', reserveRow({ amount: -15_000 }), /tidak sesuai/],
    ['owned by another user', reserveRow({ userId: 'u2' }), /tidak sesuai/],
    ['already released', reserveRow({ status: 'REVERSED' }), /tidak sesuai/],
  ])('refuses with 409 and writes nothing when the reserve is %s', async (_label, reserve, message) => {
    const db = withDb(redemptionRow(), reserve as Row | null);
    const res = await patch({ action: 'fail', note: 'x' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(message);
    expect(db.calls).not.toContain('cas:Redemption');
    expect(db.calls).not.toContain('COMMIT');
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('refuses when the status changed between the locked read and the compare-and-set', async () => {
    const db = withDb(redemptionRow());
    const cas = db.tx.redemption.updateMany;
    // A writer that bypassed the lock changes the status right before our CAS.
    db.tx.redemption.updateMany = vi.fn(async (args: any) => {
      db.redemption!.status = 'FAILED';
      return cas(args);
    });
    const res = await patch({ action: 'success', providerReference: 'REF1' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Status pencairan sudah berubah');
    expect(db.calls).not.toContain('cas:RewardLedger');
    expect(db.calls).not.toContain('COMMIT');
  });

  it('keeps a committed transition successful when the notification fails after commit', async () => {
    const db = withDb(redemptionRow());
    vi.mocked(createNotification).mockRejectedValue(new Error('push down'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await patch({ action: 'success', providerReference: 'REF1' });
    expect(res.status).toBe(200);
    expect(db.reserve!.status).toBe('REDEEMED');
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('after commit'), 'push down');
    consoleError.mockRestore();
  });

  it('records a legacy request destination from the current account when processing', async () => {
    const db = withDb(
      redemptionRow({ status: 'APPROVED', payoutDestinationSource: null, payoutDestinationProvider: null,
        payoutDestinationIdentifier: null, payoutDestinationName: null, payoutDestinationCapturedAt: null }),
      reserveRow(),
      { provider: 'OVO', accountIdentifier: '081200000009', accountName: 'Pemilik Lama' },
    );
    const res = await patch({ action: 'process' });
    expect(res.status).toBe(200);
    expect(db.redemption).toMatchObject({ status: 'PROCESSING', payoutDestinationSource: 'LEGACY_ACCOUNT_FALLBACK', payoutDestinationProvider: 'OVO' });
    expect(isEncrypted(db.redemption!.payoutDestinationIdentifier)).toBe(true);
    expect(decrypt(db.redemption!.payoutDestinationIdentifier)).toBe('081200000009');
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'REDEMPTION_PROCESS', metadata: expect.objectContaining({ destinationSource: 'LEGACY_ACCOUNT_FALLBACK' }) }));
  });

  it('refuses to process a legacy request whose account is gone, without guessing', async () => {
    const db = withDb(
      redemptionRow({ status: 'APPROVED', payoutDestinationSource: null, payoutDestinationIdentifier: null }),
      reserveRow(),
      null,
    );
    const res = await patch({ action: 'process' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Tujuan pencairan tidak tersedia/);
    expect(db.redemption!.status).toBe('APPROVED');
  });

  it('never rewrites the request-time destination snapshot', async () => {
    const db = withDb(redemptionRow({ status: 'APPROVED' }), reserveRow(), {
      provider: 'OVO', accountIdentifier: '0899', accountName: 'Nama Baru' });
    expect((await patch({ action: 'process' })).status).toBe(200);
    expect(db.redemption!.payoutDestinationIdentifier).toBe('ciphertext-id');
    expect(db.calls).not.toContain('read:PayoutAccount');
  });

  describe('flag_reconciliation', () => {
    it('requires a note (422)', async () => {
      withDb(redemptionRow());
      const res = await patch({ action: 'flag_reconciliation' });
      expect(res.status).toBe(422);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('keeps the request PROCESSING with the reserve held and flags it once', async () => {
      const db = withDb(redemptionRow());
      const res = await patch({ action: 'flag_reconciliation', note: 'Bank belum konfirmasi' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ idempotent: false,
        redemption: { status: 'PROCESSING', reconciliationRequired: true, reconciliationNote: 'Bank belum konfirmasi' } });
      expect(db.reserve!.status).toBe('PENDING');
      expect(db.calls).not.toContain('cas:RewardLedger');
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'REDEMPTION_FLAG_RECONCILIATION' }));

      const again = await patch({ action: 'flag_reconciliation', note: 'Bank belum konfirmasi' });
      expect(again.body.idempotent).toBe(true);
      const other = await patch({ action: 'flag_reconciliation', note: 'lagi' });
      expect(other.status).toBe(409);
      expect(other.body.error).toBe(
        'Pengajuan ini sudah ditandai untuk rekonsiliasi dengan catatan lain. Muat ulang untuk melihat catatan yang tersimpan.');
      expect(db.redemption!.reconciliationNote).toBe('Bank belum konfirmasi');
    });

    it('requires a note before a flagged request may be failed, then clears the flag', async () => {
      const db = withDb(redemptionRow({ reconciliationRequired: true, reconciliationNote: 'cek bank' }));
      expect((await patch({ action: 'fail' })).status).toBe(422);
      expect(db.reserve!.status).toBe('PENDING');
      const res = await patch({ action: 'fail', note: 'Mutasi: tidak terkirim' });
      expect(res.status).toBe(200);
      expect(db.redemption).toMatchObject({ status: 'FAILED', reconciliationRequired: false, reconciliationNote: 'cek bank' });
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'REDEMPTION_FAIL', metadata: expect.objectContaining({ reconciliationResolved: true }) }));
    });

    it('is refused outside PROCESSING and for non-superadmins', async () => {
      withDb(redemptionRow({ status: 'APPROVED' }));
      expect((await patch({ action: 'flag_reconciliation', note: 'x' })).status).toBe(409);
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      expect((await patch({ action: 'flag_reconciliation', note: 'x' })).status).toBe(403);
    });
  });

  it('rejects unknown actions and oversized fields with 422', async () => {
    withDb(redemptionRow());
    expect((await patch({ action: 'refund' })).status).toBe(422);
    expect((await patch({ action: 'fail', note: 'x'.repeat(501) })).status).toBe(422);
    expect((await patch({ action: 'success', providerReference: 'x'.repeat(121) })).status).toBe(422);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
