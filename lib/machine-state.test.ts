import { describe, expect, it } from 'vitest';
import * as ms from './machine-state';

describe('lib/machine-state', () => {
  describe('canTransitionSession', () => {
    it('returns next state if valid', () => {
      expect(ms.canTransitionSession('RESERVED', 'ACTIVATE')).toBe('ACTIVE');
      expect(ms.canTransitionSession('ACTIVE', 'START_ITEM')).toBe('PROCESSING_ITEM');
    });

    it('returns null if action invalid for current state', () => {
      expect(ms.canTransitionSession('RESERVED', 'FINISH')).toBeNull();
      expect(ms.canTransitionSession('COMPLETED', 'ACTIVATE')).toBeNull();
    });
  });

  describe('transitionSession', () => {
    it('returns next state if valid', () => {
      expect(ms.transitionSession('PROCESSING_ITEM', 'ITEM_DONE')).toBe('ACTIVE');
    });

    it('throws error if invalid', () => {
      expect(() => ms.transitionSession('CANCELLED', 'ACTIVATE')).toThrow(/Transisi sesi tidak valid/);
    });
  });

  describe('machineAcceptsSessions', () => {
    it('returns false for blocking statuses', () => {
      expect(ms.machineAcceptsSessions('OFFLINE')).toBe(false);
      expect(ms.machineAcceptsSessions('FULL')).toBe(false);
      expect(ms.machineAcceptsSessions('MAINTENANCE')).toBe(false);
      expect(ms.machineAcceptsSessions('ERROR')).toBe(false);
    });

    it('returns true for other statuses', () => {
      expect(ms.machineAcceptsSessions('ONLINE')).toBe(true);
      expect(ms.machineAcceptsSessions('IDLE')).toBe(true);
    });
  });

  describe('validateSensorSequence', () => {
    it('returns null if payload is empty', () => {
      expect(ms.validateSensorSequence(null)).toBeNull();
      expect(ms.validateSensorSequence(undefined)).toBeNull();
      expect(ms.validateSensorSequence({})).toBeNull();
    });

    it('returns explicit anomaly flags', () => {
      expect(ms.validateSensorSequence({ reverseMotion: true })).toBe('REVERSE_MOTION');
      expect(ms.validateSensorSequence({ retrievalAttempt: true })).toBe('RETRIEVAL_ATTEMPT');
      expect(ms.validateSensorSequence({ impossibleSequence: true })).toBe('IMPOSSIBLE_SEQUENCE');
    });

    it('validates correct forward sequences', () => {
      expect(ms.validateSensorSequence({ steps: ['CHAMBER_OPEN', 'ITEM_PRESENT'] })).toBeNull();
      expect(ms.validateSensorSequence({ steps: ['ITEM_PRESENT', 'WEIGHT_STABLE', 'ACCEPTANCE_POINT'] })).toBeNull();
    });

    it('detects backward sequences', () => {
      expect(ms.validateSensorSequence({ steps: ['WEIGHT_STABLE', 'ITEM_PRESENT'] })).toBe('IMPOSSIBLE_SEQUENCE');
    });

    it('ignores unknown step names while validating', () => {
      expect(ms.validateSensorSequence({ steps: ['UNKNOWN', 'ITEM_PRESENT', 'WEIGHT_STABLE'] })).toBeNull();
    });
  });
});
