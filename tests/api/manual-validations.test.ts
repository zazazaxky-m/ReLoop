import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/manual-validations/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as trip from '@/lib/trip';
import * as tripValidation from '@/lib/trip-validation';
import * as walletService from '@/lib/wallet-service';
import { logAudit } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';

vi.mock('@/lib/prisma', () => ({ prisma: { trip: { findUnique: vi.fn() } } }));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  assertOrgScope: vi.fn(),
  assertActivePartnership: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/format', () => ({ formatRupiah: (n: number) => `Rp ${n}` }));
vi.mock('@/lib/trip', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/trip')>()),
  getTripTravelAgentGateBlockReason: vi.fn(async () => null),
}));
vi.mock('@/lib/wallet-service', () => ({
  runWalletTransaction: vi.fn(),
  afterCommitSafely: vi.fn(async (_label: string, effect: () => Promise<unknown>) => {
    try {
      await effect();
    } catch {
      // swallowed like the real helper
    }
  }),
}));
vi.mock('@/lib/trip-validation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/trip-validation')>()),
  lockTripAggregate: vi.fn(),
  validateTripBags: vi.fn(),
  markUnreviewedBagsNotReturned: vi.fn(),
  refreshTripOutcome: vi.fn(),
  tripNotificationRecipients: vi.fn(),
}));

const admin = { id: 'a1', role: 'ADMIN', organizationId: 'org1' };

function lockedTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1',
    status: 'ACTIVE',
    userId: 'u1',
    campaignId: 'c1',
    travelAgentId: 'ta1',
    groupName: 'Grup A',
    complianceScore: 0,
    complianceStatus: 'CHECKED_IN',
    campaign: { organizationId: 'org1', rewardMode: 'MONEY_REWARD', rewardMultiplier: 1, name: 'Campaign A' },
    bagAssignments: [
      { id: 'b1', bagQrCode: 'QR1', status: null },
      { id: 'b2', bagQrCode: 'QR2', status: null },
    ],
    ...overrides,
  };
}

const outcome = {
  completed: true,
  completedNow: true,
  rewardAmount: 2_800,
  computedRewardAmount: 2_800,
  paidRewardAmount: 2_800,
  compliance: { score: 70, status: 'NEEDS_REVIEW' as const },
  assignedCount: 2,
  returnedCount: 2,
  rewardableCount: 2,
  conditionStatus: 'PARTIAL' as const,
};

let tx: {
  manualValidation: { findFirst: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  trip: { updateMany: ReturnType<typeof vi.fn> };
};
const calls: string[] = [];

function post(body: Record<string, unknown>) {
  return POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  vi.mocked(rbac.requireApiUser).mockResolvedValue(admin as any);
  vi.mocked(prisma.trip.findUnique).mockResolvedValue({ id: 't1', campaign: { organizationId: 'org1' } } as any);
  tx = {
    manualValidation: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: any) => {
        calls.push('validation');
        return { id: 'v1', ...data };
      }),
    },
    trip: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  vi.mocked(walletService.runWalletTransaction).mockImplementation(async (fn: any) => {
    calls.push('begin');
    const result = await fn(tx);
    calls.push('commit');
    return result;
  });
  vi.mocked(tripValidation.lockTripAggregate).mockImplementation(async () => {
    calls.push('lock');
    return lockedTrip() as any;
  });
  vi.mocked(tripValidation.validateTripBags).mockImplementation(async () => {
    calls.push('validateBags');
    return { returnedCount: 2, rewardableCount: 2 };
  });
  vi.mocked(tripValidation.markUnreviewedBagsNotReturned).mockImplementation(async () => {
    calls.push('markUnreviewed');
    return 0;
  });
  vi.mocked(tripValidation.refreshTripOutcome).mockImplementation(async () => {
    calls.push('refresh');
    return outcome;
  });
  vi.mocked(tripValidation.tripNotificationRecipients).mockResolvedValue(['u1', 'agent-u1']);
  vi.mocked(logAudit).mockImplementation(async () => {
    calls.push('audit');
  });
});

describe('/api/manual-validations POST check-out with bag IDs', () => {
  const bags = [
    { id: 'b1', status: 'GOOD' },
    { id: 'b2', status: 'PARTIAL' },
  ];

  it('validates owned bags, recomputes the outcome under the trip locks and writes the validation in one transaction', async () => {
    const res = await post({ tripId: 't1', validationStage: 'CHECK_OUT', appCompleted: true, bags });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      validation: expect.objectContaining({ id: 'v1', returnedBagCount: 2, conditionStatus: 'PARTIAL', complianceScore: 70 }),
      rewardAmount: 2_800,
      compliance: { score: 70, status: 'NEEDS_REVIEW' },
    });
    expect(calls.slice(0, 7)).toEqual(['begin', 'lock', 'validateBags', 'markUnreviewed', 'refresh', 'validation', 'commit']);
    expect(calls.indexOf('audit')).toBeGreaterThan(calls.indexOf('commit'));
    expect(tripValidation.lockTripAggregate).toHaveBeenCalledWith(tx, 't1');
    expect(tripValidation.validateTripBags).toHaveBeenCalledWith(tx, 't1', bags);
    expect(tripValidation.refreshTripOutcome).toHaveBeenCalledWith(tx, 't1', { appCompleted: true });
    expect(tx.manualValidation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ tripId: 't1', validatedById: 'a1', validationStage: 'CHECK_OUT', gateType: 'EXIT',
        complianceStatus: 'NEEDS_REVIEW', appCompleted: true }),
    });
    // The trip status and reward are owned by refreshTripOutcome.
    expect(tx.trip.updateMany).not.toHaveBeenCalled();
  });

  it('notifies stakeholders and the reward recipient only after commit', async () => {
    const res = await post({ tripId: 't1', validationStage: 'CHECK_OUT', appCompleted: true, bags });
    expect(res.status).toBe(201);
    expect(tripValidation.tripNotificationRecipients).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', userId: 'u1' }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', type: 'TRIP_STATUS' }));
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'agent-u1', type: 'TRIP_STATUS' }));
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', type: 'TRASH_BAG_REWARD', data: { tripId: 't1', rewardAmount: 2_800 } }),
    );
    expect(createNotification).not.toHaveBeenCalledWith(expect.objectContaining({ userId: 'agent-u1', type: 'TRASH_BAG_REWARD' }));
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'MANUAL_VALIDATION', entityId: 'v1', metadata: { tripId: 't1', rewardAmount: 2_800 } }));
  });

  it('keeps the committed check-out when audit or notification fails afterwards', async () => {
    vi.mocked(logAudit).mockRejectedValueOnce(new Error('audit down'));
    vi.mocked(createNotification).mockRejectedValue(new Error('push down'));
    const res = await post({ tripId: 't1', validationStage: 'CHECK_OUT', appCompleted: true, bags });
    expect(res.status).toBe(201);
    expect(walletService.afterCommitSafely).toHaveBeenCalled();
  });

  it('refuses when the locked trip was not closed by this request', async () => {
    vi.mocked(tripValidation.refreshTripOutcome).mockResolvedValueOnce({ ...outcome, completedNow: false });
    const res = await post({ tripId: 't1', validationStage: 'CHECK_OUT', bags });
    expect(res.status).toBe(409);
    expect(tx.manualValidation.create).not.toHaveBeenCalled();
  });

  it('propagates bag validation errors before any outcome is written', async () => {
    vi.mocked(tripValidation.validateTripBags).mockRejectedValueOnce(
      new (rbac as any).HttpError(422, 'Kantong dipindai lebih dari sekali'),
    );
    const res = await post({ tripId: 't1', validationStage: 'CHECK_OUT', bags: [bags[0], bags[0]] });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Kantong dipindai lebih dari sekali');
    expect(tripValidation.refreshTripOutcome).not.toHaveBeenCalled();
    expect(tx.manualValidation.create).not.toHaveBeenCalled();
  });

  it('only accepts bag statuses at check-out', async () => {
    const res = await post({ tripId: 't1', validationStage: 'CHECK_IN', bags });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Kondisi kantong hanya dicatat saat check-out');
    expect(walletService.runWalletTransaction).not.toHaveBeenCalled();
  });

  it('rejects malformed bag entries before touching the database', async () => {
    const res = await post({ tripId: 't1', validationStage: 'CHECK_OUT', bags: [{ id: '', status: 'GOOD' }] });
    expect(res.status).toBe(422);
    expect(walletService.runWalletTransaction).not.toHaveBeenCalled();
  });
});

describe('/api/manual-validations POST count-only (legacy) requests', () => {
  it('never pays a reward trip from a count: bag IDs are required', async () => {
    const res = await post({ tripId: 't1', validationStage: 'CHECK_OUT', returnedBagCount: 2, conditionStatus: 'GOOD', appCompleted: true });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(tripValidation.BAG_IDS_REQUIRED);
    expect(tx.trip.updateMany).not.toHaveBeenCalled();
    expect(tx.manualValidation.create).not.toHaveBeenCalled();
    expect(tripValidation.refreshTripOutcome).not.toHaveBeenCalled();
  });

  it('treats an empty bags list as count-only', async () => {
    const res = await post({ tripId: 't1', validationStage: 'CHECK_OUT', bags: [], returnedBagCount: 1 });
    expect(res.status).toBe(422);
    expect(tripValidation.validateTripBags).not.toHaveBeenCalled();
  });

  it('rejects a count above the issued bag rows', async () => {
    const res = await post({ tripId: 't1', validationStage: 'CHECK_OUT', returnedBagCount: 500, conditionStatus: 'GOOD' });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(tripValidation.RETURNED_COUNT_EXCEEDS_ISSUED);
    expect(tx.manualValidation.create).not.toHaveBeenCalled();
  });

  it('closes a COMPLIANCE_ONLY trip from a bounded count without touching bags or money', async () => {
    vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(
      lockedTrip({ campaign: { organizationId: 'org1', rewardMode: 'COMPLIANCE_ONLY', rewardMultiplier: 1, name: 'C' } }) as any,
    );
    const res = await post({ tripId: 't1', validationStage: 'CHECK_OUT', returnedBagCount: 2, conditionStatus: 'GOOD', appCompleted: true });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ rewardAmount: 0, compliance: { score: 100, status: 'COMPLIANT' } });
    expect(tx.trip.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', status: 'ACTIVE' },
      data: expect.objectContaining({ status: 'COMPLETED', complianceStatus: 'COMPLIANT', complianceScore: 100, checkOutAt: expect.any(Date) }),
    });
    expect(tx.manualValidation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ returnedBagCount: 2, conditionStatus: 'GOOD' }) });
    expect(tripValidation.validateTripBags).not.toHaveBeenCalled();
    expect(tripValidation.refreshTripOutcome).not.toHaveBeenCalled();
    expect(createNotification).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'TRASH_BAG_REWARD' }));
  });

  it('closes a reward trip without issued bags with no reward', async () => {
    vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(lockedTrip({ bagAssignments: [] }) as any);
    const over = await post({ tripId: 't1', validationStage: 'CHECK_OUT', returnedBagCount: 1 });
    expect(over.status).toBe(422);
    vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(lockedTrip({ bagAssignments: [] }) as any);
    const res = await post({ tripId: 't1', validationStage: 'CHECK_OUT', returnedBagCount: 0 });
    expect(res.status).toBe(201);
    expect((await res.json()).rewardAmount).toBe(0);
  });

  it('answers 409 when the trip status changed under the compare-and-set', async () => {
    tx.trip.updateMany.mockResolvedValueOnce({ count: 0 });
    vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(lockedTrip({ status: 'PLANNED' }) as any);
    const res = await post({ tripId: 't1', validationStage: 'CHECK_IN', appCompleted: true });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(trip.TRIP_CHANGED);
    expect(tx.manualValidation.create).not.toHaveBeenCalled();
  });

  it('records CHECK_IN on a PLANNED trip and activates it', async () => {
    vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(lockedTrip({ status: 'PLANNED' }) as any);
    const res = await post({ tripId: 't1', validationStage: 'CHECK_IN', appCompleted: true });
    expect(res.status).toBe(201);
    expect(tx.trip.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', status: 'PLANNED' },
      data: expect.objectContaining({ status: 'ACTIVE', complianceStatus: 'CHECKED_IN', complianceScore: 30, checkInAt: expect.any(Date) }),
    });
    expect(tx.manualValidation.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ validationStage: 'CHECK_IN', gateType: 'ENTRY' }) });
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ title: 'Trip check-in' }));
  });

  it('rejects a trip stage the locked status does not allow', async () => {
    vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(lockedTrip({ status: 'COMPLETED' }) as any);
    const res = await post({ tripId: 't1', validationStage: 'CHECK_OUT', bags: [{ id: 'b1', status: 'GOOD' }] });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('Trip sudah selesai; validasi gerbang tidak dapat diulang');
    expect(tripValidation.validateTripBags).not.toHaveBeenCalled();
  });

  it('skips agent users in notifications when the helper returns only the recipient', async () => {
    vi.mocked(tripValidation.tripNotificationRecipients).mockResolvedValueOnce(['u1']);
    vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(lockedTrip({ status: 'PLANNED' }) as any);
    const res = await post({ tripId: 't1', validationStage: 'CHECK_IN', appCompleted: true });
    expect(res.status).toBe(201);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', type: 'TRIP_STATUS' }));
  });
});
