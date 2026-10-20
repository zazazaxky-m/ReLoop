import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET as getDashboard } from '@/app/api/user/dashboard/route';
import { GET as getData, DELETE as deleteData } from '@/app/api/user/data/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as ledger from '@/lib/ledger';
import * as config from '@/lib/config';
import * as campaign from '@/lib/campaign';
import * as gdpr from '@/lib/gdpr';
import * as erasure from '@/lib/erasure-jobs';
import * as auth from '@/lib/auth';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    depositSession: { findMany: vi.fn() },
    campaign: { findMany: vi.fn() },
    travelAgentUser: { count: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/ledger', () => ({
  getWalletBalance: vi.fn(),
  getLedgerHistory: vi.fn(),
}));

vi.mock('@/lib/config', () => ({
  getConfigInt: vi.fn(),
  CONFIG_KEYS: { POINTS_TO_RUPIAH: 'POINTS_TO_RUPIAH' },
}));

vi.mock('@/lib/campaign', () => ({
  isCampaignEligible: vi.fn(),
}));

vi.mock('@/lib/gdpr', () => ({
  createUserDataExportStream: vi.fn(),
}));

vi.mock('@/lib/erasure-jobs', () => ({
  ERASURE_ONLY_USERS: 'Hanya pengguna biasa yang dapat menghapus data',
  requestErasure: vi.fn(),
  runErasureJob: vi.fn(),
  getErasureStatus: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ clearSessionCookie: vi.fn() }));

describe('/api/user endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/user/dashboard', () => {
    it('requires USER role (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await getDashboard();
      expect(res.status).toBe(403);
    });

    it('returns dashboard data successfully (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', email: 'u1@a.com', role: 'USER' } as any);
      vi.mocked(ledger.getWalletBalance).mockResolvedValue({ available: 100 } as any);
      vi.mocked(prisma.depositSession.findMany).mockResolvedValue([{ id: 'sess1' }] as any);
      vi.mocked(prisma.campaign.findMany).mockResolvedValue([{ id: 'camp1' }] as any);
      vi.mocked(ledger.getLedgerHistory).mockResolvedValue([{ id: 'ledg1' }] as any);
      vi.mocked(prisma.travelAgentUser.count).mockResolvedValue(1);
      vi.mocked(config.getConfigInt).mockResolvedValue(2);
      vi.mocked(campaign.isCampaignEligible).mockReturnValue({ eligible: true });

      const res = await getDashboard();
      expect(res.status).toBe(200);
      const data = await res.json();
      
      expect(data.balance.available).toBe(100);
      expect(data.recentSessions).toHaveLength(1);
      expect(data.campaigns).toHaveLength(1);
      expect(data.recentLedger).toHaveLength(1);
      expect(data.isTravelAgent).toBe(true);
      expect(data.pointsToRupiah).toBe(2);
    });
  });

  describe('GET /api/user/data', () => {
    it('returns streamed export payload (200)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(gdpr.createUserDataExportStream).mockReturnValue(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('{"profile":{"name":"John"}}'),
            );
            controller.close();
          },
        }),
      );

      const res = await getData();
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('application/json');
      expect(res.headers.get('Content-Disposition')).toContain('reloop-export-u1.json');
      const text = await res.text();
      expect(text).toContain('John');
    });
  });

  describe('DELETE /api/user/data', () => {
    it('fails if user is not USER role (403)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin', role: 'ADMIN' } as any);
      
      const res = await deleteData();
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error).toBe('Hanya pengguna biasa yang dapat menghapus data');
    });

    it('accepts the erasure (202) and runs it once when nothing is owed', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(erasure.requestErasure).mockResolvedValue({ requestId: 'r1', status: 'PROCESSING' });
      vi.mocked(erasure.getErasureStatus).mockResolvedValue({ requestId: 'r1', status: 'COMPLETED', completed: true, accountErased: true } as any);

      const res = await deleteData();
      expect(res.status).toBe(202);
      expect(erasure.requestErasure).toHaveBeenCalledWith('u1');
      expect(erasure.runErasureJob).toHaveBeenCalledWith('r1');
      expect(auth.clearSessionCookie).toHaveBeenCalled();
      expect(await res.json()).toMatchObject({ requestId: 'r1', status: 'COMPLETED', completed: true });
    });

    it('holds the erasure without running it while balances are open (202, session kept)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'USER' } as any);
      vi.mocked(erasure.requestErasure).mockResolvedValue({ requestId: 'r1', status: 'PENDING_RECONCILIATION' });
      vi.mocked(erasure.getErasureStatus).mockResolvedValue({ requestId: 'r1', status: 'PENDING_RECONCILIATION', completed: false, accountErased: false } as any);

      const res = await deleteData();
      expect(res.status).toBe(202);
      expect(erasure.runErasureJob).not.toHaveBeenCalled();
      expect(auth.clearSessionCookie).not.toHaveBeenCalled();
      expect(await res.json()).toMatchObject({ status: 'PENDING_RECONCILIATION', completed: false });
    });
  });
});
