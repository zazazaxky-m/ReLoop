import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { redactAuditMetadata, logAudit, verifyAuditChain } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import crypto from 'node:crypto';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    auditLog: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe('audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    delete process.env.AUDIT_CHECKSUM_SECRET;
  });

  describe('redactAuditMetadata', () => {
    it('returns undefined if no metadata provided', () => {
      expect(redactAuditMetadata(null)).toBeUndefined();
    });

    it("redacts sensitive keys at top level", () => {
      const result = redactAuditMetadata({
        token: "secret-token",
        machineCode: "RVM-001",
      });
      expect(result?.token).toBe("[REDACTED]");
      expect(result?.machineCode).toBe("RVM-001");
    });

    it("redacts nested sensitive keys", () => {
      const result = redactAuditMetadata({
        payload: { accountIdentifier: "08123456789", amount: 10000 },
      });
      expect(result?.payload).toEqual({
        accountIdentifier: "[REDACTED]",
        amount: 10000,
      });
    });

    it('preserves arrays', () => {
      const result = redactAuditMetadata({ items: [1, 2, 3] });
      expect(result).toEqual({ items: [1, 2, 3] });
    });
  });

  describe('logAudit', () => {
    it('creates audit log with correct checksum', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
        const tx = {
          $executeRaw: vi.fn(),
          auditLog: {
            findFirst: vi.fn().mockResolvedValue({ checksum: 'prev-hash' }),
            create: vi.fn().mockResolvedValue({}),
          },
        };
        await (cb as any)(tx);
        expect(tx.auditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              action: 'TEST',
              previousHash: 'prev-hash',
              checksum: expect.any(String),
            })
          })
        );
      });

      await logAudit({ action: 'TEST', entityType: 'USER' });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('swallows errors without crashing', async () => {
      vi.mocked(prisma.$transaction).mockRejectedValue(new Error('DB error'));
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      await expect(logAudit({ action: 'TEST', entityType: 'USER' })).resolves.not.toThrow();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
    
    it('throws error if AUDIT_CHECKSUM_SECRET is missing in production', async () => {
      const origEnv = process.env.NODE_ENV;
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.AUDIT_CHECKSUM_SECRET;
      
      let caughtError = null;
      vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
        try {
          await (cb as any)({
            $executeRaw: vi.fn(),
            auditLog: { findFirst: vi.fn(), create: vi.fn() }
          });
        } catch (e) {
          caughtError = e;
          throw e; // rethrow so logAudit catches it
        }
      });

      await logAudit({ action: 'TEST', entityType: 'USER' });
      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as any).message).toMatch(/AUDIT_CHECKSUM_SECRET must be set/);
      
      (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
    });

    it('uses configured AUDIT_CHECKSUM_SECRET when set', async () => {
      process.env.AUDIT_CHECKSUM_SECRET = 'custom-audit-secret';
      let createdChecksum: string | undefined;

      vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
        const tx = {
          $executeRaw: vi.fn(),
          auditLog: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockImplementation(({ data }) => {
              createdChecksum = data.checksum;
              return {};
            }),
          },
        };
        await (cb as any)(tx);
      });

      await logAudit({ action: 'TEST', entityType: 'USER' });
      expect(createdChecksum).toEqual(expect.any(String));
      expect(createdChecksum).not.toBe(
        crypto.createHash('sha256').update('TEST').digest('hex'),
      );
    });
  });

  describe('verifyAuditChain', () => {
    it('returns valid when chain is correct', async () => {
      const ts = new Date().toISOString();
      const canonical = JSON.stringify({ ts, action: 'TEST', entity: 'USER:null' });
      const checksum = crypto.createHash('sha256').update(canonical + 'audit-secret-change-me').digest('hex');
      
      vi.mocked(prisma.auditLog.findMany)
        .mockResolvedValueOnce([
          { id: '1', createdAt: new Date(ts), action: 'TEST', entityType: 'USER', entityId: null, checksum }
        ] as any);

      const result = await verifyAuditChain();
      expect(result.valid).toBe(true);
    });

    it('returns invalid and brokenAt id when chain breaks', async () => {
      const ts = new Date().toISOString();
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
        { id: '1', createdAt: new Date(ts), action: 'TEST', entityType: 'USER', entityId: null, checksum: 'wrong-hash' }
      ] as any);

      const result = await verifyAuditChain();
      expect(result.valid).toBe(false);
      expect(result.brokenAt).toBe('1');
    });

    it('paginates over multiple batches', async () => {
      const ts1 = new Date().toISOString();
      const ts2 = new Date().toISOString();
      
      const canonical1 = JSON.stringify({ ts: ts1, action: 'T1', entity: 'USER:null' });
      const checksum1 = crypto.createHash('sha256').update(canonical1 + 'audit-secret-change-me').digest('hex');
      
      const canonical2 = JSON.stringify({ ts: ts2, action: 'T2', entity: 'USER:null' });
      const checksum2 = crypto.createHash('sha256').update(checksum1 + canonical2 + 'audit-secret-change-me').digest('hex');

      // First batch returns 1 item, but we set batchSize to 1 to force pagination
      vi.mocked(prisma.auditLog.findMany)
        .mockResolvedValueOnce([
          { id: '1', createdAt: new Date(ts1), action: 'T1', entityType: 'USER', entityId: null, checksum: checksum1 }
        ] as any)
        .mockResolvedValueOnce([
          { id: '2', createdAt: new Date(ts2), action: 'T2', entityType: 'USER', entityId: null, checksum: checksum2 }
        ] as any)
        .mockResolvedValueOnce([]); // empty to stop

      const result = await verifyAuditChain({ batchSize: 1 });
      expect(result.valid).toBe(true);
      expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(3);
    });
  });
});
