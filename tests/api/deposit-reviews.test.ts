import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/deposit-reviews/route';
import * as rbac from '@/lib/rbac';
import * as securityEvents from '@/lib/security-events';

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/security-events', () => ({
  getDepositReviewQueue: vi.fn(),
}));

vi.mock('@/lib/pagination', async (importOriginal) => {
  const actual = await importOriginal();
  return actual as any;
});

describe('/api/deposit-reviews GET', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 when not ADMIN or SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await GET(new Request('http://localhost/api/deposit-reviews'));
    expect(res.status).toBe(403);
  });

  it('returns review queue for SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(securityEvents.getDepositReviewQueue).mockResolvedValue({
      items: [{ id: 'di1' }], total: 1,
    } as any);

    const res = await GET(new Request('http://localhost/api/deposit-reviews'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items).toHaveLength(1);
  });

  it('scopes to org for ADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1', role: 'ADMIN', organizationId: 'org1',
    } as any);
    vi.mocked(securityEvents.getDepositReviewQueue).mockResolvedValue({
      items: [], total: 0,
    } as any);

    const res = await GET(new Request('http://localhost/api/deposit-reviews'));
    expect(res.status).toBe(200);
    expect(securityEvents.getDepositReviewQueue).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org1' }),
    );
  });

  it('uses __none__ for ADMIN without organizationId', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'a1', role: 'ADMIN', organizationId: null,
    } as any);
    vi.mocked(securityEvents.getDepositReviewQueue).mockResolvedValue({
      items: [], total: 0,
    } as any);

    await GET(new Request('http://localhost/api/deposit-reviews'));
    expect(securityEvents.getDepositReviewQueue).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: '__none__' }),
    );
  });

  it('SUPERADMIN uses organizationId from query string', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(securityEvents.getDepositReviewQueue).mockResolvedValue({
      items: [], total: 0,
    } as any);

    await GET(new Request('http://localhost/api/deposit-reviews?organizationId=org2'));
    expect(securityEvents.getDepositReviewQueue).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org2' }),
    );
  });
});
