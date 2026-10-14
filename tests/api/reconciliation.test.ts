import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/reports/reconciliation/route';
import * as rbac from '@/lib/rbac';
import * as reconciliation from '@/lib/reconciliation-report';

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/reconciliation-report', () => ({
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
      availableLiability: 500, pendingLiability: 0, reservedLiability: 0, paidTotal: 500, totalObligation: 500,
      totalOutstanding: 500, unallocatedLegacyAmount: 500, organizations: [], hasDiscrepancy: false,
    };
    vi.mocked(reconciliation.getReconciliationReport).mockResolvedValue(mockReport as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.report).toEqual(mockReport);
    expect(rbac.requireApiUser).toHaveBeenCalledWith(['SUPERADMIN']);
    // Production never passes the test seam.
    expect(reconciliation.getReconciliationReport).toHaveBeenCalledWith();
  });
});
