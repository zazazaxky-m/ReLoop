import { describe, expect, it, vi, beforeEach } from 'vitest';
import { PATCH } from '@/app/api/redemptions/[id]/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as ledger from '@/lib/ledger';

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@/lib/notifications', () => ({
  createNotification: vi.fn(),
}));

vi.mock('@/lib/prisma', () => {
  const mockTx = {
    redemption: { update: vi.fn() },
  };
  return {
    prisma: {
      redemption: { findUnique: vi.fn() },
      $transaction: vi.fn().mockImplementation((cb) => cb(mockTx)),
    },
    mockTx,
  };
});

vi.mock('@/lib/rbac', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as any),
    requireApiUser: vi.fn(),
  };
});

vi.mock('@/lib/ledger', () => ({
  settleRedeemLedger: vi.fn(),
}));

const makeReq = (body: any) =>
  new Request('http://localhost/api/redemptions/r1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });

describe('PATCH /api/redemptions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin_1', role: 'SUPERADMIN' } as any);
  });

  it('rejects success skipped straight from REQUESTED (409)', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      id: 'r1', status: 'REQUESTED', userId: 'u1', manualTransferProofUrl: null,
    } as any);

    const res = await PATCH(makeReq({ action: 'success', providerReference: 'REF1' }), {
      params: Promise.resolve({ id: 'r1' }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Transisi status pencairan tidak valid");
    expect(body.error).not.toContain("REQUESTED");
  });

  it('rejects success skipped straight from APPROVED (409)', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      id: 'r1', status: 'APPROVED', userId: 'u1', manualTransferProofUrl: null,
    } as any);

    const res = await PATCH(makeReq({ action: 'success', providerReference: 'REF1' }), {
      params: Promise.resolve({ id: 'r1' }),
    });

    expect(res.status).toBe(409);
  });

  it('rejects success from PROCESSING without proof or reference (422)', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      id: 'r1', status: 'PROCESSING', userId: 'u1', manualTransferProofUrl: null,
    } as any);

    const res = await PATCH(makeReq({ action: 'success' }), {
      params: Promise.resolve({ id: 'r1' }),
    });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain('referensi transfer atau unggah bukti');
  });

  it('accepts success from PROCESSING with a providerReference (200)', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      id: 'r1', status: 'PROCESSING', userId: 'u1', manualTransferProofUrl: null,
    } as any);
    const { mockTx } = await import('@/lib/prisma') as any;
    mockTx.redemption.update.mockResolvedValue({ id: 'r1', status: 'SUCCESS' });

    const res = await PATCH(makeReq({ action: 'success', providerReference: 'REF1' }), {
      params: Promise.resolve({ id: 'r1' }),
    });

    expect(res.status).toBe(200);
    expect(ledger.settleRedeemLedger).toHaveBeenCalledWith('r1', 'success', expect.anything());
  });

  it('accepts success from PROCESSING when a proof was already uploaded (200)', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      id: 'r1', status: 'PROCESSING', userId: 'u1', manualTransferProofUrl: 'r1/proof.jpg',
    } as any);
    const { mockTx } = await import('@/lib/prisma') as any;
    mockTx.redemption.update.mockResolvedValue({ id: 'r1', status: 'SUCCESS' });

    const res = await PATCH(makeReq({ action: 'success' }), {
      params: Promise.resolve({ id: 'r1' }),
    });

    expect(res.status).toBe(200);
  });

  it('still allows approve from REQUESTED (unaffected by the success chain change)', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      id: 'r1', status: 'REQUESTED', userId: 'u1', manualTransferProofUrl: null,
    } as any);
    const { mockTx } = await import('@/lib/prisma') as any;
    mockTx.redemption.update.mockResolvedValue({ id: 'r1', status: 'APPROVED' });

    const res = await PATCH(makeReq({ action: 'approve' }), {
      params: Promise.resolve({ id: 'r1' }),
    });

    expect(res.status).toBe(200);
  });

  it('a USER cannot force success on their own redemption (403)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      id: 'r1', status: 'PROCESSING', userId: 'u1', manualTransferProofUrl: null,
    } as any);

    const res = await PATCH(makeReq({ action: 'success', providerReference: 'REF1' }), {
      params: Promise.resolve({ id: 'r1' }),
    });

    expect(res.status).toBe(403);
  });

  it('returns idempotent when status already matches target', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      id: 'r1', status: 'APPROVED', userId: 'u1', manualTransferProofUrl: null,
    } as any);

    const res = await PATCH(makeReq({ action: 'approve' }), {
      params: Promise.resolve({ id: 'r1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.idempotent).toBe(true);
  });

  it('settles ledger as failed on fail action', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      id: 'r1', status: 'PROCESSING', userId: 'u1', manualTransferProofUrl: null,
    } as any);
    const { mockTx } = await import('@/lib/prisma') as any;
    mockTx.redemption.update.mockResolvedValue({ id: 'r1', status: 'FAILED' });

    const res = await PATCH(makeReq({ action: 'fail', note: 'rejected' }), {
      params: Promise.resolve({ id: 'r1' }),
    });

    expect(res.status).toBe(200);
    expect(ledger.settleRedeemLedger).toHaveBeenCalledWith('r1', 'failed', expect.anything());
  });

  it('settles ledger as failed on user cancel', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      id: 'r1', status: 'REQUESTED', userId: 'u1', manualTransferProofUrl: null,
    } as any);
    const { mockTx } = await import('@/lib/prisma') as any;
    mockTx.redemption.update.mockResolvedValue({ id: 'r1', status: 'REVERSED' });

    const res = await PATCH(makeReq({ action: 'cancel' }), {
      params: Promise.resolve({ id: 'r1' }),
    });

    expect(res.status).toBe(200);
    expect(ledger.settleRedeemLedger).toHaveBeenCalledWith('r1', 'failed', expect.anything());
  });

  it('returns 404 when redemption is missing', async () => {
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue(null);
    const res = await PATCH(makeReq({ action: 'approve' }), {
      params: Promise.resolve({ id: 'missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects USER cancelling another users redemption', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
    vi.mocked(prisma.redemption.findUnique).mockResolvedValue({
      id: 'r1', status: 'REQUESTED', userId: 'other', manualTransferProofUrl: null,
    } as any);

    const res = await PATCH(makeReq({ action: 'cancel' }), {
      params: Promise.resolve({ id: 'r1' }),
    });
    expect(res.status).toBe(403);
  });
});
