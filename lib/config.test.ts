import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as config from './config';
import { prisma } from './prisma';

vi.mock('./prisma', () => ({
  prisma: {
    systemConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

describe('lib/config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getConfig', () => {
    it('returns value from database if exists', async () => {
      vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue({ key: 'test_key', value: 'db_value' } as any);
      
      const value = await config.getConfig('test_key');
      expect(prisma.systemConfig.findUnique).toHaveBeenCalledWith({ where: { key: 'test_key' } });
      expect(value).toBe('db_value');
    });

    it('returns default value if not in DB but exists in defaults', async () => {
      vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
      
      const value = await config.getConfig(config.CONFIG_KEYS.MIN_REDEMPTION);
      expect(value).toBe(config.CONFIG_DEFAULTS[config.CONFIG_KEYS.MIN_REDEMPTION]);
    });

    it('returns empty string if not in DB and no default', async () => {
      vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue(null);
      
      const value = await config.getConfig('unknown_key');
      expect(value).toBe('');
    });
  });

  describe('getConfigInt', () => {
    it('parses DB value to integer', async () => {
      vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue({ key: 'test_int', value: '42' } as any);
      const value = await config.getConfigInt('test_int');
      expect(value).toBe(42);
    });

    it('returns 0 if value cannot be parsed', async () => {
      vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue({ key: 'test_int', value: 'not_a_number' } as any);
      const value = await config.getConfigInt('test_int');
      expect(value).toBe(0);
    });
  });

  describe('setConfig', () => {
    it('upserts config in database', async () => {
      vi.mocked(prisma.systemConfig.upsert).mockResolvedValue({ key: 'test', value: 'val' } as any);
      
      await config.setConfig('test', 'val');
      
      expect(prisma.systemConfig.upsert).toHaveBeenCalledWith({
        where: { key: 'test' },
        update: { value: 'val' },
        create: { key: 'test', value: 'val' },
      });
    });
  });

  describe('getMinRedemption', () => {
    it('returns min redemption as integer', async () => {
      vi.mocked(prisma.systemConfig.findUnique).mockResolvedValue({ key: config.CONFIG_KEYS.MIN_REDEMPTION, value: '5000' } as any);
      const val = await config.getMinRedemption();
      expect(val).toBe(5000);
    });
  });

  describe('getAllConfig', () => {
    it('merges DB values with defaults', async () => {
      vi.mocked(prisma.systemConfig.findMany).mockResolvedValue([
        { key: config.CONFIG_KEYS.MIN_REDEMPTION, value: '20000' },
        { key: 'custom_key', value: 'custom' }
      ] as any);

      const all = await config.getAllConfig();
      
      expect(all[config.CONFIG_KEYS.MIN_REDEMPTION]).toBe('20000'); // overwritten
      expect(all['custom_key']).toBe('custom'); // new
      expect(all[config.CONFIG_KEYS.DEFAULT_QR_ROTATION_SECONDS]).toBe(config.CONFIG_DEFAULTS[config.CONFIG_KEYS.DEFAULT_QR_ROTATION_SECONDS]); // default
    });
  });
});
