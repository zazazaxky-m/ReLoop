import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as mc from './machine-captures';
import { prisma } from './prisma';
import path from 'node:path';

vi.mock('./prisma', () => ({
  prisma: {
    machineCapture: { findMany: vi.fn() },
  },
}));

describe('lib/machine-captures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveCapturePath', () => {
    it('resolves valid relative paths inside the capture root', () => {
      const resolved = mc.resolveCapturePath('some-image.jpg');
      expect(resolved.startsWith(mc.captureStorageRoot)).toBe(true);
      expect(resolved).toBe(path.join(mc.captureStorageRoot, 'some-image.jpg'));
    });

    it('prevents directory traversal attacks', () => {
      expect(() => mc.resolveCapturePath('../../../etc/passwd')).toThrow('Path bukti kamera tidak valid');
    });
  });

  describe('getMachineCaptures', () => {
    it('fetches captures and formats them correctly', async () => {
      const now = new Date();
      vi.mocked(prisma.machineCapture.findMany).mockResolvedValue([
        {
          id: 'cap_1',
          kind: 'FACE',
          reason: 'FRAUD_DETECTED',
          faceCount: 1,
          personDetected: true,
          occurredAt: now,
          receivedAt: now,
          sessionId: 'sess_1',
          metadataJson: { conf: 0.99 },
          machineId: 'mach_1',
          relativePath: 'image.jpg',
        }
      ] as any);

      const captures = await mc.getMachineCaptures('mach_1');
      
      expect(prisma.machineCapture.findMany).toHaveBeenCalledWith({
        where: { machineId: 'mach_1' },
        orderBy: { occurredAt: 'desc' },
        take: 24,
      });

      expect(captures).toHaveLength(1);
      expect(captures[0]).toEqual({
        id: 'cap_1',
        kind: 'FACE',
        reason: 'FRAUD_DETECTED',
        faceCount: 1,
        personDetected: true,
        occurredAt: now,
        receivedAt: now,
        sessionId: 'sess_1',
        metadata: { conf: 0.99 },
      });
    });
  });

  describe('jsonValue', () => {
    it('returns undefined if value is null or undefined', () => {
      expect(mc.jsonValue(null)).toBeUndefined();
      expect(mc.jsonValue(undefined)).toBeUndefined();
    });

    it('returns the value casted to InputJsonValue otherwise', () => {
      const obj = { key: 'value' };
      expect(mc.jsonValue(obj)).toBe(obj as any);
    });
  });
});
