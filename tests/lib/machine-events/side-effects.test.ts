import { describe, expect, it, vi, beforeEach } from 'vitest';
import { processEventSideEffects } from '@/lib/machine-events/side-effects';
import * as pickup from '@/lib/machine-events/pickup';
import * as fraud from '@/lib/machine-events/fraud';
import * as item from '@/lib/machine-events/item';
import * as acceptance from '@/lib/machine-events/acceptance';
import * as machineState from '@/lib/machine-state';

vi.mock('@/lib/machine-events/pickup', () => ({
  maybeCreateAutoPickup: vi.fn(),
  AUTO_PICKUP_FILL_THRESHOLD: 95,
}));
vi.mock('@/lib/machine-events/fraud', () => ({
  flagAnomaly: vi.fn(),
  holdItemForFraud: vi.fn(),
  notifyOrgAdmins: vi.fn(),
  publishSecurityAlert: vi.fn(),
}));
vi.mock('@/lib/machine-events/item', () => ({
  resolveDepositItemId: vi.fn(),
  resolveFraudDepositItemId: vi.fn(),
  resolveOrCreateUnknownWasteType: vi.fn(),
}));
vi.mock('@/lib/machine-events/acceptance', () => ({ handleAcceptance: vi.fn(), handleItemRejected: vi.fn(), recordItemEvidence: vi.fn() }));
vi.mock('@/lib/machine-state', () => ({
  transitionSession: vi.fn(),
  validateSensorSequence: vi.fn(),
}));

const mockTx = {
  machine: { update: vi.fn() },
  depositSession: { findUnique: vi.fn(), update: vi.fn() },
  machineWasteType: { findFirst: vi.fn() },
  wasteType: { findFirst: vi.fn() },
  depositItem: { create: vi.fn(), update: vi.fn() },
  machineEvent: { update: vi.fn() },
  rewardLedger: { updateMany: vi.fn() },
  // R03: ITEM_DETECTED locks the session row (FOR NO KEY UPDATE) before re-reading it.
  $queryRaw: vi.fn().mockResolvedValue([{ id: 's1' }]),
} as any;

const mockMachine = { id: 'm1', organizationId: 'o1', sessionIdleTimeoutMinutes: 2 } as any;

describe('processEventSideEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles HEARTBEAT updates machine and auto pickup', async () => {
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'HEARTBEAT', payload: { fillLevelPercent: 96, status: 'FULL' }, machineCode: 'M1' } as any, 'evt1');
    expect(mockTx.machine.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fillLevelPercent: 96, status: 'FULL' }) }));
    expect(pickup.maybeCreateAutoPickup).toHaveBeenCalledWith(mockTx, mockMachine, 'M1');
  });

  it('HEARTBEAT without status leaves status undefined', async () => {
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'HEARTBEAT', payload: { fillLevelPercent: 10 }, machineCode: 'M1' } as any,
      'evt1',
    );
    expect(mockTx.machine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: undefined, fillLevelPercent: 10 }),
      }),
    );
  });

  it('handles CHAMBER_OPENED transitions session', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE', startedAt: new Date() });
    vi.mocked(machineState.transitionSession).mockReturnValue('START_ITEM' as any);
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'CHAMBER_OPENED', sessionId: 's1' } as any, 'evt1');
    expect(mockTx.depositSession.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'START_ITEM' } }));
  });

  it('handles STATUS_CHANGED updates machine', async () => {
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'STATUS_CHANGED', payload: { status: 'FULL' }, machineCode: 'M1' } as any, 'evt1');
    expect(mockTx.machine.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'FULL' } }));
    expect(pickup.maybeCreateAutoPickup).toHaveBeenCalledWith(mockTx, mockMachine, 'M1');
  });

  it('handles FILL_LEVEL_UPDATED updates machine and auto pickup', async () => {
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'FILL_LEVEL_UPDATED', payload: { fillLevelPercent: 98 }, machineCode: 'M1' } as any, 'evt1');
    expect(mockTx.machine.update).toHaveBeenCalledWith(expect.objectContaining({ data: { fillLevelPercent: 98, status: 'FULL' } }));
    expect(pickup.maybeCreateAutoPickup).toHaveBeenCalledWith(mockTx, mockMachine, 'M1');
  });

  it('handles FILL_LEVEL_UPDATED below auto-pickup threshold without FULL status', async () => {
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'FILL_LEVEL_UPDATED', payload: { fillLevelPercent: 50 }, machineCode: 'M1' } as any,
      'evt1',
    );
    expect(mockTx.machine.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ fillLevelPercent: 50, status: undefined }),
      }),
    );
    expect(pickup.maybeCreateAutoPickup).not.toHaveBeenCalled();
  });

  it('ignores FILL_LEVEL_UPDATED without numeric fill', async () => {
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'FILL_LEVEL_UPDATED', payload: { fillLevelPercent: 'high' }, machineCode: 'M1' } as any,
      'evt1',
    );
    expect(mockTx.machine.update).not.toHaveBeenCalled();
  });

  it('skips CHAMBER_OPENED when session is not ACTIVE/RESERVED', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'COMPLETED', startedAt: new Date() });
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'CHAMBER_OPENED', sessionId: 's1' } as any,
      'evt1',
    );
    expect(mockTx.depositSession.update).not.toHaveBeenCalled();
  });

  it('handles CHAMBER_TIMEOUT transitions session to ITEM_DONE', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'PROCESSING_ITEM', startedAt: new Date() });
    vi.mocked(machineState.transitionSession).mockReturnValue('ITEM_DONE' as any);
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'CHAMBER_TIMEOUT', sessionId: 's1' } as any, 'evt1');
    expect(mockTx.depositSession.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ITEM_DONE' } }));
  });

  it('handles ITEM_DETECTED creates deposit item', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE', startedAt: new Date() });
    vi.mocked(item.resolveOrCreateUnknownWasteType).mockResolvedValue('wt1');
    mockTx.depositItem.create.mockResolvedValue({ id: 'd1' });
    
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'ITEM_DETECTED', sessionId: 's1', payload: {} } as any, 'evt1');
    
    expect(mockTx.depositItem.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'REVIEW', wasteTypeId: 'wt1' })
    }));
    expect(mockTx.machineEvent.update).toHaveBeenCalledWith(expect.objectContaining({ data: { depositItemId: 'd1' } }));
    expect(mockTx.depositSession.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'PROCESSING_ITEM' } }));
  });

  it('handles WEIGHT_MEASURED, IMAGE_CLASSIFIED, BARCODE_READ', async () => {
    vi.mocked(item.resolveDepositItemId).mockResolvedValue('d1');
    
    // M04 fix round 2 (A3): every evidence write goes through the gated, locked recorder.
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'WEIGHT_MEASURED', sessionId: 's1', payload: { weightGrams: 50 } } as any, 'evt1');
    expect(acceptance.recordItemEvidence).toHaveBeenLastCalledWith(mockTx, 'd1', { kind: 'MEASUREMENT', data: { measuredWeightGrams: 50 } });

    await processEventSideEffects(mockTx, mockMachine, { eventType: 'IMAGE_CLASSIFIED', sessionId: 's1', payload: { detectedType: 'PET', confidence: 0.9 } } as any, 'evt1');
    expect(acceptance.recordItemEvidence).toHaveBeenLastCalledWith(mockTx, 'd1', { kind: 'MEASUREMENT', data: { aiDetectedType: 'PET', aiConfidence: 0.9 } });

    await processEventSideEffects(mockTx, mockMachine, { eventType: 'BARCODE_READ', sessionId: 's1', payload: { barcode: '123' } } as any, 'evt1');
    expect(acceptance.recordItemEvidence).toHaveBeenLastCalledWith(mockTx, 'd1', { kind: 'MEASUREMENT', data: { barcodeValue: '123' } });
    expect(mockTx.depositItem.update).not.toHaveBeenCalled();
  });

  it('breaks WEIGHT/IMAGE/BARCODE/SENSOR when deposit item cannot be resolved', async () => {
    vi.mocked(item.resolveDepositItemId).mockResolvedValue(null);
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'WEIGHT_MEASURED', sessionId: 's1', payload: { weightGrams: 1 } } as any, 'evt1');
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'IMAGE_CLASSIFIED', sessionId: 's1', payload: { detectedType: 'PET', confidence: 0.1 } } as any, 'evt1');
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'BARCODE_READ', sessionId: 's1', payload: { barcode: 'x' } } as any, 'evt1');
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'SENSOR_SEQUENCE', sessionId: 's1', payload: {} } as any, 'evt1');
    expect(mockTx.depositItem.update).not.toHaveBeenCalled();
    expect(acceptance.recordItemEvidence).not.toHaveBeenCalled();
  });

  it('handles SENSOR_SEQUENCE and flags anomaly', async () => {
    vi.mocked(item.resolveDepositItemId).mockResolvedValue('d1');
    vi.mocked(machineState.validateSensorSequence).mockReturnValue('WRONG_SEQ');
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'SENSOR_SEQUENCE', sessionId: 's1', payload: { seq: 1 } } as any, 'evt1');
    expect(mockTx.depositItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: { sensorSequenceJson: { seq: 1 } } }));
    expect(fraud.flagAnomaly).toHaveBeenCalledWith(mockTx, 's1', 'd1', 'WRONG_SEQ');
  });

  it('SENSOR_SEQUENCE skips anomaly flag when sessionId missing', async () => {
    vi.mocked(item.resolveDepositItemId).mockResolvedValue('d1');
    vi.mocked(machineState.validateSensorSequence).mockReturnValue('WRONG_SEQ');
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'SENSOR_SEQUENCE', payload: { seq: 1 } } as any, 'evt1');
    expect(fraud.flagAnomaly).not.toHaveBeenCalled();
  });

  it('delegates ITEM_REJECTED to the gated, locked handler (M04 fix round 1, C2)', async () => {
    vi.mocked(item.resolveDepositItemId).mockResolvedValue('d1');
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'ITEM_REJECTED', sessionId: 's1', payload: { reason: 'TOO_LIGHT' } } as any, 'evt1');
    expect(acceptance.handleItemRejected).toHaveBeenCalledWith(mockTx, { sessionId: 's1', depositItemId: 'd1', reason: 'TOO_LIGHT' });
    // No unlocked writes from the event handler itself.
    expect(mockTx.depositItem.update).not.toHaveBeenCalled();
    expect(mockTx.depositSession.update).not.toHaveBeenCalled();
  });

  it('ITEM_REJECTED defaults the reason and namespaces a forged review code (C1)', async () => {
    vi.mocked(item.resolveDepositItemId).mockResolvedValue('d1');
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'ITEM_REJECTED', sessionId: 's1', payload: {} } as any, 'evt1');
    expect(acceptance.handleItemRejected).toHaveBeenLastCalledWith(mockTx, { sessionId: 's1', depositItemId: 'd1', reason: 'REJECTED' });
    await processEventSideEffects(mockTx, mockMachine,
      { eventType: 'ITEM_REJECTED', depositItemId: 'd1', payload: { reason: 'REVIEW_REJECTED' } } as any, 'evt2');
    expect(acceptance.handleItemRejected).toHaveBeenLastCalledWith(mockTx, { sessionId: null, depositItemId: 'd1', reason: 'MACHINE_REVIEW_REJECTED' });
  });

  it('ITEM_ACCEPTED_POINT and ITEM_REJECTED break when item cannot be resolved', async () => {
    vi.mocked(item.resolveDepositItemId).mockResolvedValue(null);
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'ITEM_ACCEPTED_POINT', sessionId: 's1' } as any,
      'evt1',
    );
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'ITEM_REJECTED', sessionId: 's1', payload: {} } as any,
      'evt1',
    );
    expect(acceptance.handleAcceptance).not.toHaveBeenCalled();
    expect(acceptance.handleItemRejected).not.toHaveBeenCalled();
    expect(mockTx.depositItem.update).not.toHaveBeenCalled();
  });

  it('ITEM_ACCEPTED_POINT breaks when sessionId is missing', async () => {
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'ITEM_ACCEPTED_POINT' } as any,
      'evt1',
    );
    expect(item.resolveDepositItemId).not.toHaveBeenCalled();
  });

  it('FRAUD_DETECTED uses eventType as reason and empty machineCode fallback', async () => {
    vi.mocked(item.resolveFraudDepositItemId).mockResolvedValue(null);
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'FRAUD_DETECTED', sessionId: null, payload: {} } as any,
      'evt1',
    );
    expect(fraud.notifyOrgAdmins).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({
        body: expect.stringContaining('fraud detected'),
      }),
    );
  });

  it('handles COMPACTION_STARTED and COMPACTION_COMPLETED', async () => {
    vi.mocked(item.resolveDepositItemId).mockResolvedValue('d1');
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'COMPACTION_STARTED', sessionId: 's1' } as any, 'evt1');
    expect(acceptance.recordItemEvidence).toHaveBeenLastCalledWith(mockTx, 'd1', { kind: 'COMPACTION', data: { compactionStatus: 'PENDING' } });

    await processEventSideEffects(mockTx, mockMachine, { eventType: 'COMPACTION_COMPLETED', sessionId: 's1' } as any, 'evt1');
    expect(acceptance.recordItemEvidence).toHaveBeenLastCalledWith(mockTx, 'd1', { kind: 'COMPACTION', data: { compactionStatus: 'COMPACTED' } });
    expect(mockTx.depositItem.update).not.toHaveBeenCalled();
  });

  it('skips compaction updates when deposit item cannot be resolved', async () => {
    vi.mocked(item.resolveDepositItemId).mockResolvedValue(null);
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'COMPACTION_STARTED', sessionId: 's1' } as any, 'evt1');
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'COMPACTION_COMPLETED', sessionId: 's1' } as any, 'evt1');
    expect(mockTx.depositItem.update).not.toHaveBeenCalled();
    expect(acceptance.recordItemEvidence).not.toHaveBeenCalled();
  });

  it('notifies fraud without deposit item when none is resolved', async () => {
    vi.mocked(item.resolveFraudDepositItemId).mockResolvedValue(null);
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'FRAUD_DETECTED', sessionId: null, payload: {}, machineCode: 'M1' } as any,
      'evt1',
    );
    expect(mockTx.depositItem.update).not.toHaveBeenCalled();
    expect(fraud.notifyOrgAdmins).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ title: 'Indikasi fraud terdeteksi' }),
    );
  });

  it('handles ITEM_ACCEPTED_POINT calls handleAcceptance', async () => {
    vi.mocked(item.resolveDepositItemId).mockResolvedValue('d1');
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'ITEM_ACCEPTED_POINT', sessionId: 's1' } as any, 'evt1');
    expect(acceptance.handleAcceptance).toHaveBeenCalledWith(mockTx, mockMachine, 's1', 'd1', 'evt1');
  });

  it('handles FRAUD_DETECTED through the locked fraud hold, then flags the session (M04)', async () => {
    vi.mocked(item.resolveFraudDepositItemId).mockResolvedValue('d1');
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'FRAUD_DETECTED', sessionId: 's1', payload: { reason: 'test' }, machineCode: 'M1' } as any, 'evt1');

    expect(fraud.holdItemForFraud).toHaveBeenCalledWith(mockTx, 'd1', 'test');
    // No unlocked ledger or item write from the event handler itself.
    expect(mockTx.rewardLedger.updateMany).not.toHaveBeenCalled();
    expect(mockTx.depositItem.update).not.toHaveBeenCalled();
    expect(mockTx.machineEvent.update).toHaveBeenCalledWith({ where: { id: 'evt1' }, data: { depositItemId: 'd1' } });
    expect(fraud.flagAnomaly).toHaveBeenCalledWith(mockTx, 's1', null, 'test');
    expect(vi.mocked(fraud.holdItemForFraud).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(fraud.flagAnomaly).mock.invocationCallOrder[0]);
    expect(fraud.notifyOrgAdmins).toHaveBeenCalled();
  });

  it('namespaces a fraud reason that claims a review decision (C1)', async () => {
    vi.mocked(item.resolveFraudDepositItemId).mockResolvedValue('d1');
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'FRAUD_DETECTED', sessionId: 's1', payload: { reason: 'REVIEW_APPROVED' }, machineCode: 'M1' } as any, 'evt1');
    expect(fraud.holdItemForFraud).toHaveBeenCalledWith(mockTx, 'd1', 'MACHINE_REVIEW_APPROVED');
    expect(fraud.flagAnomaly).toHaveBeenCalledWith(mockTx, 's1', null, 'MACHINE_REVIEW_APPROVED');
  });

  it('handles SAFE_STATE_ENTERED updates machine and session', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE', startedAt: new Date() });
    vi.mocked(machineState.transitionSession).mockReturnValue('SAFE_STATE' as any);
    
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'SAFE_STATE_ENTERED', sessionId: 's1' } as any, 'evt1');
    
    expect(mockTx.machine.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'ERROR' } }));
    expect(mockTx.depositSession.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SAFE_STATE' }) }));
  });

  it('ITEM_DETECTED trusts linked wasteTypeId from kiosk', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE', startedAt: new Date() });
    mockTx.machineWasteType.findFirst.mockResolvedValue({ id: 'link1' });
    mockTx.depositItem.create.mockResolvedValue({ id: 'd1' });
    const onItemCreated = vi.fn();

    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'ITEM_DETECTED', sessionId: 's1', payload: { wasteTypeId: 'wt-real', quantity: 2 } } as any,
      'evt1',
      onItemCreated,
    );

    expect(mockTx.depositItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          wasteTypeId: 'wt-real',
          source: 'MACHINE',
          status: 'PENDING',
          quantity: 2,
        }),
      }),
    );
    expect(onItemCreated).toHaveBeenCalledWith('d1');
  });

  it('ITEM_DETECTED resolves wasteTypeName and wasteTypeKey fallbacks', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'RESERVED', startedAt: new Date() });
    mockTx.machineWasteType.findFirst.mockResolvedValue(null);
    mockTx.wasteType.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'wt-organik' });
    mockTx.depositItem.create.mockResolvedValue({ id: 'd2' });

    await processEventSideEffects(
      mockTx,
      mockMachine,
      {
        eventType: 'ITEM_DETECTED',
        sessionId: 's1',
        payload: { wasteTypeName: 'Missing (x)', wasteTypeKey: 'botol-organik' },
      } as any,
      'evt2',
    );

    expect(mockTx.wasteType.findFirst).toHaveBeenCalled();
    expect(mockTx.depositItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ wasteTypeId: 'wt-organik', status: 'PENDING' }),
      }),
    );
  });

  it('ITEM_DETECTED uses wasteTypeName when lookup finds a row', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE', startedAt: new Date() });
    mockTx.wasteType.findFirst.mockResolvedValue({ id: 'wt-by-name' });
    mockTx.depositItem.create.mockResolvedValue({ id: 'd-name' });

    await processEventSideEffects(
      mockTx,
      mockMachine,
      {
        eventType: 'ITEM_DETECTED',
        sessionId: 's1',
        payload: { wasteTypeName: 'Organik (PET)' },
      } as any,
      'evt-name',
    );

    expect(mockTx.depositItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ wasteTypeId: 'wt-by-name' }),
      }),
    );
  });

  it('ITEM_DETECTED clears unlinked wasteTypeId then maps anorganik key', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE', startedAt: new Date() });
    mockTx.machineWasteType.findFirst.mockResolvedValue(null);
    mockTx.wasteType.findFirst.mockResolvedValue({ id: 'wt-anorganik' });
    mockTx.depositItem.create.mockResolvedValue({ id: 'd3' });

    await processEventSideEffects(
      mockTx,
      mockMachine,
      {
        eventType: 'ITEM_DETECTED',
        sessionId: 's1',
        payload: { wasteTypeId: 'wt-unlinked', wasteTypeKey: 'kaleng-anorganik' },
      } as any,
      'evt3',
    );

    expect(mockTx.depositItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ wasteTypeId: 'wt-anorganik' }),
      }),
    );
  });

  it('ITEM_DETECTED maps unknown wasteTypeKey to Anorganik default', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE', startedAt: new Date() });
    mockTx.machineWasteType.findFirst.mockResolvedValue(null);
    mockTx.wasteType.findFirst.mockResolvedValue({ id: 'wt-default' });
    mockTx.depositItem.create.mockResolvedValue({ id: 'd4' });

    await processEventSideEffects(
      mockTx,
      mockMachine,
      {
        eventType: 'ITEM_DETECTED',
        sessionId: 's1',
        payload: { wasteTypeKey: 'other-material' },
      } as any,
      'evt4',
    );

    expect(mockTx.wasteType.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { contains: 'Anorganik', mode: 'insensitive' },
        }),
      }),
    );
  });

  it('ITEM_DETECTED breaks when sessionId is missing', async () => {
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'ITEM_DETECTED', payload: { wasteTypeKey: 'x' } } as any,
      'evt0',
    );
    expect(mockTx.depositSession.findUnique).not.toHaveBeenCalled();
  });

  it('ITEM_DETECTED locks the session row, then re-reads it, and extends an open session\'s deadline', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE', timeoutAt: new Date(Date.now() + 1_000), startedAt: new Date() });
    mockTx.machineWasteType.findFirst.mockResolvedValue({ id: 'link1' });
    mockTx.depositItem.create.mockResolvedValue({ id: 'd1' });
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'ITEM_DETECTED', sessionId: 's1', payload: { wasteTypeId: 'wt1' } } as any, 'evt1');
    const lockSql = (mockTx.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(lockSql).toMatch(/FROM "DepositSession" WHERE id = \? FOR NO KEY UPDATE/);
    expect(mockTx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(mockTx.depositSession.findUnique.mock.invocationCallOrder[0]);
    const extended = mockTx.depositSession.update.mock.calls.find((call: any[]) => call[0].data.timeoutAt);
    expect(extended[0].data.timeoutAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
    expect(mockTx.depositItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'PENDING' }) });
  });

  it('ITEM_DETECTED never extends or revives a session whose deadline passed (I1); the item stays PENDING for the timeout policy', async () => {
    for (const stale of [
      { id: 's1', status: 'ACTIVE', timeoutAt: new Date(Date.now() - 1_000), startedAt: new Date(Date.now() - 10 * 60_000) },
      { id: 's1', status: 'REVIEW', timeoutAt: null, startedAt: new Date(Date.now() - 10 * 60_000), updatedAt: new Date() },
    ]) {
      vi.clearAllMocks();
      mockTx.depositSession.findUnique.mockResolvedValue(stale);
      mockTx.machineWasteType.findFirst.mockResolvedValue({ id: 'link1' });
      mockTx.depositItem.create.mockResolvedValue({ id: 'd1' });
      await processEventSideEffects(mockTx, mockMachine, { eventType: 'ITEM_DETECTED', sessionId: 's1', payload: { wasteTypeId: 'wt1' } } as any, 'evt1');
      expect(mockTx.depositSession.update, stale.status).not.toHaveBeenCalled();
      expect(mockTx.depositItem.create, stale.status).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'PENDING' }) });
    }
  });

  it('ITEM_DETECTED never moves a session deadline earlier', async () => {
    const later = new Date(Date.now() + 60 * 60_000);
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'PROCESSING_ITEM', timeoutAt: later, startedAt: new Date() });
    mockTx.machineWasteType.findFirst.mockResolvedValue({ id: 'link1' });
    mockTx.depositItem.create.mockResolvedValue({ id: 'd1' });
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'ITEM_DETECTED', sessionId: 's1', payload: { wasteTypeId: 'wt1' } } as any, 'evt1');
    expect(mockTx.depositSession.update).not.toHaveBeenCalled();
  });

  it('ITEM_DETECTED for an ended session holds the item for review there, without reopening or extending it', async () => {
    for (const status of ['COMPLETED', 'CANCELLED', 'EXPIRED']) {
      vi.clearAllMocks();
      mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status, timeoutAt: new Date(Date.now() - 1_000), startedAt: new Date() });
      mockTx.machineWasteType.findFirst.mockResolvedValue({ id: 'link1' });
      mockTx.depositItem.create.mockResolvedValue({ id: 'd1' });
      await processEventSideEffects(mockTx, mockMachine, { eventType: 'ITEM_DETECTED', sessionId: 's1', payload: { wasteTypeId: 'wt1' } } as any, 'evt1');
      expect(mockTx.depositItem.create, status).toHaveBeenCalledWith({
        data: expect.objectContaining({ sessionId: 's1', status: 'REVIEW', validationReasonCode: 'SESSION_CLOSED' }),
      });
      expect(mockTx.depositSession.update, status).not.toHaveBeenCalled();
    }
  });

  it('ITEM_DETECTED keeps the unknown-type reason for an item reported after the session ended', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'COMPLETED', timeoutAt: null, startedAt: new Date() });
    vi.mocked(item.resolveOrCreateUnknownWasteType).mockResolvedValue('wt-unknown');
    mockTx.depositItem.create.mockResolvedValue({ id: 'd1' });
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'ITEM_DETECTED', sessionId: 's1', payload: {} } as any, 'evt1');
    expect(mockTx.depositItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'REVIEW', validationReasonCode: 'UNKNOWN_WASTE_TYPE' }),
    });
  });

  it('ITEM_DETECTED breaks when the session row cannot be locked', async () => {
    mockTx.$queryRaw.mockResolvedValueOnce([]);
    await processEventSideEffects(mockTx, mockMachine, { eventType: 'ITEM_DETECTED', sessionId: 'gone', payload: {} } as any, 'evt0');
    expect(mockTx.depositSession.findUnique).not.toHaveBeenCalled();
    expect(mockTx.depositItem.create).not.toHaveBeenCalled();
  });

  it('ITEM_DETECTED breaks when session row is missing', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue(null);
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'ITEM_DETECTED', sessionId: 'missing', payload: {} } as any,
      'evt0',
    );
    expect(mockTx.depositItem.create).not.toHaveBeenCalled();
  });

  it('ITEM_DETECTED falls through when wasteTypeName and wasteTypeKey lookups miss', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE', startedAt: new Date() });
    mockTx.wasteType.findFirst.mockResolvedValue(null);
    vi.mocked(item.resolveOrCreateUnknownWasteType).mockResolvedValue('wt-unknown');
    mockTx.depositItem.create.mockResolvedValue({ id: 'd5' });

    await processEventSideEffects(
      mockTx,
      mockMachine,
      {
        eventType: 'ITEM_DETECTED',
        sessionId: 's1',
        payload: { wasteTypeName: 'Ghost', wasteTypeKey: 'ghost-key' },
      } as any,
      'evt5',
    );

    expect(item.resolveOrCreateUnknownWasteType).toHaveBeenCalled();
    expect(mockTx.depositItem.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ wasteTypeId: 'wt-unknown', status: 'REVIEW' }),
      }),
    );
  });

  it('ITEM_DETECTED writes deposit item id into cache when provided', async () => {
    mockTx.depositSession.findUnique.mockResolvedValue({ id: 's1', status: 'ACTIVE', startedAt: new Date() });
    mockTx.machineWasteType.findFirst.mockResolvedValue({ id: 'link1' });
    mockTx.depositItem.create.mockResolvedValue({ id: 'd-cache' });
    const cache = new Map<string, string | null>();

    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'ITEM_DETECTED', sessionId: 's1', payload: { wasteTypeId: 'wt1' } } as any,
      'evt6',
      undefined,
      cache,
    );

    expect(cache.get('s1')).toBe('d-cache');
  });

  it('handles VANDALISM_DETECTED with depositItemId', async () => {
    await processEventSideEffects(
      mockTx,
      mockMachine,
      {
        eventType: 'VANDALISM_DETECTED',
        sessionId: 's1',
        depositItemId: 'd9',
        payload: { reason: 'DOOR_FORCED' },
        machineCode: 'M1',
      } as any,
      'evt9',
    );

    expect(fraud.holdItemForFraud).toHaveBeenCalledWith(mockTx, 'd9', 'DOOR_FORCED');
    expect(fraud.notifyOrgAdmins).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ title: 'Indikasi vandalisme terdeteksi' }),
    );
  });

  it('VANDALISM_DETECTED without depositItemId skips item update', async () => {
    await processEventSideEffects(
      mockTx,
      mockMachine,
      {
        eventType: 'VANDALISM_DETECTED',
        sessionId: 's1',
        payload: { reason: 'DOOR_FORCED' },
        machineCode: 'M1',
      } as any,
      'evt10',
    );
    expect(mockTx.depositItem.update).not.toHaveBeenCalled();
    expect(fraud.holdItemForFraud).not.toHaveBeenCalled();
    expect(fraud.notifyOrgAdmins).toHaveBeenCalled();
  });

  it('ignores unknown event types', async () => {
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'UNKNOWN_EVENT' } as any,
      'evt0',
    );
    expect(mockTx.machine.update).not.toHaveBeenCalled();
  });

  it('STATUS_CHANGED without FULL skips auto pickup', async () => {
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'STATUS_CHANGED', payload: { status: 'ONLINE' }, machineCode: 'M1' } as any,
      'evt1',
    );
    expect(pickup.maybeCreateAutoPickup).not.toHaveBeenCalled();
  });

  it('defers fraud admin notifications to the post-commit collector (R02)', async () => {
    vi.mocked(item.resolveFraudDepositItemId).mockResolvedValue(null);
    const deferred: Array<() => Promise<void>> = [];
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'FRAUD_DETECTED', sessionId: null, payload: {}, machineCode: 'M1' } as any,
      'evt1',
      undefined,
      undefined,
      (effect) => deferred.push(effect),
    );
    expect(fraud.notifyOrgAdmins).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(1);
    await deferred[0]();
    expect(fraud.notifyOrgAdmins).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ title: 'Indikasi fraud terdeteksi' }),
    );
  });

  it.each(['FRAUD_DETECTED', 'VANDALISM_DETECTED'])(
    'publishes a %s security alert scoped to the machine row organization, only after commit (R04)',
    async (eventType) => {
      vi.mocked(item.resolveFraudDepositItemId).mockResolvedValue(null);
      const deferred: Array<() => Promise<void>> = [];
      await processEventSideEffects(
        mockTx,
        mockMachine,
        {
          eventType, sessionId: null, machineCode: 'M1', occurredAt: '2026-10-14T03:00:00.000Z',
          payload: { organizationId: 'org-from-machine-payload' },
        } as any,
        'evt1',
        undefined,
        undefined,
        (effect) => deferred.push(effect),
      );
      expect(fraud.publishSecurityAlert).not.toHaveBeenCalled();
      await deferred[0]();
      expect(fraud.publishSecurityAlert).toHaveBeenCalledWith({
        organizationId: 'o1', machineCode: 'M1', eventType, eventId: 'evt1', occurredAt: '2026-10-14T03:00:00.000Z',
      });
    },
  );

  it('passes the post-commit collector to auto pickup (R02)', async () => {
    const collect = vi.fn();
    await processEventSideEffects(
      mockTx,
      mockMachine,
      { eventType: 'STATUS_CHANGED', payload: { status: 'FULL' }, machineCode: 'M1' } as any,
      'evt1',
      undefined,
      undefined,
      collect,
    );
    expect(pickup.maybeCreateAutoPickup).toHaveBeenCalledWith(mockTx, mockMachine, 'M1', collect);
  });
});
