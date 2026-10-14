import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildAuditRow,
  canonicalAuditPayload,
  logAudit,
  logAuditInTransaction,
  redactAuditMetadata,
  verifyAuditChain,
} from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import crypto from 'node:crypto';

type Row = {
  id: string; createdAt: Date; actorId: string | null; action: string; entityType: string; entityId: string | null;
  metadataJson: unknown; previousHash: string | null; checksum: string | null; chainVersion: number; chainSequence: bigint | null;
};

/** In-memory AuditLog that understands exactly the queries lib/audit.ts issues. */
const db = vi.hoisted(() => {
  const state = { rows: [] as any[] };
  function matches(row: any, where: any): boolean {
    for (const [key, cond] of Object.entries(where ?? {})) {
      if (key === 'OR') {
        if (!(cond as any[]).some((c) => matches(row, c))) return false;
        continue;
      }
      const value = row[key];
      if (cond === null) {
        if (value !== null) return false;
      } else if (cond instanceof Date) {
        if (value.getTime() !== cond.getTime()) return false;
      } else if (typeof cond === 'object') {
        const c = cond as { not?: unknown; gt?: any };
        if ('not' in c && (c.not === null ? value === null : value === c.not)) return false;
        if ('gt' in c && !(value > c.gt)) return false;
      } else if (value !== cond) {
        return false;
      }
    }
    return true;
  }
  function sorted(rows: any[], orderBy: any) {
    const orders = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    return [...rows].sort((a, b) => {
      for (const order of orders) {
        const [key, dir] = Object.entries(order)[0] as [string, string];
        if (a[key] < b[key]) return dir === 'asc' ? -1 : 1;
        if (a[key] > b[key]) return dir === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }
  const auditLog = {
    findMany: async ({ where, orderBy, take }: any) => sorted(state.rows.filter((r) => matches(r, where)), orderBy).slice(0, take),
    findFirst: async ({ where, orderBy }: any) => sorted(state.rows.filter((r) => matches(r, where)), orderBy)[0] ?? null,
    create: async ({ data }: any) => {
      const row = { id: `row-${state.rows.length + 1}`, ...data };
      // What PostgreSQL hands back: DbNull is SQL NULL, JSON goes through a text round trip.
      row.metadataJson = typeof data.metadataJson === 'object' && data.metadataJson?.constructor?.name === 'DbNull'
        ? null : JSON.parse(JSON.stringify(data.metadataJson));
      state.rows.push(row);
      return { id: row.id };
    },
  };
  return { state, auditLog, tx: { $executeRaw: async () => 0, auditLog } };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: vi.fn(),
    auditLog: {
      findFirst: vi.fn((args) => db.auditLog.findFirst(args)),
      create: vi.fn(),
      findMany: vi.fn((args) => db.auditLog.findMany(args)),
    },
  },
}));

const useFakeDatabase = () =>
  vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(db.tx));

describe('audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.state.rows = [];
    useFakeDatabase();
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

  describe('canonicalAuditPayload / buildAuditRow', () => {
    const at = new Date('2026-10-14T03:00:00.000Z');

    it('treats omitted and explicit-null optional fields the same', () => {
      const omitted = buildAuditRow({ action: 'A', entityType: 'T' }, at);
      const nulls = buildAuditRow({ action: 'A', entityType: 'T', actorId: null, entityId: null, metadata: null }, at);
      expect(omitted).toEqual(nulls);
      expect(omitted).toEqual({ createdAt: at, actorId: null, action: 'A', entityType: 'T', entityId: null, metadataJson: null });
      expect(canonicalAuditPayload(omitted)).toBe(canonicalAuditPayload(nulls));
      expect(canonicalAuditPayload({ ...omitted, actorId: undefined as unknown as null, metadataJson: undefined }))
        .toBe(canonicalAuditPayload(omitted));
    });

    it('sorts object keys at every depth but keeps array order', () => {
      const a = buildAuditRow({ action: 'A', entityType: 'T', metadata: { b: { y: 1, x: [{ q: 1, p: 2 }] }, a: 1 } }, at);
      const b = buildAuditRow({ action: 'A', entityType: 'T', metadata: { a: 1, b: { x: [{ p: 2, q: 1 }], y: 1 } } }, at);
      expect(canonicalAuditPayload(a)).toBe(canonicalAuditPayload(b));
      const c = buildAuditRow({ action: 'A', entityType: 'T', metadata: { a: 1, b: { x: [{ p: 2, q: 1 }, 2], y: 1 } } }, at);
      expect(canonicalAuditPayload(c)).not.toBe(canonicalAuditPayload(a));
    });

    it('stores metadata in the form PostgreSQL returns, redacted', () => {
      const when = new Date('2026-01-02T03:04:05.000Z');
      const row = buildAuditRow({
        action: 'A', entityType: 'T',
        metadata: { gone: undefined, inf: Infinity, token: 'x', list: [undefined, 1, when] },
      }, at);
      expect(row.metadataJson).toEqual({ inf: null, token: '[REDACTED]', list: [null, 1, '2026-01-02T03:04:05.000Z'] });
      // The canonical form normalizes the same way when handed raw values.
      expect(canonicalAuditPayload({ ...row, metadataJson: { list: [undefined, 1, when], inf: Infinity, token: '[REDACTED]', gone: undefined } }))
        .toBe(canonicalAuditPayload(row));
    });

    it('covers every stored field and the format version', () => {
      const base = buildAuditRow({ actorId: 'u1', action: 'A', entityType: 'T', entityId: 'e1', metadata: { n: 1 } }, at);
      const canonical = canonicalAuditPayload(base);
      expect(JSON.parse(canonical)).toEqual({
        v: 2, createdAt: '2026-10-14T03:00:00.000Z', actorId: 'u1', action: 'A', entityType: 'T', entityId: 'e1', metadataJson: { n: 1 },
      });
      for (const changed of [
        { ...base, createdAt: new Date(at.getTime() + 1) }, { ...base, actorId: null }, { ...base, action: 'B' },
        { ...base, entityType: 'U' }, { ...base, entityId: null }, { ...base, metadataJson: { n: 2 } },
      ]) {
        expect(canonicalAuditPayload(changed)).not.toBe(canonical);
      }
    });
  });

  describe('logAudit', () => {
    it('creates audit log with correct checksum', async () => {
      vi.mocked(prisma.$transaction).mockImplementation(async (cb) => {
        const tx = {
          $executeRaw: vi.fn(),
          auditLog: {
            findFirst: vi.fn().mockResolvedValue({ checksum: 'prev-hash', chainSequence: 41n }),
            create: vi.fn().mockResolvedValue({ id: 'new' }),
          },
        };
        await (cb as any)(tx);
        expect(tx.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
          where: { chainSequence: { not: null } },
          orderBy: { chainSequence: 'desc' },
        }));
        expect(tx.auditLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              action: 'TEST',
              previousHash: 'prev-hash',
              chainVersion: 2,
              chainSequence: 42n,
              checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
            })
          })
        );
        // The chain lock is taken before the head is read.
        expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.auditLog.findFirst.mock.invocationCallOrder[0]);
      });

      await logAudit({ action: 'TEST', entityType: 'USER' });
      expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'ReadCommitted' });
    });

    it('stores the hashed timestamp and starts the chain at sequence 1', async () => {
      await logAudit({ action: 'FIRST', entityType: 'T' });
      await logAudit({ action: 'SECOND', entityType: 'T', metadata: { z: 1, a: { c: 2, b: 1 } } });
      const [first, second] = db.state.rows as Row[];
      expect(first).toMatchObject({ chainVersion: 2, chainSequence: 1n, previousHash: null, metadataJson: null });
      expect(second).toMatchObject({ chainSequence: 2n, previousHash: first.checksum });
      expect(first.createdAt).toBeInstanceOf(Date);
      expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedCount: 2 });
    });

    it('logAuditInTransaction appends through the same writer and throws instead of swallowing', async () => {
      await logAuditInTransaction(db.tx as any, { action: 'IN_TX', entityType: 'T' });
      expect(db.state.rows).toHaveLength(1);
      expect(db.state.rows[0]).toMatchObject({ chainVersion: 2, chainSequence: 1n });
      const failing = { $executeRaw: vi.fn().mockRejectedValue(new Error('lock failed')), auditLog: db.auditLog };
      await expect(logAuditInTransaction(failing as any, { action: 'X', entityType: 'T' })).rejects.toThrow('lock failed');
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

      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      await logAudit({ action: 'TEST', entityType: 'USER' });
      consoleError.mockRestore();
      expect(caughtError).toBeInstanceOf(Error);
      expect((caughtError as any).message).toMatch(/AUDIT_CHECKSUM_SECRET must be set/);

      (process.env as Record<string, string | undefined>).NODE_ENV = origEnv;
    });

    it('uses configured AUDIT_CHECKSUM_SECRET when set', async () => {
      await logAudit({ action: 'TEST', entityType: 'USER' });
      const withDefault = (db.state.rows as Row[])[0];
      db.state.rows = [];
      process.env.AUDIT_CHECKSUM_SECRET = 'custom-audit-secret';
      await logAudit({ action: 'TEST', entityType: 'USER' });
      const withCustom = (db.state.rows as Row[])[0];
      const expected = crypto.createHmac('sha256', 'custom-audit-secret')
        .update(`reloop-audit-v2\n1\n\n${canonicalAuditPayload(withCustom)}`).digest('hex');
      expect(withCustom.checksum).toBe(expected);
      expect(withCustom.checksum).not.toBe(withDefault.checksum);
    });
  });

  describe('verifyAuditChain', () => {
    async function writeChain(count: number) {
      for (let n = 1; n <= count; n += 1) {
        await logAudit({ actorId: `u${n}`, action: `T${n}`, entityType: 'USER', entityId: `e${n}`, metadata: { n } });
      }
      return [...db.state.rows] as Row[];
    }

    it('returns valid with the v2 and legacy fields when the chain is correct', async () => {
      await writeChain(2);
      expect(await verifyAuditChain()).toEqual({
        valid: true, checkedVersion: 2, checkedCount: 2, legacyStatus: 'not-present', legacyCount: 0, legacyCheckpoint: 'not-required',
      });
    });

    it('returns invalid with the broken row and the reason', async () => {
      let rows = await writeChain(3);
      rows[1].action = 'ALTERED';
      expect(await verifyAuditChain()).toMatchObject({ valid: false, brokenAt: rows[1].id, reason: 'checksum' });

      db.state.rows = []; rows = await writeChain(3);
      rows[2].previousHash = rows[0].checksum;
      expect(await verifyAuditChain()).toMatchObject({ valid: false, brokenAt: rows[2].id, reason: 'previous-hash' });

      db.state.rows = []; rows = await writeChain(3);
      db.state.rows.splice(1, 1);
      expect(await verifyAuditChain()).toMatchObject({ valid: false, brokenAt: rows[2].id, reason: 'sequence' });

      db.state.rows = []; rows = await writeChain(3);
      [rows[1].chainSequence, rows[2].chainSequence] = [rows[2].chainSequence, rows[1].chainSequence];
      expect(await verifyAuditChain()).toMatchObject({ valid: false, brokenAt: rows[2].id, reason: 'previous-hash' });

      db.state.rows = []; rows = await writeChain(2);
      rows[1].chainVersion = 3;
      expect(await verifyAuditChain()).toMatchObject({ valid: false, brokenAt: rows[1].id, reason: 'version' });

      db.state.rows = []; rows = await writeChain(2);
      rows[1].chainSequence = null;
      expect(await verifyAuditChain()).toMatchObject({ valid: false, brokenAt: rows[1].id, reason: 'sequence' });
    });

    it('orders by chainSequence, not by timestamp', async () => {
      const rows = await writeChain(3);
      // Same verification whatever the timestamps or physical order.
      db.state.rows.reverse();
      expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedCount: 3 });
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { chainSequence: 'asc' } }));
      expect(rows.map((row) => row.chainSequence)).toEqual([1n, 2n, 3n]);
    });

    it('paginates over multiple batches', async () => {
      await writeChain(3);
      expect(await verifyAuditChain({ batchSize: 1 })).toMatchObject({ valid: true, checkedCount: 3 });
      const v2Pages = vi.mocked(prisma.auditLog.findMany).mock.calls.filter(([args]: any[]) => 'chainSequence' in args.where);
      expect(v2Pages).toHaveLength(4);
      expect(v2Pages.map(([args]: any[]) => args.where.chainSequence)).toEqual([{ not: null }, { gt: 1n }, { gt: 2n }, { gt: 3n }]);
    });

    it('reports legacy rows separately and never as valid unless every stored checksum matches', async () => {
      await writeChain(1);
      const secret = 'audit-secret-change-me';
      const legacy = (id: string, createdAt: string, previousHash: string | null, checksum: string): Row => ({
        id, createdAt: new Date(createdAt), actorId: null, action: 'OLD', entityType: 'USER', entityId: null,
        metadataJson: null, previousHash, checksum, chainVersion: 1, chainSequence: null,
      });
      const payload = (row: Row) => JSON.stringify({
        ts: row.createdAt.toISOString(), actor: row.actorId, action: row.action, entity: `${row.entityType}:${row.entityId}`, meta: row.metadataJson,
      });
      const first = legacy('legacy-1', '2026-07-01T00:00:00.000Z', null, '');
      first.checksum = crypto.createHash('sha256').update(payload(first) + secret).digest('hex');
      const second = legacy('legacy-2', '2026-07-02T00:00:00.000Z', first.checksum, '');
      second.checksum = crypto.createHash('sha256').update(first.checksum + payload(second) + secret).digest('hex');
      db.state.rows.push(first, second);
      expect(await verifyAuditChain()).toMatchObject({ valid: true, checkedCount: 1, legacyStatus: 'valid', legacyCount: 2, legacyCheckpoint: 'missing' });

      second.checksum = 'f'.repeat(64);
      expect(await verifyAuditChain()).toMatchObject({ valid: true, legacyStatus: 'unverifiable', legacyCount: 2 });
    });
  });
});
