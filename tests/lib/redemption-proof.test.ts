import { describe, expect, it, vi } from 'vitest';
import { resolveProofPath, hasValidImageSignature } from '@/lib/redemption-proof';
import path from 'node:path';

describe('redemption-proof', () => {
  describe('resolveProofPath', () => {
    it('resolves valid relative paths', () => {
      const resolved = resolveProofPath('file.jpg');
      expect(resolved.endsWith('file.jpg')).toBe(true);
      expect(resolved.includes('redemption-proofs')).toBe(true);
    });

    it('throws error for directory traversal attempts', () => {
      expect(() => resolveProofPath('../file.jpg')).toThrow('Path bukti transfer tidak valid');
      expect(() => resolveProofPath('../../etc/passwd')).toThrow('Path bukti transfer tidak valid');
    });

    it('uses REDEMPTION_PROOF_STORAGE_DIR when provided', async () => {
      vi.resetModules();
      vi.stubEnv('REDEMPTION_PROOF_STORAGE_DIR', '/custom/path');
      
      const mod = await import('@/lib/redemption-proof');
      const resolved = mod.resolveProofPath('file.jpg');
      
      expect(resolved.startsWith(path.resolve('/custom/path'))).toBe(true);
      expect(resolved.endsWith('file.jpg')).toBe(true);
      
      vi.unstubAllEnvs();
      vi.resetModules();
    });
  });

  describe('hasValidImageSignature', () => {
    it('validates JPEG signature', () => {
      const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
      expect(hasValidImageSignature(jpeg, 'image/jpeg')).toBe(true);
      
      const invalid = new Uint8Array([0xff, 0x00, 0xff, 0x00]);
      expect(hasValidImageSignature(invalid, 'image/jpeg')).toBe(false);
    });

    it('validates PNG signature', () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00]);
      expect(hasValidImageSignature(png, 'image/png')).toBe(true);
      
      const invalid = new Uint8Array([0x89, 0x50, 0x00, 0x00, 0x00]);
      expect(hasValidImageSignature(invalid, 'image/png')).toBe(false);
    });

    it('validates WebP signature', () => {
      const webp = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 
        0x57, 0x45, 0x42, 0x50, 0x00
      ]);
      expect(hasValidImageSignature(webp, 'image/webp')).toBe(true);
      
      const invalid = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 
        0x00, 0x00, 0x00, 0x00, 0x00
      ]);
      expect(hasValidImageSignature(invalid, 'image/webp')).toBe(false);
    });
  });
});
