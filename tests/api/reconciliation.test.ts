import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/reports/reconciliation/route';
import * as rbac from '@/lib/rbac';
import * as ledger from '@/lib/ledger';

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/ledger', () => ({
  getReconciliationReport: vi.fn(),
}));

describe('/api/reports/reconciliation GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it('returns reconciliation report for SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    const mockReport = {
      global: { totalEarned: 1000, totalRedeemed: 500, currentLiability: 500 },
      organizations: [],
      payoutCrossCheck: { sumLedgerRedeem: -500, sumRedemptionPayouts: 500, difference: 0 },
    };
    vi.mocked(ledger.getReconciliationReport).mockResolvedValue(mockReport as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.report).toEqual(mockReport);
  });
});
