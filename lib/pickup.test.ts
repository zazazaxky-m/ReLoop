import { describe, expect, it } from 'vitest';
import { resolvePickupTransition, PickupContext, PICKUP_TERMINAL, PICKUP_OPEN, AUTO_PICKUP_FILL_THRESHOLD, PICKUP_REASSIGNABLE, describePickupDispatch, pickupActionRoles } from './pickup';

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

  describe('B05 dispatch rules', () => {
    it('reassigns only before field work starts', () => {
      expect(PICKUP_REASSIGNABLE).toEqual(['REQUESTED', 'ASSIGNED']);
      for (const status of ['ON_THE_WAY', 'ARRIVED', 'COLLECTED', 'COMPLETED', 'FAILED', 'CANCELLED'] as const) {
        expect(resolvePickupTransition('assign', makeCtx({ status }))).toMatchObject({ ok: false, kind: 'status' });
      }
    });

    it('lets an admin cancel started work until the material is loaded', () => {
      for (const status of ['REQUESTED', 'ASSIGNED', 'ON_THE_WAY', 'ARRIVED'] as const) {
        expect(resolvePickupTransition('cancel', makeCtx({ status })).to).toBe('CANCELLED');
      }
      expect(resolvePickupTransition('cancel', makeCtx({ status: 'COLLECTED' }))).toMatchObject({ ok: false, kind: 'status' });
    });

    it('never lets a collector assign, and reports ownership before status', () => {
      expect(pickupActionRoles('assign')).toEqual(['ADMIN', 'SUPERADMIN']);
      expect(resolvePickupTransition('assign', makeCtx({ role: 'PENGEPUL', isOrgAdmin: false })))
        .toMatchObject({ ok: false, kind: 'forbidden' });
      expect(resolvePickupTransition('complete', makeCtx({ status: 'REQUESTED', role: 'PENGEPUL', isAssignedCollector: false })))
        .toMatchObject({ ok: false, kind: 'forbidden' });
    });

    it('describes who acts next and overdue only against the operator deadline', () => {
      const now = new Date('2026-10-14T10:00:00Z');
      expect(describePickupDispatch({ status: 'REQUESTED', expectedStartAt: null }, now))
        .toEqual({ nextStatus: 'ASSIGNED', nextActor: 'ADMIN', nextLabel: 'Menunggu admin menugaskan pengepul', overdue: false, needsReplacement: false });
      expect(describePickupDispatch({ status: 'ASSIGNED', expectedStartAt: null }, now))
        .toMatchObject({ nextStatus: 'ON_THE_WAY', nextActor: 'COLLECTOR', overdue: false });
      expect(describePickupDispatch({ status: 'ASSIGNED', expectedStartAt: '2026-10-14T09:59:59Z' }, now))
        .toMatchObject({ overdue: true, nextLabel: 'Terlambat: pengepul belum berangkat' });
      expect(describePickupDispatch({ status: 'ASSIGNED', expectedStartAt: '2026-10-14T10:00:01Z' }, now).overdue).toBe(false);
      // Started work is never overdue, whatever the deadline.
      expect(describePickupDispatch({ status: 'ON_THE_WAY', expectedStartAt: '2026-10-13T00:00:00Z' }, now).overdue).toBe(false);
    });

    it('asks for one replacement after a cancel/fail', () => {
      expect(describePickupDispatch({ status: 'FAILED', expectedStartAt: null, replacedBy: null }))
        .toMatchObject({ needsReplacement: true, nextActor: 'ADMIN', nextStatus: 'REQUESTED' });
      expect(describePickupDispatch({ status: 'CANCELLED', expectedStartAt: null, replacedBy: { id: 'p2' } }))
        .toMatchObject({ needsReplacement: false, nextActor: null, nextStatus: null });
      expect(describePickupDispatch({ status: 'COMPLETED', expectedStartAt: null }))
        .toMatchObject({ needsReplacement: false, nextLabel: 'Selesai' });
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
