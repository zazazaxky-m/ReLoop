import { describe, expect, it } from 'vitest';
import { calculateCompliance, normalizeTravelAgentEmail } from '@/lib/tourism';

describe('tourism', () => {
  it('normalizes travel agent email', () => {
    expect(normalizeTravelAgentEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });

  it('scores CHECK_IN with and without appCompleted', () => {
    expect(calculateCompliance({ stage: 'CHECK_IN', appCompleted: true })).toEqual({
      score: 30,
      status: 'CHECKED_IN',
    });
    expect(calculateCompliance({ stage: 'CHECK_IN' })).toEqual({
      score: 0,
      status: 'CHECKED_IN',
    });
  });

  it('marks BANK_SAMPAH_PICKUP as fully compliant', () => {
    expect(calculateCompliance({ stage: 'BANK_SAMPAH_PICKUP' })).toEqual({
      score: 100,
      status: 'COMPLIANT',
    });
  });

  it('scores CHECK_OUT return and condition branches', () => {
    expect(
      calculateCompliance({
        stage: 'CHECK_OUT',
        appCompleted: true,
        assignedBagCount: 0,
        returnedBagCount: 1,
        conditionStatus: 'GOOD',
      }).score,
    ).toBe(100);

    expect(
      calculateCompliance({
        stage: 'CHECK_OUT',
        assignedBagCount: 0,
        returnedBagCount: 0,
        conditionStatus: 'PARTIAL',
      }).score,
    ).toBe(20);

    expect(
      calculateCompliance({
        stage: 'CHECK_OUT',
        assignedBagCount: 2,
        returnedBagCount: 2,
        conditionStatus: 'POOR',
      }).score,
    ).toBe(40);

    expect(
      calculateCompliance({
        stage: 'CHECK_OUT',
        assignedBagCount: 2,
        returnedBagCount: 1,
        conditionStatus: 'NOT_RETURNED',
      }).score,
    ).toBe(20);

    expect(
      calculateCompliance({
        stage: 'CHECK_OUT',
        assignedBagCount: 2,
        returnedBagCount: null,
        conditionStatus: undefined,
      }).score,
    ).toBe(0);

    // assignedBagCount omitted → Math.max(0, undefined ?? 0)
    expect(
      calculateCompliance({
        stage: 'CHECK_OUT',
        returnedBagCount: 0,
        conditionStatus: 'GOOD',
      }).score,
    ).toBe(30);
  });

  it('maps CHECK_OUT score thresholds to compliance status', () => {
    expect(
      calculateCompliance({
        stage: 'CHECK_OUT',
        appCompleted: true,
        assignedBagCount: 1,
        returnedBagCount: 1,
        conditionStatus: 'GOOD',
      }).status,
    ).toBe('COMPLIANT');

    expect(
      calculateCompliance({
        stage: 'CHECK_OUT',
        appCompleted: true,
        assignedBagCount: 2,
        returnedBagCount: 1,
        conditionStatus: 'PARTIAL',
      }).status,
    ).toBe('NEEDS_REVIEW');

    expect(
      calculateCompliance({
        stage: 'CHECK_OUT',
        assignedBagCount: 2,
        returnedBagCount: 0,
        conditionStatus: 'POOR',
      }).status,
    ).toBe('NON_COMPLIANT');
  });
});
