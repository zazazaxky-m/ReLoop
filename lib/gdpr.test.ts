import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as gdpr from './gdpr';
import { prisma } from './prisma';
import { logAudit } from './audit';

vi.mock('./prisma', () => ({
  prisma: {
    consentRecord: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    depositSession: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    payoutAccount: {
      deleteMany: vi.fn(),
    },
    rewardLedger: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    redemption: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('./audit', () => ({
  logAudit: vi.fn(),
}));

describe('lib/gdpr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Consent Management', () => {
    it('recordConsent creates a record and logs audit (granted)', async () => {
      await gdpr.recordConsent({
        userId: 'user_1',
        consentType: 'marketing_emails',
        granted: true,
      });

      expect(prisma.consentRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user_1',
          consentType: 'marketing_emails',
          granted: true,
        }),
      });

      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'CONSENT_GIVEN',
        actorId: 'user_1',
      }));
    });

    it('recordConsent creates a record and logs audit (withdrawn)', async () => {
      await gdpr.recordConsent({
        userId: 'user_1',
        consentType: 'marketing_emails',
        granted: false,
      });

      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'CONSENT_WITHDRAWN',
      }));
    });

    it('verifyConsent returns granted value from last record', async () => {
      vi.mocked(prisma.consentRecord.findFirst).mockResolvedValue({ granted: true } as any);
      
      const isGranted = await gdpr.verifyConsent('user_1', 'marketing_emails');
      
      expect(prisma.consentRecord.findFirst).toHaveBeenCalledWith({
        where: { userId: 'user_1', consentType: 'marketing_emails' },
        orderBy: { createdAt: 'desc' },
      });
      expect(isGranted).toBe(true);
    });

    it('verifyConsent returns false if no record exists', async () => {
      vi.mocked(prisma.consentRecord.findFirst).mockResolvedValue(null);
      
      const isGranted = await gdpr.verifyConsent('user_1', 'marketing_emails');
      expect(isGranted).toBe(false);
    });
  });

  describe('Data Erasure', () => {
    it('throws error if user not found', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      await expect(gdpr.processErasureRequest('user_not_found')).rejects.toThrow('User not found');
    });

    it('processes erasure correctly for existing user', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user_1' } as any);
      vi.mocked(prisma.redemption.updateMany).mockResolvedValue({ count: 2 } as any);
      vi.mocked(prisma.redemption.count).mockResolvedValue(0);
      
      const result = await gdpr.processErasureRequest('user_1');
      
      // Check redaction
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user_1' },
        data: expect.objectContaining({
          name: '[REDACTED]',
          status: 'INACTIVE',
        }),
      });

      // Check anonymization
      expect(prisma.depositSession.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
        data: { userId: '[REDACTED]' },
      });

      expect(prisma.rewardLedger.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
        data: { actorId: '[REDACTED]' },
      });

      // Check deletion
      expect(prisma.payoutAccount.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user_1' },
      });

      // Check audit
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'DATA_ERASURE',
        entityId: 'user_1',
      }));

      // Check return payload
      expect(result.steps).toContain('profile_redacted');
      expect(result.steps).toContain('sessions_anonymized');
      expect(result.steps).toContain('payout_accounts_deleted');
      expect(result.steps).toContain('ledger_anonymized');
      // Destination copies on finished redemptions are erased too (M02 snapshot).
      expect(result.steps).toContain('redemption_destinations_erased');
      expect(prisma.redemption.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: { payoutDestinationIdentifier: null, payoutDestinationName: null } }));
    });
  });

  describe('Data Export', () => {
    it('exports all user related data', async () => {
      const mockUser = { id: 'user_1', name: 'John', email: 'john@example.com' };
      vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as any);
      vi.mocked(prisma.depositSession.findMany).mockResolvedValue([{ id: 'sess_1' }] as any);
      vi.mocked(prisma.rewardLedger.findMany).mockResolvedValue([{ id: 'ledg_1' }] as any);
      vi.mocked(prisma.consentRecord.findMany).mockResolvedValue([{ id: 'cons_1' }] as any);
      vi.mocked(prisma.redemption.findMany).mockResolvedValue([{ id: 'red_1' }] as any);

      const result = await gdpr.exportUserData('user_1');

      expect(result.profile?.name).toBe('John');
      expect(result.depositSessions).toHaveLength(1);
      expect(result.ledger).toHaveLength(1);
      expect(result.consents).toHaveLength(1);
      expect(result.redemptions).toHaveLength(1);
      expect(result).toHaveProperty('exportDate');
    });

    it('handles export for non-existent user gracefully (returns null profile)', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.depositSession.findMany).mockResolvedValue([]);
      vi.mocked(prisma.rewardLedger.findMany).mockResolvedValue([]);
      vi.mocked(prisma.consentRecord.findMany).mockResolvedValue([]);
      vi.mocked(prisma.redemption.findMany).mockResolvedValue([]);

      const result = await gdpr.exportUserData('user_1');
      expect(result.profile).toBeNull();
      expect(result.depositSessions).toHaveLength(0);
    });
  });
});
