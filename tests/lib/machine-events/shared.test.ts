import { describe, expect, it } from 'vitest';
import {
  UNKNOWN_WASTE_TYPE_NAME,
  isReviewFinal,
  isUnknownWasteTypeItem,
  machineReasonCode,
} from '@/lib/machine-events/shared';

describe('machine-events shared (M04 fix round 1)', () => {
  it('machine reasons can never take a server-reserved review code (C1)', () => {
    expect(machineReasonCode('REVIEW_REJECTED', 'REJECTED')).toBe('MACHINE_REVIEW_REJECTED');
    expect(machineReasonCode('review_approved', 'REJECTED')).toBe('MACHINE_review_approved');
    expect(machineReasonCode(' REVIEW_ADJUSTMENT ', 'X')).toBe('MACHINE_REVIEW_ADJUSTMENT');
    expect(machineReasonCode('ABNORMAL_ITEM_WEIGHT', 'REJECTED')).toBe('ABNORMAL_ITEM_WEIGHT');
    expect(machineReasonCode(undefined, 'REJECTED')).toBe('REJECTED');
    expect(machineReasonCode('   ', 'FRAUD_DETECTED')).toBe('FRAUD_DETECTED');
    expect(machineReasonCode({ toString: () => 'REVIEW_APPROVED' }, 'FRAUD_DETECTED')).toBe('FRAUD_DETECTED');
    expect(machineReasonCode('X'.repeat(200), 'R')).toHaveLength(64);
  });

  it("finality needs the reviewer's status and code together", () => {
    expect(isReviewFinal({ status: 'ACCEPTED', validationReasonCode: 'REVIEW_APPROVED' })).toBe(true);
    expect(isReviewFinal({ status: 'REJECTED', validationReasonCode: 'REVIEW_REJECTED' })).toBe(true);
    expect(isReviewFinal({ status: 'REVIEW', validationReasonCode: 'REVIEW_APPROVED' })).toBe(false);
    expect(isReviewFinal({ status: 'REJECTED', validationReasonCode: 'REVIEW_APPROVED' })).toBe(false);
    expect(isReviewFinal({ status: 'REJECTED', validationReasonCode: 'MACHINE_REVIEW_REJECTED' })).toBe(false);
  });

  it('recognizes an unknown-type item by its fallback waste type, not only by its reason (C3)', () => {
    const fallback = { name: UNKNOWN_WASTE_TYPE_NAME, organizationId: null };
    expect(isUnknownWasteTypeItem({ validationReasonCode: 'UNKNOWN_WASTE_TYPE', wasteType: { name: 'Plastik', organizationId: null } })).toBe(true);
    expect(isUnknownWasteTypeItem({ validationReasonCode: 'REVERSE_MOTION', wasteType: fallback })).toBe(true);
    expect(isUnknownWasteTypeItem({ validationReasonCode: null, wasteType: { name: UNKNOWN_WASTE_TYPE_NAME, organizationId: 'org1' } })).toBe(false);
    expect(isUnknownWasteTypeItem({ validationReasonCode: 'ACCEPTED', wasteType: { name: 'Plastik', organizationId: null } })).toBe(false);
  });
});
