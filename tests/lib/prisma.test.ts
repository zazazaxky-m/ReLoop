import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as encryption from '@/lib/encryption';

vi.mock('@/lib/encryption', () => ({
  encrypt: vi.fn(val => `enc:${val}`),
  decrypt: vi.fn(val => String(val).replace('enc:', '')),
  emailLookupHash: vi.fn(val => `lookup:${String(val).toLowerCase().trim()}`),
  isEncrypted: vi.fn(val => typeof val === 'string' && val.startsWith('enc:')),
}));

const mockExtends = vi.fn();
vi.mock('@prisma/client', () => {
  return {
    PrismaClient: class {
      $extends = mockExtends;
    }
  };
});

describe('prisma extensions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('configures extensions properly', async () => {
    // Import dynamically to trigger the file execution after mocks are set up
    await import('@/lib/prisma');
    
    expect(mockExtends).toHaveBeenCalled();
    const config = mockExtends.mock.calls[0][0];
    
    // Test global $allOperations
    const globalQuery = config.query.$allOperations;
    const globalRes = await globalQuery({ args: {}, query: async () => ({ id: '1', name: 'enc:Test', email: 'enc:test@test.com' }) });
    expect(globalRes.name).toBe('Test');
    expect(globalRes.email).toBe('test@test.com');

    // Test user $allOperations
    const userQuery = config.query.user.$allOperations;
    let queryArgs: any;
    const userRes = await userQuery({
      args: {
        where: { email: 'test@test.com' },
        data: { name: 'Test', email: 'test@test.com', phone: '123' },
        create: { name: 'Test2', email: 'test2@test.com', phone: '1234' },
        update: { name: 'Test3', email: 'test3@test.com', phone: '12345' },
      },
      query: async (a: any) => {
        queryArgs = a;
        return { id: '1', name: 'enc:Test', email: 'enc:test@test.com', phone: 'enc:123' };
      }
    });

    expect(queryArgs.where.email).toBeUndefined();
    expect(queryArgs.where.emailLookup).toBe('lookup:test@test.com');
    expect(queryArgs.data.name).toBe('enc:Test');
    expect(queryArgs.data.email).toBe('enc:test@test.com');
    expect(queryArgs.data.emailLookup).toBe('lookup:test@test.com');
    expect(queryArgs.create.name).toBe('enc:Test2');
    expect(queryArgs.create.emailLookup).toBe('lookup:test2@test.com');
    expect(queryArgs.update.name).toBe('enc:Test3');
    expect(queryArgs.update.emailLookup).toBe('lookup:test3@test.com');

    expect(userRes.name).toBe('Test');
    
    // Test payoutAccount $allOperations
    const payoutQuery = config.query.payoutAccount.$allOperations;
    const payoutRes = await payoutQuery({
      args: { data: { accountIdentifier: '123', accountName: 'Name' } },
      query: async (a: any) => {
        expect(a.data.accountIdentifier).toBe('enc:123');
        return [{ accountIdentifier: 'enc:123', accountName: 'enc:Name' }];
      }
    });
    expect(payoutRes[0].accountIdentifier).toBe('123');

    // Test machineCapture $allOperations
    const captureQuery = config.query.machineCapture.$allOperations;
    const captureRes = await captureQuery({
      args: { data: { facePathsJson: { path: 'a' } } },
      query: async (a: any) => {
        expect(a.data.facePathsJson).toBe('enc:{"path":"a"}');
        return { facePathsJson: 'enc:{"path":"a"}' };
      }
    });
    expect(captureRes.facePathsJson).toEqual({ path: 'a' });
  });

  it('handles edge cases in user operations (equals, in, set) and arrays', async () => {
    await import('@/lib/prisma');
    const config = mockExtends.mock.calls[0][0];
    const userQuery = config.query.user.$allOperations;
    
    let queryArgs: any;
    const res = await userQuery({
      args: {
        where: { email: { equals: 'test@a.com', in: ['b@a.com', 123] } },
        data: { name: { set: 'NewName' } },
        create: {}, // empty create
        update: {}, // empty update
      },
      query: async (a: any) => {
        queryArgs = a;
        return [
          { id: '1', name: 'enc:A' },
          { id: '2', name: 'unencrypted' }
        ];
      }
    });

    expect(queryArgs.where.email).toBeUndefined();
    expect(queryArgs.where.emailLookup.equals).toBe('lookup:test@a.com');
    expect(queryArgs.where.emailLookup.in[0]).toBe('lookup:b@a.com');
    expect(queryArgs.where.emailLookup.in[1]).toBe(123); // ignores non-string
    expect(queryArgs.data.name.set).toBe('enc:NewName');
    
    expect(res[0].name).toBe('A');
    expect(res[1].name).toBe('unencrypted');
  });

  it('handles edge cases in payoutAccount operations (array result, missing fields)', async () => {
    await import('@/lib/prisma');
    const config = mockExtends.mock.calls[0][0];
    const payoutQuery = config.query.payoutAccount.$allOperations;

    const res = await payoutQuery({
      args: { create: {}, update: {} },
      query: async () => {
        return [
          { id: '1', accountIdentifier: 'enc:123', accountName: 'enc:N1' },
          { id: '2', accountIdentifier: 'raw', accountName: 'raw2' },
        ];
      }
    });
    expect(res[0].accountIdentifier).toBe('123');
    expect(res[1].accountIdentifier).toBe('raw');
  });

  it('handles edge cases in machineCapture operations (arrays, corrupt json)', async () => {
    await import('@/lib/prisma');
    const config = mockExtends.mock.calls[0][0];
    const captureQuery = config.query.machineCapture.$allOperations;

    vi.mocked(encryption.decrypt).mockImplementationOnce((val: string) => {
      if (val === 'enc:corrupt') throw new Error('Corrupt');
      return val.replace('enc:', '');
    });

    const res = await captureQuery({
      args: {},
      query: async () => {
        return [
          { id: '1', facePathsJson: 'enc:{"a":1}' },
          { id: '2', facePathsJson: 'enc:corrupt' },
          { id: '3', facePathsJson: null }
        ];
      }
    });
    
    expect(res[0].facePathsJson).toEqual({ a: 1 });
    expect(res[1].facePathsJson).toBe('enc:corrupt'); // Remains unchanged on catch
    expect(res[2].facePathsJson).toBe(null);
  });
  
  it('handles walkAndDecryptUsers with nulls, arrays, and corrupt decryption', async () => {
    await import('@/lib/prisma');
    const config = mockExtends.mock.calls[0][0];
    const globalQuery = config.query.$allOperations;

    vi.mocked(encryption.decrypt).mockImplementationOnce(() => {
      throw new Error('decrypt fail');
    });

    const res = await globalQuery({
      args: {},
      query: async () => [
        null,
        undefined,
        "string-is-ignored",
        { id: '1', name: 'enc:A' }, // will throw internally, returns 'enc:A'
        { notAUser: true },
        { nested: { id: '2', name: 'enc:B' } }
      ]
    });

    expect(res[3].name).toBe('enc:A'); // catch block returns value as is
    expect(res[5].nested.name).toBe('B');
  });

  it('skips empty-string encryption and decrypts payout create/update fields', async () => {
    await import('@/lib/prisma');
    const config = mockExtends.mock.calls[0][0];
    const payoutQuery = config.query.payoutAccount.$allOperations;

    let queryArgs: any;
    await payoutQuery({
      args: {
        data: { accountIdentifier: '' },
        create: { accountIdentifier: 'acc', accountName: 'Nama' },
        update: { accountIdentifier: 'acc2', accountName: 'Nama2' },
      },
      query: async (a: any) => {
        queryArgs = a;
        return { accountIdentifier: 'enc:acc', accountName: 'enc:Nama' };
      },
    });

    expect(queryArgs.data.accountIdentifier).toBe('');
    expect(queryArgs.create.accountIdentifier).toBe('enc:acc');
    expect(queryArgs.update.accountName).toBe('enc:Nama2');
  });

  it('encrypts machineCapture facePathsJson when already a string', async () => {
    await import('@/lib/prisma');
    const config = mockExtends.mock.calls[0][0];
    const captureQuery = config.query.machineCapture.$allOperations;

    await captureQuery({
      args: { data: { facePathsJson: '["a.jpg"]' } },
      query: async (a: any) => {
        expect(a.data.facePathsJson).toBe('enc:["a.jpg"]');
        return { facePathsJson: 'enc:["a.jpg"]' };
      },
    });
  });

  it('leaves non-encrypted user fields untouched in decryptValue', async () => {
    await import('@/lib/prisma');
    const config = mockExtends.mock.calls[0][0];
    const globalQuery = config.query.$allOperations;

    const res = await globalQuery({
      args: {},
      query: async () => ({ id: '1', name: 'plain', email: '', phone: null }),
    });
    expect(res.name).toBe('plain');
    expect(res.email).toBe('');
  });

  it('uses development prisma log level when NODE_ENV is development', async () => {
    const prev = process.env.NODE_ENV;
    delete (globalThis as any).prisma;
    vi.stubEnv('NODE_ENV', 'development');
    try {
      vi.resetModules();
      mockExtends.mockClear();
      await import('@/lib/prisma');
      expect(mockExtends).toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      if (prev !== undefined) (process.env as Record<string, string | undefined>).NODE_ENV = prev;
      delete (globalThis as any).prisma;
    }
  });

  it('looksLikeUser returns false for null and non-objects', async () => {
    await import('@/lib/prisma');
    const config = mockExtends.mock.calls[0][0];
    const globalQuery = config.query.$allOperations;
    const res = await globalQuery({
      args: {},
      query: async () => [null, 42, true],
    });
    expect(res).toEqual([null, 42, true]);
  });

  it('skips looksLikeUser for objects without string id', async () => {
    await import('@/lib/prisma');
    const config = mockExtends.mock.calls[0][0];
    const globalQuery = config.query.$allOperations;
    const res = await globalQuery({
      args: {},
      query: async () => ({ id: 123, name: 'enc:Nope' }),
    });
    expect(res.name).toBe('enc:Nope');
  });

  it('leaves non-string payout accountIdentifier untouched', async () => {
    await import('@/lib/prisma');
    const config = mockExtends.mock.calls[0][0];
    const payoutQuery = config.query.payoutAccount.$allOperations;
    let queryArgs: any;
    await payoutQuery({
      args: { data: { accountIdentifier: 42 } },
      query: async (a: any) => {
        queryArgs = a;
        return {};
      },
    });
    expect(queryArgs.data.accountIdentifier).toBe(42);
  });

  it('encrypts name filter object with equals/set/in via non-deterministic path', async () => {
    await import('@/lib/prisma');
    const config = mockExtends.mock.calls[0][0];
    const userQuery = config.query.user.$allOperations;
    let queryArgs: any;
    await userQuery({
      args: {
        data: {
          name: { equals: 'Alice', set: 'Bob', in: ['C', 9] },
          phone: { equals: '1', set: '2', in: ['3'] },
        },
      },
      query: async (a: any) => {
        queryArgs = a;
        return { id: '1' };
      },
    });
    expect(queryArgs.data.name.equals).toBe('enc:Alice');
    expect(queryArgs.data.name.set).toBe('enc:Bob');
    expect(queryArgs.data.name.in[0]).toBe('enc:C');
    expect(queryArgs.data.phone.equals).toBe('enc:1');
  });

  it('rewrites email filters to emailLookup and encrypts email writes', async () => {
    await import('@/lib/prisma');
    const config = mockExtends.mock.calls[0][0];
    const userQuery = config.query.user.$allOperations;
    let queryArgs: any;
    await userQuery({
      args: {
        where: { email: { equals: 'a@x.com', in: ['c@x.com', 1] } },
        data: { email: { set: 'd@x.com' } },
      },
      query: async (a: any) => {
        queryArgs = a;
        return { id: '1' };
      },
    });
    expect(queryArgs.where.email).toBeUndefined();
    expect(queryArgs.where.emailLookup.equals).toBe('lookup:a@x.com');
    expect(queryArgs.where.emailLookup.in[0]).toBe('lookup:c@x.com');
    expect(queryArgs.data.email.set).toBe('enc:d@x.com');
    expect(queryArgs.data.emailLookup).toBe('lookup:d@x.com');
  });
});

