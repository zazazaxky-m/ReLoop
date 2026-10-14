import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST, PATCH } from '@/app/api/trash-bags/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as trip from '@/lib/trip';
import * as locks from '@/lib/db-locks';
import * as funding from '@/lib/reward-funding';
import * as tripValidation from '@/lib/trip-validation';
import * as walletService from '@/lib/wallet-service';
import { logAudit } from '@/lib/audit';
import { createNotification } from '@/lib/notifications';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    trashBagAssignment: { findMany: vi.fn(), findFirst: vi.fn() },
    trip: { findUnique: vi.fn() },
    wasteType: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  assertOrgScope: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/notifications', () => ({ createNotification: vi.fn() }));
vi.mock('@/lib/format', () => ({ formatRupiah: (n: number) => `Rp ${n}` }));
vi.mock('@/lib/trip', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/trip')>()),
  generateBagQrCode: vi.fn().mockReturnValue('QR123'),
  getTripTravelAgentGateBlockReason: vi.fn(async () => null),
}));
vi.mock('@/lib/db-locks', () => ({ lockTrip: vi.fn(), lockTripBags: vi.fn(), lockUser: vi.fn(), lockCampaign: vi.fn() }));
// B01: issuance reserves the most the bags can pay, under User -> account -> Campaign -> Trip.
vi.mock('@/lib/reward-funding', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reward-funding')>()),
  lockFundingAccountForOrganization: vi.fn(),
  reserveRewardBudget: vi.fn(async () => 'res1'),
}));
vi.mock('@/lib/wallet-service', () => ({
  runWalletTransaction: vi.fn(),
  afterCommitSafely: vi.fn(async (_label: string, effect: () => Promise<unknown>) => {
    try { await effect(); } catch { /* swallowed like the real helper */ }
  }),
}));
vi.mock('@/lib/trip-validation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/trip-validation')>()),
  lockTripAggregate: vi.fn(),
  validateTripBags: vi.fn(),
  refreshTripOutcome: vi.fn(),
  tripNotificationRecipients: vi.fn(async () => ['u1', 'agent-user-1']),
}));

const admin = { id: 'a1', role: 'ADMIN', organizationId: 'org1' };
let tx: any;
const calls: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  vi.mocked(rbac.requireApiUser).mockResolvedValue(admin as any);
  vi.mocked(walletService.runWalletTransaction).mockImplementation(async (fn: any) => {
    calls.push('begin');
    const result = await fn(tx);
    calls.push('commit');
    return result;
  });
  vi.mocked(logAudit).mockImplementation(async () => { calls.push('audit'); });
});

describe('/api/trash-bags', () => {
  describe('GET', () => {
    it('returns 400 when no tripId or qrCode', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
      const res = await GET(new Request('http://localhost/api/trash-bags'));
      expect(res.status).toBe(400);
    });

    it('returns bags by tripId', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([
        { id: 'b1', trip: { campaign: { organizationId: 'org1' } } },
      ] as any);

      const res = await GET(new Request('http://localhost/api/trash-bags?tripId=t1'));
      expect(res.status).toBe(200);
    });

    it('returns bags by qrCode', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.trashBagAssignment.findMany).mockResolvedValue([
        { id: 'b1', trip: { campaign: { organizationId: 'org1' } } },
      ] as any);

      const res = await GET(new Request('http://localhost/api/trash-bags?qrCode=QR123'));
      expect(res.status).toBe(200);
    });
  });

  describe('POST (issuance under the Trip lock)', () => {
    const moneyCampaign = { organizationId: 'org1', campaignType: 'TRASH_BAG', rewardMode: 'MONEY_REWARD', rewardMultiplier: null };
    const lockedTrip = (over: Record<string, unknown> = {}) =>
      ({ status: 'PLANNED', userId: 'u1', campaignId: 'c1', campaign: moneyCampaign, ...over });

    beforeEach(() => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', status: 'PLANNED', travelAgentId: null, userId: 'u1', campaignId: 'c1', campaign: moneyCampaign,
      } as any);
      tx = {
        trip: { findUniqueOrThrow: vi.fn().mockResolvedValue(lockedTrip()) },
        trashBagAssignment: {
          count: vi.fn().mockResolvedValue(0),
          createMany: vi.fn().mockResolvedValue({ count: 2 }),
          findMany: vi.fn().mockResolvedValue([{ id: 'b1' }, { id: 'b2' }]),
        },
      };
      vi.mocked(locks.lockUser).mockImplementation(async () => { calls.push('lockUser'); });
      vi.mocked(funding.lockFundingAccountForOrganization).mockImplementation(async () => { calls.push('lockAccount'); return {} as any; });
      vi.mocked(locks.lockCampaign).mockImplementation(async () => { calls.push('lockCampaign'); });
      vi.mocked(locks.lockTrip).mockImplementation(async () => { calls.push('lockTrip'); });
      vi.mocked(funding.reserveRewardBudget).mockImplementation(async () => { calls.push('reserve'); return 'res1'; });
    });

    const post = (body: Record<string, unknown>) =>
      POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify(body) }));

    it('returns 404 when trip not found', async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue(null);
      const res = await post({ tripId: 'notexist', bagCount: 3 });
      expect(res.status).toBe(404);
    });

    it('creates one row per bag under User -> account -> Campaign -> Trip after re-reading, reserving the most they can pay (201)', async () => {
      const res = await post({ tripId: 't1', bagCount: 2 });
      expect(res.status).toBe(201);
      expect(await res.json()).toEqual({ bags: [{ id: 'b1' }, { id: 'b2' }] });
      expect(locks.lockUser).toHaveBeenCalledWith(tx, 'u1');
      expect(funding.lockFundingAccountForOrganization).toHaveBeenCalledWith(tx, 'org1');
      expect(locks.lockCampaign).toHaveBeenCalledWith(tx, 'c1');
      expect(locks.lockTrip).toHaveBeenCalledWith(tx, 't1');
      expect(calls).toEqual(['begin', 'lockUser', 'lockAccount', 'lockCampaign', 'lockTrip', 'reserve', 'commit', 'audit']);
      // B01: 2 bags x Rp2.000 x multiplier 1, before the rows exist.
      expect(funding.reserveRewardBudget).toHaveBeenCalledWith(tx, {
        businessKey: 'trip:t1:issuance', organizationId: 'org1', campaignId: 'c1', userId: 'u1',
        ceilingRupiah: 4_000, sourceType: 'TRIP', sourceId: 't1' });
      expect(tx.trashBagAssignment.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ tripId: 't1', bagCount: 1, assignedById: 'a1' }),
          expect.objectContaining({ tripId: 't1', bagCount: 1 })],
      });
    });

    it('extends the issuance reservation to every issued bag with the campaign multiplier (B01)', async () => {
      tx.trashBagAssignment.count.mockResolvedValue(3);
      tx.trip.findUniqueOrThrow.mockResolvedValue(lockedTrip({ campaign: { ...moneyCampaign, rewardMultiplier: 1.5 } }));
      expect((await post({ tripId: 't1', bagCount: 2 })).status).toBe(201);
      expect(funding.reserveRewardBudget).toHaveBeenCalledWith(tx, expect.objectContaining({ ceilingRupiah: 15_000 }));
    });

    it('reserves nothing for a COMPLIANCE_ONLY campaign or a trip without a recipient (B01)', async () => {
      tx.trip.findUniqueOrThrow.mockResolvedValue(lockedTrip({ campaign: { ...moneyCampaign, rewardMode: 'COMPLIANCE_ONLY' } }));
      expect((await post({ tripId: 't1', bagCount: 1 })).status).toBe(201);
      expect(funding.reserveRewardBudget).not.toHaveBeenCalled();

      calls.length = 0;
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', status: 'PLANNED', travelAgentId: null, userId: null, campaignId: 'c1', campaign: moneyCampaign } as any);
      tx.trip.findUniqueOrThrow.mockResolvedValue(lockedTrip({ userId: null }));
      expect((await post({ tripId: 't1', bagCount: 1 })).status).toBe(201);
      expect(funding.reserveRewardBudget).not.toHaveBeenCalled();
      expect(calls).toEqual(['begin', 'lockAccount', 'lockCampaign', 'lockTrip', 'commit', 'audit']);
    });

    it('issues no bag when the funding reservation is refused (B01) or the trip changed owner/campaign under the lock', async () => {
      vi.mocked(funding.reserveRewardBudget).mockRejectedValueOnce(
        new rbac.HttpError(409, 'Program sementara tidak menerima setoran berhadiah'));
      const refused = await post({ tripId: 't1', bagCount: 1 });
      expect(refused.status).toBe(409);
      expect((await refused.json()).error).toBe('Program sementara tidak menerima setoran berhadiah');
      expect(tx.trashBagAssignment.createMany).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();

      tx.trip.findUniqueOrThrow.mockResolvedValue(lockedTrip({ userId: 'someone-else' }));
      const changed = await post({ tripId: 't1', bagCount: 1 });
      expect(changed.status).toBe(409);
      expect(tx.trashBagAssignment.createMany).not.toHaveBeenCalled();
    });

    it('refuses to add bags when the trip closed while waiting for the lock', async () => {
      tx.trip.findUniqueOrThrow.mockResolvedValue(lockedTrip({ status: 'COMPLETED' }));
      const res = await post({ tripId: 't1', bagCount: 1 });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('Kantong hanya dapat diterbitkan untuk trip PLANNED atau ACTIVE');
      expect(tx.trashBagAssignment.createMany).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('retries the whole transaction on a unique QR collision (P2002)', async () => {
      const collision = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      tx.trashBagAssignment.createMany.mockRejectedValueOnce(collision).mockResolvedValueOnce({ count: 1 });
      vi.mocked(trip.generateBagQrCode).mockReturnValueOnce('QR-DUP').mockReturnValueOnce('QR-OK');

      const res = await post({ tripId: 't1', bagCount: 1 });
      expect(res.status).toBe(201);
      expect(walletService.runWalletTransaction).toHaveBeenCalledTimes(2);
      expect(tx.trashBagAssignment.createMany).toHaveBeenLastCalledWith({
        data: [expect.objectContaining({ bagQrCode: 'QR-OK' })] });
    });

    it('rethrows non-P2002 createMany errors immediately', async () => {
      tx.trashBagAssignment.createMany.mockRejectedValue(new Error('db down'));
      const res = await post({ tripId: 't1', bagCount: 1 });
      expect(res.status).toBe(500);
      expect(walletService.runWalletTransaction).toHaveBeenCalledTimes(1);
    });

    it('returns 422 when bagCount exceeds 200', async () => {
      const res = await post({ tripId: 't1', bagCount: 201 });
      expect(res.status).toBe(422);
    });

    it('returns 422 when wasteTypeId is invalid', async () => {
      vi.mocked(prisma.wasteType.findFirst).mockResolvedValue(null);
      const res = await post({ tripId: 't1', bagCount: 1, wasteTypeId: 'invalid' });
      expect(res.status).toBe(422);
    });

    it('rejects issuing bags for cancelled trips', async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', status: 'CANCELLED', campaign: { organizationId: 'org1' },
      } as any);
      const res = await post({ tripId: 't1', bagCount: 1 });
      expect(res.status).toBe(422);
      expect(walletService.runWalletTransaction).not.toHaveBeenCalled();
    });

    it('rejects POST when travel agent gate blocks', async () => {
      vi.mocked(prisma.trip.findUnique).mockResolvedValue({
        id: 't1', status: 'PLANNED', travelAgentId: 'ta1', campaign: { organizationId: 'org1' },
      } as any);
      vi.mocked(trip.getTripTravelAgentGateBlockReason).mockResolvedValueOnce('Travel agent ditangguhkan');
      const res = await post({ tripId: 't1', bagCount: 1 });
      expect(res.status).toBe(422);
    });
  });

  describe('PATCH (progressive scan)', () => {
    function lockedTrip(overrides: Record<string, unknown> = {}) {
      return {
        id: 't1', status: 'ACTIVE', userId: 'u1', campaignId: 'c1', travelAgentId: null, groupName: 'Grup Wisata',
        complianceScore: 50, complianceStatus: 'NEEDS_REVIEW',
        campaign: { organizationId: 'org1', rewardMode: 'MONEY_REWARD', rewardMultiplier: 1, name: 'Camp' },
        bagAssignments: [
          { id: 'b1', bagQrCode: 'QR1', status: null },
          { id: 'b2', bagQrCode: 'QR2', status: 'GOOD' },
        ],
        ...overrides,
      };
    }
    const outcome = (overrides: Record<string, unknown> = {}) => ({
      completed: false, completedNow: false, rewardAmount: 0, computedRewardAmount: 0, paidRewardAmount: 0,
      compliance: { score: 80, status: 'COMPLIANT' }, assignedCount: 2, returnedCount: 1, rewardableCount: 1,
      conditionStatus: 'GOOD', ...overrides,
    });
    const patch = (body: Record<string, unknown>) =>
      PATCH(new Request('http://localhost', { method: 'PATCH', body: JSON.stringify(body) }));

    beforeEach(() => {
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue({
        id: 'b1', tripId: 't1', trip: { campaign: { organizationId: 'org1' } },
      } as any);
      tx = {
        trashBagAssignment: { findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'b1', bagQrCode: 'QR1', status: 'GOOD' }) },
        manualValidation: { create: vi.fn(async ({ data }: any) => { calls.push('validation'); return { id: 'v1', ...data }; }) },
      };
      vi.mocked(tripValidation.lockTripAggregate).mockImplementation(async () => {
        calls.push('lock');
        return lockedTrip() as any;
      });
      vi.mocked(tripValidation.validateTripBags).mockImplementation(async () => {
        calls.push('validateBags');
        return { returnedCount: 1, rewardableCount: 1 };
      });
      vi.mocked(tripValidation.refreshTripOutcome).mockImplementation(async () => {
        calls.push('refresh');
        return outcome() as any;
      });
    });

    it('returns 404 when bag not found', async () => {
      vi.mocked(prisma.trashBagAssignment.findFirst).mockResolvedValue(null);
      const res = await patch({ id: 'notexist', status: 'GOOD', appCompleted: true });
      expect(res.status).toBe(404);
      expect(walletService.runWalletTransaction).not.toHaveBeenCalled();
    });

    it('returns 422 when neither id nor qrCode provided', async () => {
      const res = await patch({ status: 'GOOD', appCompleted: true });
      expect(res.status).toBe(422);
    });

    it('checks the organization scope before taking any lock', async () => {
      vi.mocked(rbac.assertOrgScope).mockImplementationOnce(() => {
        throw new (rbac as any).HttpError(403, 'Di luar scope organisasi Anda');
      });
      const res = await patch({ id: 'b1', status: 'GOOD' });
      expect(res.status).toBe(403);
      expect(walletService.runWalletTransaction).not.toHaveBeenCalled();
    });

    it('updates the scanned bag and recomputes the trip from every bag under the locks', async () => {
      const res = await patch({ id: 'b1', status: 'GOOD', appCompleted: true });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        bag: { id: 'b1' }, validation: null, rewardAmount: 0, idempotent: false, compliance: { score: 80, status: 'COMPLIANT' } });
      expect(calls.slice(0, 5)).toEqual(['begin', 'lock', 'validateBags', 'refresh', 'commit']);
      expect(tripValidation.lockTripAggregate).toHaveBeenCalledWith(tx, 't1');
      expect(tripValidation.validateTripBags).toHaveBeenCalledWith(tx, 't1', [{ id: 'b1', status: 'GOOD' }]);
      // b1 was unreviewed: reviewing it may close the trip.
      expect(tripValidation.refreshTripOutcome).toHaveBeenCalledWith(tx, 't1', { appCompleted: true, mayClose: true });
      expect(tx.manualValidation.create).not.toHaveBeenCalled();
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'TRASH_BAG_SCAN_UPDATE', entityId: 'b1' }));
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('finds the bag by qrCode', async () => {
      const res = await patch({ qrCode: 'QR1', status: 'GOOD' });
      expect(res.status).toBe(200);
      expect(prisma.trashBagAssignment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { bagQrCode: 'QR1' } }));
    });

    it('the scan that closes the trip records one CHECK_OUT validation and notifies after commit', async () => {
      vi.mocked(tripValidation.refreshTripOutcome).mockImplementationOnce(async () => {
        calls.push('refresh');
        return outcome({ completed: true, completedNow: true, rewardAmount: 4_000, returnedCount: 2,
          compliance: { score: 100, status: 'COMPLIANT' } }) as any;
      });
      const res = await patch({ id: 'b1', status: 'GOOD', appCompleted: true, actualWeightKg: 3.5, notes: 'ok' });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({ rewardAmount: 4_000, idempotent: false, validation: { id: 'v1' } });
      expect(tx.manualValidation.create).toHaveBeenCalledWith({ data: expect.objectContaining({
        tripId: 't1', validationStage: 'CHECK_OUT', gateType: 'EXIT', bagQrCode: 'QR1', returnedBagCount: 2,
        conditionStatus: 'GOOD', complianceScore: 100, actualWeightKg: 3.5, notes: 'ok' }) });
      expect(calls.slice(0, 6)).toEqual(['begin', 'lock', 'validateBags', 'refresh', 'validation', 'commit']);
      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', type: 'TRIP_STATUS' }));
      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'agent-user-1', type: 'TRIP_STATUS' }));
      expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1', type: 'TRASH_BAG_REWARD' }));
      expect(createNotification).not.toHaveBeenCalledWith(expect.objectContaining({ userId: 'agent-user-1', type: 'TRASH_BAG_REWARD' }));
    });

    it('answers a repeated identical scan on an ACTIVE trip as idempotent without writing anything', async () => {
      vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(
        lockedTrip({ bagAssignments: [{ id: 'b1', bagQrCode: 'QR1', status: 'GOOD' }, { id: 'b2', bagQrCode: 'QR2', status: null }] }) as any);
      const res = await patch({ id: 'b1', status: 'GOOD' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        idempotent: true, rewardAmount: 0, validation: null, compliance: { score: 50, status: 'NEEDS_REVIEW' } });
      expect(tripValidation.validateTripBags).not.toHaveBeenCalled();
      expect(tripValidation.refreshTripOutcome).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('never closes or pays a legacy fully-reviewed ACTIVE trip on an identical re-scan', async () => {
      vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(
        lockedTrip({ bagAssignments: [{ id: 'b1', bagQrCode: 'QR1', status: 'GOOD' }, { id: 'b2', bagQrCode: 'QR2', status: 'GOOD' }] }) as any);
      const res = await patch({ id: 'b1', status: 'GOOD' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ idempotent: true, rewardAmount: 0, validation: null });
      expect(tripValidation.refreshTripOutcome).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('a changed scan of an already-reviewed bag may not close the trip (legacy trips close by bulk check-out)', async () => {
      vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(
        lockedTrip({ bagAssignments: [{ id: 'b1', bagQrCode: 'QR1', status: 'GOOD' }, { id: 'b2', bagQrCode: 'QR2', status: 'GOOD' }] }) as any);
      const res = await patch({ id: 'b1', status: 'PARTIAL', appCompleted: true });
      expect(res.status).toBe(200);
      expect((await res.json()).idempotent).toBe(false);
      expect(tripValidation.validateTripBags).toHaveBeenCalledWith(tx, 't1', [{ id: 'b1', status: 'PARTIAL' }]);
      expect(tripValidation.refreshTripOutcome).toHaveBeenCalledWith(tx, 't1', { appCompleted: true, mayClose: false });
      expect(tx.manualValidation.create).not.toHaveBeenCalled();
    });

    it('replays an identical scan on a COMPLETED trip without writing anything', async () => {
      vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(lockedTrip({
        status: 'COMPLETED', complianceScore: 100, complianceStatus: 'COMPLIANT',
        bagAssignments: [{ id: 'b1', bagQrCode: 'QR1', status: 'GOOD' }] }) as any);
      const res = await patch({ id: 'b1', status: 'GOOD' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        idempotent: true, rewardAmount: 0, validation: null, compliance: { score: 100, status: 'COMPLIANT' } });
      expect(tripValidation.validateTripBags).not.toHaveBeenCalled();
      expect(tripValidation.refreshTripOutcome).not.toHaveBeenCalled();
      expect(logAudit).not.toHaveBeenCalled();
    });

    it('refuses a silent change after the trip is COMPLETED', async () => {
      vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(lockedTrip({
        status: 'COMPLETED', bagAssignments: [{ id: 'b1', bagQrCode: 'QR1', status: 'POOR' }] }) as any);
      const res = await patch({ id: 'b1', status: 'GOOD' });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe(tripValidation.CORRECTION_REQUIRED);
      expect(tripValidation.validateTripBags).not.toHaveBeenCalled();
    });

    it('records a correction after close without minting: audited with paid and recomputed reward', async () => {
      vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(lockedTrip({
        status: 'COMPLETED', bagAssignments: [{ id: 'b1', bagQrCode: 'QR1', status: 'POOR' }] }) as any);
      vi.mocked(tripValidation.refreshTripOutcome).mockResolvedValueOnce(outcome({
        completed: true, completedNow: false, rewardAmount: 0, computedRewardAmount: 4_000, paidRewardAmount: 1_400,
        compliance: { score: 100, status: 'COMPLIANT' } }) as any);
      const res = await patch({ id: 'b1', status: 'GOOD', correctionReason: 'Salah input kondisi' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        rewardAmount: 0, idempotent: false, validation: null,
        correction: { previousStatus: 'POOR', paidRewardAmount: 1_400, recomputedRewardAmount: 4_000 } });
      // No appCompleted override: the closing check-out's value is used.
      expect(tripValidation.refreshTripOutcome).toHaveBeenCalledWith(tx, 't1');
      expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({
        action: 'TRASH_BAG_CORRECTION', entityId: 'b1',
        metadata: expect.objectContaining({ tripId: 't1', previousStatus: 'POOR', status: 'GOOD', reason: 'Salah input kondisi',
          paidRewardAmount: 1_400, recomputedRewardAmount: 4_000 }) }));
      expect(tx.manualValidation.create).not.toHaveBeenCalled();
      expect(createNotification).not.toHaveBeenCalled();
    });

    it('rejects a too-short correction reason', async () => {
      const res = await patch({ id: 'b1', status: 'GOOD', correctionReason: 'x' });
      expect(res.status).toBe(422);
      expect(walletService.runWalletTransaction).not.toHaveBeenCalled();
    });

    it.each([
      ['PLANNED', 'Lakukan check-in terlebih dahulu sebelum scan kondisi kantong'],
      ['CANCELLED', 'Trip sudah dibatalkan'],
      ['ARCHIVED', 'Scan kantong hanya untuk trip PLANNED atau ACTIVE'],
    ])('rejects a scan when the locked trip is %s', async (status, message) => {
      vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(lockedTrip({ status }) as any);
      const res = await patch({ id: 'b1', status: 'GOOD' });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe(message);
      expect(tripValidation.validateTripBags).not.toHaveBeenCalled();
    });

    it('answers 404 when the bag disappeared before the lock', async () => {
      vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(lockedTrip({ bagAssignments: [] }) as any);
      const res = await patch({ id: 'b1', status: 'GOOD' });
      expect(res.status).toBe(404);
    });

    it('re-checks the travel agent gate through the transaction on an ACTIVE trip', async () => {
      vi.mocked(tripValidation.lockTripAggregate).mockResolvedValueOnce(lockedTrip({ travelAgentId: 'ta1' }) as any);
      vi.mocked(trip.getTripTravelAgentGateBlockReason).mockResolvedValueOnce('Travel agent belum invited');
      const res = await patch({ id: 'b1', status: 'GOOD' });
      expect(res.status).toBe(422);
      expect(trip.getTripTravelAgentGateBlockReason).toHaveBeenCalledWith({ travelAgentId: 'ta1', organizationId: 'org1' }, tx);
      expect(tripValidation.validateTripBags).not.toHaveBeenCalled();
    });
  });
});
