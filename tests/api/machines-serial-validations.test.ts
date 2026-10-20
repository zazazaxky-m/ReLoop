import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/manual-validations/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as tripHelpers from '@/lib/trip';
import * as tripValidation from '@/lib/trip-validation';
import * as walletService from '@/lib/wallet-service';

vi.mock('@/lib/prisma', () => ({ prisma: { trip: { findUnique: vi.fn() } } }));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  assertOrgScope: vi.fn(),
  assertActivePartnership: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
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
  afterCommitSafely: vi.fn(async (_label: string, effect: () => Promise<unknown>) => { await effect(); }),
}));
vi.mock('@/lib/trip-validation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/trip-validation')>()),
  lockTripAggregate: vi.fn(),
  validateTripBags: vi.fn(),
  markUnreviewedBagsNotReturned: vi.fn(),
  refreshTripOutcome: vi.fn(),
  tripNotificationRecipients: vi.fn(async () => []),
}));

const makeReq = (body: any) => new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) });

function lockedTrip(overrides: Record<string, unknown> = {}) {
  return {
    id: 't1', status: 'COMPLETED', userId: 'u1', campaignId: 'c1', travelAgentId: null, groupName: null,
    complianceScore: 100, complianceStatus: 'COMPLIANT',
    campaign: { organizationId: 'org1', rewardMode: 'COMPLIANCE_ONLY', rewardMultiplier: 1, name: 'Camp' },
    bagAssignments: [
      { id: 'b1', bagQrCode: 'QR1', status: 'GOOD' },
      { id: 'b2', bagQrCode: 'QR2', status: 'GOOD' },
      { id: 'b3', bagQrCode: 'QR3', status: 'GOOD' },
    ],
    ...overrides,
  };
}

let tx: any;

describe('/api/manual-validations POST (roles, scope, pickup)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.trip.findUnique).mockResolvedValue({ id: 't1', campaign: { organizationId: 'org1' } } as any);
    tx = {
      manualValidation: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn(async ({ data }: any) => ({ id: 'mv1', ...data })) },
      trip: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    vi.mocked(walletService.runWalletTransaction).mockImplementation(async (fn: any) => fn(tx));
    vi.mocked(tripValidation.lockTripAggregate).mockResolvedValue(lockedTrip() as any);
  });

  it('returns 403 when USER role tries to validate', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
    const res = await POST(makeReq({ tripId: 't1' }));
    expect(res.status).toBe(403);
  });

  it('returns 404 when trip not found', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN' } as any);
    vi.mocked(prisma.trip.findUnique).mockResolvedValue(null);
    const res = await POST(makeReq({ tripId: 't1' }));
    expect(res.status).toBe(404);
    expect(walletService.runWalletTransaction).not.toHaveBeenCalled();
  });

  it('checks the admin organization scope before taking any lock', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a2', role: 'ADMIN', organizationId: 'org2' } as any);
    vi.mocked(rbac.assertOrgScope).mockImplementationOnce(() => {
      throw new (rbac as any).HttpError(403, 'Di luar scope organisasi Anda');
    });
    const res = await POST(makeReq({ tripId: 't1', validationStage: 'CHECK_OUT', bags: [{ id: 'b1', status: 'GOOD' }] }));
    expect(res.status).toBe(403);
    expect(rbac.assertOrgScope).toHaveBeenCalledWith(expect.objectContaining({ id: 'a2' }), 'org1');
    expect(walletService.runWalletTransaction).not.toHaveBeenCalled();
  });

  it('restricts PENGEPUL to BANK_SAMPAH_PICKUP stage only', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(rbac.assertActivePartnership).mockResolvedValue({} as any);

    const res = await POST(makeReq({ tripId: 't1', validationStage: 'CHECK_OUT' }));
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toContain('Bank Sampah');
    expect(walletService.runWalletTransaction).not.toHaveBeenCalled();
  });

  it('rejects a PENGEPUL without an active partnership for the trip organization', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p2', role: 'PENGEPUL' } as any);
    vi.mocked(rbac.assertActivePartnership).mockRejectedValueOnce(
      new (rbac as any).HttpError(403, 'Kemitraan pengepul belum aktif untuk organisasi ini'));
    const res = await POST(makeReq({ tripId: 't1', validationStage: 'BANK_SAMPAH_PICKUP' }));
    expect(res.status).toBe(403);
    expect(rbac.assertActivePartnership).toHaveBeenCalledWith('p2', 'org1');
  });

  it('validates bagQrCode against the locked bag rows of the trip', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN' } as any);
    vi.mocked(tripValidation.lockTripAggregate).mockResolvedValue(lockedTrip({ status: 'PLANNED' }) as any);
    const res = await POST(makeReq({ tripId: 't1', validationStage: 'CHECK_IN', bagQrCode: 'QR-OTHER-TRIP' }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe('QR trash bag tidak valid untuk trip ini');
    expect(tx.manualValidation.create).not.toHaveBeenCalled();
  });

  it('records a pickup with conditionStatus=null without changing the trip', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(rbac.assertActivePartnership).mockResolvedValue({} as any);
    const res = await POST(makeReq({ tripId: 't1', validationStage: 'BANK_SAMPAH_PICKUP', returnedBagCount: 3, appCompleted: true }));
    expect(res.status).toBe(201);
    const created = tx.manualValidation.create.mock.calls[0][0].data;
    expect(created).toMatchObject({ conditionStatus: null, appCompleted: true, gateType: 'BANK_SAMPAH', returnedBagCount: 3 });
    expect(tx.trip.updateMany).not.toHaveBeenCalled();
    // Pickup after COMPLETED is allowed even if the agent was suspended later.
    expect(tripHelpers.getTripTravelAgentGateBlockReason).not.toHaveBeenCalled();
  });

  it('caps the pickup count at the issued bag rows', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(rbac.assertActivePartnership).mockResolvedValue({} as any);
    const res = await POST(makeReq({ tripId: 't1', validationStage: 'BANK_SAMPAH_PICKUP', returnedBagCount: 4 }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe(tripValidation.RETURNED_COUNT_EXCEEDS_ISSUED);
  });

  it('rejects duplicate BANK_SAMPAH_PICKUP (checked under the trip lock)', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'p1', role: 'PENGEPUL' } as any);
    vi.mocked(rbac.assertActivePartnership).mockResolvedValue({} as any);
    tx.manualValidation.findFirst.mockResolvedValue({ id: 'existing' });

    const res = await POST(makeReq({
      tripId: 't1',
      validationStage: 'BANK_SAMPAH_PICKUP',
      gateType: 'BANK_SAMPAH',
      returnedBagCount: 3,
      appCompleted: true,
    }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toContain('sudah dicatat');
    expect(tx.manualValidation.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tripId: 't1', validationStage: 'BANK_SAMPAH_PICKUP' } }));
  });

  it('re-checks the travel agent gate through the transaction', async () => {
    vi.mocked(tripHelpers.getTripTravelAgentGateBlockReason).mockResolvedValueOnce(
      'Travel agent trip ini sudah ditangguhkan atau dihapus dari organisasi',
    );
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN' } as any);
    vi.mocked(tripValidation.lockTripAggregate).mockResolvedValue(lockedTrip({ status: 'ACTIVE', travelAgentId: 'ta1' }) as any);

    const res = await POST(makeReq({ tripId: 't1', validationStage: 'CHECK_OUT', bags: [{ id: 'b1', status: 'GOOD' }] }));
    expect(res.status).toBe(422);
    expect(tripHelpers.getTripTravelAgentGateBlockReason).toHaveBeenCalledWith(
      { travelAgentId: 'ta1', organizationId: 'org1' }, tx);
    expect(tripValidation.validateTripBags).not.toHaveBeenCalled();
  });

  it('handles unexpected errors', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('Unexpected error POST'));
    const res = await POST(makeReq({ tripId: 't1' }));
    expect(res.status).toBe(500);
  });
});
