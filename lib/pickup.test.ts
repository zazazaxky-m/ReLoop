import { describe, expect, it } from 'vitest';
import { resolvePickupTransition, PickupContext, PICKUP_TERMINAL, PICKUP_OPEN, AUTO_PICKUP_FILL_THRESHOLD } from './pickup';

describe('lib/pickup', () => {
  const makeCtx = (overrides: Partial<PickupContext> = {}): PickupContext => ({
    status: 'REQUESTED',
    role: 'ADMIN',
    isAssignedCollector: false,
    isOrgAdmin: true,
    ...overrides,
  });

  describe('resolvePickupTransition', () => {
    it('allows ADMIN to assign REQUESTED pickup', () => {
      const res = resolvePickupTransition('assign', makeCtx({ status: 'REQUESTED', role: 'ADMIN', isOrgAdmin: true }));
      expect(res.ok).toBe(true);
      expect(res.to).toBe('ASSIGNED');
    });

    it('prevents non-org admin from assigning', () => {
      const res = resolvePickupTransition('assign', makeCtx({ status: 'REQUESTED', role: 'ADMIN', isOrgAdmin: false }));
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Hanya admin organisasi');
    });

    it('allows SUPERADMIN to bypass org admin check', () => {
      const res = resolvePickupTransition('assign', makeCtx({ status: 'REQUESTED', role: 'SUPERADMIN', isOrgAdmin: false }));
      expect(res.ok).toBe(true);
      expect(res.to).toBe('ASSIGNED');
    });

    it('allows PENGEPUL to start ASSIGNED pickup if assigned collector', () => {
      const res = resolvePickupTransition('start', makeCtx({ status: 'ASSIGNED', role: 'PENGEPUL', isAssignedCollector: true }));
      expect(res.ok).toBe(true);
      expect(res.to).toBe('ON_THE_WAY');
    });

    it('prevents unassigned PENGEPUL from starting pickup', () => {
      const res = resolvePickupTransition('start', makeCtx({ status: 'ASSIGNED', role: 'PENGEPUL', isAssignedCollector: false }));
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Hanya pengepul yang ditugaskan');
    });

    it('fails if action is unknown', () => {
      const res = resolvePickupTransition('unknown' as any, makeCtx());
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Aksi tidak dikenal');
    });

    it('fails if from status is invalid for action', () => {
      const res = resolvePickupTransition('start', makeCtx({ status: 'REQUESTED', role: 'PENGEPUL', isAssignedCollector: true }));
      expect(res.ok).toBe(false);
      expect(res.error).toContain('tidak bisa di-start');
    });

    it('fails if role is not allowed for action', () => {
      const res = resolvePickupTransition('arrive', makeCtx({ status: 'ON_THE_WAY', role: 'USER', isAssignedCollector: true }));
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Peran tidak diizinkan untuk aksi ini');
    });

    it('progresses through happy path', () => {
      // 1. Assign
      expect(resolvePickupTransition('assign', makeCtx({ status: 'REQUESTED', role: 'ADMIN', isOrgAdmin: true })).to).toBe('ASSIGNED');
      // 2. Start
      expect(resolvePickupTransition('start', makeCtx({ status: 'ASSIGNED', role: 'PENGEPUL', isAssignedCollector: true })).to).toBe('ON_THE_WAY');
      // 3. Arrive
      expect(resolvePickupTransition('arrive', makeCtx({ status: 'ON_THE_WAY', role: 'PENGEPUL', isAssignedCollector: true })).to).toBe('ARRIVED');
      // 4. Collect
      expect(resolvePickupTransition('collect', makeCtx({ status: 'ARRIVED', role: 'PENGEPUL', isAssignedCollector: true })).to).toBe('COLLECTED');
      // 5. Complete
      expect(resolvePickupTransition('complete', makeCtx({ status: 'COLLECTED', role: 'PENGEPUL', isAssignedCollector: true })).to).toBe('COMPLETED');
    });

    it('allows admin to cancel', () => {
      const res = resolvePickupTransition('cancel', makeCtx({ status: 'ASSIGNED', role: 'ADMIN', isOrgAdmin: true }));
      expect(res.ok).toBe(true);
      expect(res.to).toBe('CANCELLED');
    });

    it('allows collector to fail', () => {
      const res = resolvePickupTransition('fail', makeCtx({ status: 'ARRIVED', role: 'PENGEPUL', isAssignedCollector: true }));
      expect(res.ok).toBe(true);
      expect(res.to).toBe('FAILED');
    });
  });

  describe('Constants', () => {
    it('exports terminal states', () => {
      expect(PICKUP_TERMINAL).toContain('COMPLETED');
      expect(PICKUP_TERMINAL).toContain('CANCELLED');
      expect(PICKUP_TERMINAL).toContain('FAILED');
    });

    it('exports open states', () => {
      expect(PICKUP_OPEN).toContain('REQUESTED');
      expect(PICKUP_OPEN).toContain('ON_THE_WAY');
    });

    it('exports threshold', () => {
      expect(AUTO_PICKUP_FILL_THRESHOLD).toBe(90);
    });
  });
});
