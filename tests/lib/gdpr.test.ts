import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  recordConsent,
  verifyConsent,
  processErasureRequest,
  exportUserData,
  createUserDataExportStream,
} from '@/lib/gdpr';
import { prisma } from '@/lib/prisma';
import * as audit from '@/lib/audit';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    consentRecord: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    depositSession: { updateMany: vi.fn(), findMany: vi.fn() },
    payoutAccount: { deleteMany: vi.fn() },
    rewardLedger: { updateMany: vi.fn(), findMany: vi.fn() },
    redemption: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

describe('gdpr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('recordConsent', () => {
    it('creates record and logs audit', async () => {
      await recordConsent({ userId: 'u1', consentType: 'marketing_emails', granted: true });
      expect(prisma.consentRecord.create).toHaveBeenCalled();
      expect(audit.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONSENT_GIVEN' })
      );
    });

    it('handles withdrawal', async () => {
      await recordConsent({ userId: 'u1', consentType: 'marketing_emails', granted: false });
      expect(audit.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CONSENT_WITHDRAWN' })
      );
    });
  });

  describe('verifyConsent', () => {
    it('returns latest consent status', async () => {
      vi.mocked(prisma.consentRecord.findFirst).mockResolvedValue({ granted: true } as any);
      const res = await verifyConsent('u1', 'marketing_emails');
      expect(res).toBe(true);
    });

    it('defaults to false if no record', async () => {
      vi.mocked(prisma.consentRecord.findFirst).mockResolvedValue(null);
      const res = await verifyConsent('u1', 'marketing_emails');
      expect(res).toBe(false);
    });
  });

  describe('processErasureRequest', () => {
    it('throws if user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      await expect(processErasureRequest('u1')).rejects.toThrow('User not found');
    });

    it('anonymizes user data and logs audit', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.redemption.updateMany).mockResolvedValue({ count: 0 } as any);
      vi.mocked(prisma.redemption.count).mockResolvedValue(0);
      
      const log = await processErasureRequest('u1');
      
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: '[REDACTED]', email: 'redacted-u1@reloop.id' }) })
      );
      expect(prisma.depositSession.updateMany).toHaveBeenCalled();
      expect(prisma.payoutAccount.deleteMany).toHaveBeenCalled();
      expect(prisma.rewardLedger.updateMany).toHaveBeenCalled();
      expect(audit.logAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DATA_ERASURE', entityId: 'u1' })
      );
      expect(log.steps).toHaveLength(5);
    });

    it('erases the payout destination of finished redemptions and logs what was kept for settlement', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.redemption.updateMany).mockResolvedValue({ count: 3 } as any);
      vi.mocked(prisma.redemption.count).mockResolvedValue(1);

      const log = await processErasureRequest('u1');

      expect(prisma.redemption.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          status: { in: ['SUCCESS', 'FAILED', 'REVERSED'] },
          OR: [{ payoutDestinationIdentifier: { not: null } }, { payoutDestinationName: { not: null } }],
        },
        data: { payoutDestinationIdentifier: null, payoutDestinationName: null },
      });
      // Unsettled requests keep the snapshot: it is still needed to pay or reconcile them.
      expect(prisma.redemption.count).toHaveBeenCalledWith({
        where: {
          userId: 'u1',
          status: { notIn: ['SUCCESS', 'FAILED', 'REVERSED'] },
          OR: [{ payoutDestinationIdentifier: { not: null } }, { payoutDestinationName: { not: null } }],
        },
      });
      expect(log.steps).toEqual([
        'profile_redacted', 'sessions_anonymized', 'payout_accounts_deleted',
        'redemption_destinations_erased', 'redemption_destinations_retained_for_settlement', 'ledger_anonymized',
      ]);
      expect(log.redemptionDestinations).toEqual({ erased: 3, retainedForSettlement: 1 });
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'DATA_ERASURE', metadata: expect.objectContaining({ redemptionDestinations: { erased: 3, retainedForSettlement: 1 } }) }));
    });

    it('does not claim a retained destination when nothing is unsettled', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(prisma.redemption.updateMany).mockResolvedValue({ count: 0 } as any);
      vi.mocked(prisma.redemption.count).mockResolvedValue(0);
      const log = await processErasureRequest('u1');
      expect(log.steps).not.toContain('redemption_destinations_retained_for_settlement');
      expect(log.redemptionDestinations).toEqual({ erased: 0, retainedForSettlement: 0 });
    });
  });

  describe('exportUserData', () => {
    it('gathers paginated data', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1', name: 'Test' } as any);
      vi.mocked(prisma.depositSession.findMany).mockResolvedValueOnce([{ id: 's1' }] as any).mockResolvedValueOnce([]);
      vi.mocked(prisma.rewardLedger.findMany).mockResolvedValueOnce([] as any);
      vi.mocked(prisma.consentRecord.findMany).mockResolvedValueOnce([] as any);
      vi.mocked(prisma.redemption.findMany).mockResolvedValueOnce([] as any);

      const exp = await exportUserData('u1');
      
      expect(exp.profile?.name).toBe('Test');
      expect(exp.depositSessions).toHaveLength(1);
    });

    it('handles user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.depositSession.findMany).mockResolvedValue([]);
      vi.mocked(prisma.rewardLedger.findMany).mockResolvedValue([]);
      vi.mocked(prisma.consentRecord.findMany).mockResolvedValue([]);
      vi.mocked(prisma.redemption.findMany).mockResolvedValue([]);

      const exp = await exportUserData('u1');
      expect(exp.profile).toBeNull();
    });
  });

  describe('createUserDataExportStream', () => {
    it('streams export data as json', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1', name: 'Test' } as any);
      vi.mocked(prisma.depositSession.findMany).mockResolvedValueOnce([{ id: 's1' }] as any).mockResolvedValueOnce([]);
      vi.mocked(prisma.rewardLedger.findMany).mockResolvedValueOnce([] as any);
      vi.mocked(prisma.consentRecord.findMany).mockResolvedValueOnce([] as any);
      vi.mocked(prisma.redemption.findMany).mockResolvedValueOnce([{ id: 'r1' }] as any).mockResolvedValueOnce([]);

      const stream = createUserDataExportStream('u1');
      const reader = stream.getReader();
      
      let result = '';
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }
      result += decoder.decode();

      const parsed = JSON.parse(result);
      expect(parsed.profile.name).toBe('Test');
      expect(parsed.depositSessions[0].id).toBe('s1');
      expect(parsed.redemptions[0].id).toBe('r1');
    });

    it('handles errors in stream', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('DB stream error'));
      const stream = createUserDataExportStream('u1');
      const reader = stream.getReader();
      await expect(reader.read()).rejects.toThrow('DB stream error');
    });

    it('streams export data with null profile when user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.depositSession.findMany).mockResolvedValue([]);
      vi.mocked(prisma.rewardLedger.findMany).mockResolvedValue([]);
      vi.mocked(prisma.consentRecord.findMany).mockResolvedValue([]);
      vi.mocked(prisma.redemption.findMany).mockResolvedValue([]);

      const stream = createUserDataExportStream('u1');
      const reader = stream.getReader();
      
      let result = '';
      const decoder = new TextDecoder();
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }
      result += decoder.decode();

      const parsed = JSON.parse(result);
      expect(parsed.profile).toBeNull();
    });

    it('paginates when a batch is exactly EXPORT_BATCH_SIZE', async () => {
      const fullBatch = Array.from({ length: 200 }, (_, i) => ({ id: `s${i}` }));
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'u1', name: 'Test' } as any);
      vi.mocked(prisma.depositSession.findMany)
        .mockResolvedValueOnce(fullBatch as any)
        .mockResolvedValueOnce([{ id: 's-last' }] as any);
      vi.mocked(prisma.rewardLedger.findMany).mockResolvedValue([]);
      vi.mocked(prisma.consentRecord.findMany).mockResolvedValue([]);
      vi.mocked(prisma.redemption.findMany)
        .mockResolvedValueOnce(fullBatch.map((x) => ({ id: `r-${x.id}` })) as any)
        .mockResolvedValueOnce([]);

      const exp = await exportUserData('u1');
      expect(exp.depositSessions).toHaveLength(201);
      expect(exp.redemptions).toHaveLength(200);

      // Fresh mocks for the streaming path (exportUserData consumed the once-queues).
      vi.mocked(prisma.depositSession.findMany)
        .mockResolvedValueOnce(fullBatch as any)
        .mockResolvedValueOnce([]);
      vi.mocked(prisma.rewardLedger.findMany).mockResolvedValue([]);
      vi.mocked(prisma.consentRecord.findMany).mockResolvedValue([]);
      vi.mocked(prisma.redemption.findMany)
        .mockResolvedValueOnce([{ id: 'r1' }, { id: 'r2' }] as any)
        .mockResolvedValueOnce([]);

      const stream = createUserDataExportStream('u1');
      const reader = stream.getReader();
      let result = '';
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }
      result += decoder.decode();
      const parsed = JSON.parse(result);
      expect(parsed.redemptions).toHaveLength(2);
      expect(parsed.depositSessions).toHaveLength(200);
    });

    it('paginates redemptions in the streaming export path', async () => {
      const fullBatch = Array.from({ length: 200 }, (_, i) => ({ id: `r${i}` }));
      vi.mocked(prisma.user.findUnique).mockReset().mockResolvedValue({ id: 'u1', name: 'Test' } as any);
      vi.mocked(prisma.depositSession.findMany).mockReset().mockResolvedValue([]);
      vi.mocked(prisma.rewardLedger.findMany).mockReset().mockResolvedValue([]);
      vi.mocked(prisma.consentRecord.findMany).mockReset().mockResolvedValue([]);
      vi.mocked(prisma.redemption.findMany).mockReset().mockImplementation((async ({ skip = 0 }: any) => {
        if (skip === 0) return fullBatch as any;
        return [{ id: 'r-last' }] as any;
      }) as any);

      const stream = createUserDataExportStream('u1');
      const reader = stream.getReader();
      let result = '';
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
      }
      result += decoder.decode();
      const parsed = JSON.parse(result);
      expect(parsed.redemptions).toHaveLength(201);
      expect(prisma.redemption.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
