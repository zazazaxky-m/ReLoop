import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as qr from './qr';
import { prisma } from './prisma';
import QRCode from 'qrcode';

vi.mock('./prisma', () => ({
  prisma: {
    machine: { update: vi.fn() },
  },
}));

vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(),
  },
}));

describe('lib/qr', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateToken', () => {
    it('generates a random string token', () => {
      const token1 = qr.generateToken();
      const token2 = qr.generateToken();
      expect(typeof token1).toBe('string');
      expect(token1.length).toBeGreaterThan(20);
      expect(token1).not.toBe(token2);
    });
  });

  describe('baseUrl', () => {
    it('returns NEXT_PUBLIC_BASE_URL if set', () => {
      process.env.NEXT_PUBLIC_BASE_URL = 'https://reloop.id';
      expect(qr.baseUrl()).toBe('https://reloop.id');
    });

    it('returns localhost if not set', () => {
      delete process.env.NEXT_PUBLIC_BASE_URL;
      expect(qr.baseUrl()).toBe('http://localhost:3000');
    });
  });

  describe('buildScanUrl', () => {
    it('builds a valid scan URL', () => {
      process.env.NEXT_PUBLIC_BASE_URL = 'https://reloop.id';
      const url = qr.buildScanUrl('MAC001', 'token123');
      expect(url).toBe('https://reloop.id/scan?m=MAC001&t=token123');
    });
  });

  describe('qrDataUrl', () => {
    it('calls QRCode.toDataURL with text and options', async () => {
      vi.mocked(QRCode.toDataURL).mockResolvedValue('data:image/png;base64,mock' as any);
      const res = await qr.qrDataUrl('https://reloop.id');
      expect(res).toBe('data:image/png;base64,mock');
      expect(QRCode.toDataURL).toHaveBeenCalledWith('https://reloop.id', expect.any(Object));
    });
  });

  describe('isTokenValid', () => {
    it('returns false if machine has no token', () => {
      expect(qr.isTokenValid({ qrToken: null, qrTokenExpiresAt: null }, 't')).toBe(false);
    });

    it('returns false if token does not match', () => {
      const machine = { qrToken: 'valid', qrTokenExpiresAt: new Date(Date.now() + 10000) };
      expect(qr.isTokenValid(machine, 'invalid')).toBe(false);
    });

    it('returns false if token is expired', () => {
      const machine = { qrToken: 'valid', qrTokenExpiresAt: new Date(Date.now() - 10000) };
      expect(qr.isTokenValid(machine, 'valid')).toBe(false);
    });

    it('returns true if token matches and is not expired', () => {
      const machine = { qrToken: 'valid', qrTokenExpiresAt: new Date(Date.now() + 10000) };
      expect(qr.isTokenValid(machine, 'valid')).toBe(true);
    });
  });

  describe('rotateToken', () => {
    it('updates machine with new token and expiry', async () => {
      vi.mocked(prisma.machine.update).mockResolvedValue({} as any);
      const res = await qr.rotateToken('mach_1', 30);
      
      expect(res.token).toBeDefined();
      expect(res.expiresAt.getTime()).toBeGreaterThan(Date.now());
      
      expect(prisma.machine.update).toHaveBeenCalledWith({
        where: { id: 'mach_1' },
        data: {
          qrToken: res.token,
          qrTokenExpiresAt: res.expiresAt,
        }
      });
    });
  });
});
