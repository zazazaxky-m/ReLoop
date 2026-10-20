import { describe, expect, it, vi, beforeEach } from 'vitest';
import { maybeCreateAutoPickup } from '@/lib/machine-events/pickup';
import * as fraud from '@/lib/machine-events/fraud';

vi.mock('@/lib/machine-events/fraud', () => ({
  notifyOrgAdmins: vi.fn(),
}));

const mockTx = {
  pickupRequest: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
} as any;

describe('maybeCreateAutoPickup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates pickup and notifies admins when no open request exists', async () => {
    mockTx.pickupRequest.findFirst.mockResolvedValue(null);
    mockTx.pickupRequest.create.mockResolvedValue({ id: 'p1' });

    await maybeCreateAutoPickup(mockTx, { id: 'm1', organizationId: 'o1' }, 'M1');

    expect(mockTx.pickupRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          machineId: 'm1',
          reason: 'FULL',
          status: 'REQUESTED',
        }),
      }),
    );
    expect(fraud.notifyOrgAdmins).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ type: 'MACHINE_FULL' }),
    );
  });

  it('records the FULL request as the replacement of the latest cancelled/failed task (B05)', async () => {
    mockTx.pickupRequest.findFirst
      .mockResolvedValueOnce(null) // no open pickup
      .mockResolvedValueOnce({ id: 'failed1', status: 'FAILED', replacedBy: null });
    mockTx.pickupRequest.create.mockResolvedValue({ id: 'p2' });

    await maybeCreateAutoPickup(mockTx, { id: 'm1', organizationId: 'o1' }, 'M1');

    expect(mockTx.pickupRequest.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { machineId: 'm1' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    }));
    expect(mockTx.pickupRequest.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ machineId: 'm1', reason: 'FULL', replacesPickupId: 'failed1' }),
    });
  });

  it('links nothing when the latest task completed or was already replaced', async () => {
    for (const latest of [
      { id: 'done1', status: 'COMPLETED', replacedBy: null },
      { id: 'cancel1', status: 'CANCELLED', replacedBy: { id: 'p9' } },
    ]) {
      mockTx.pickupRequest.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(latest);
      mockTx.pickupRequest.create.mockResolvedValue({ id: 'p3' });
      await maybeCreateAutoPickup(mockTx, { id: 'm1', organizationId: 'o1' }, 'M1');
      expect(mockTx.pickupRequest.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ replacesPickupId: null }),
      });
    }
  });

  it('is idempotent when an open pickup already exists', async () => {
    mockTx.pickupRequest.findFirst.mockResolvedValue({ id: 'existing' });

    await maybeCreateAutoPickup(mockTx, { id: 'm1', organizationId: 'o1' }, 'M1');

    expect(mockTx.pickupRequest.create).not.toHaveBeenCalled();
    expect(fraud.notifyOrgAdmins).not.toHaveBeenCalled();
  });

  it('defers the FULL notification to the post-commit collector (R02)', async () => {
    mockTx.pickupRequest.findFirst.mockResolvedValue(null);
    mockTx.pickupRequest.create.mockResolvedValue({ id: 'p1' });
    const deferred: Array<() => Promise<void>> = [];

    await maybeCreateAutoPickup(mockTx, { id: 'm1', organizationId: 'o1' }, 'M1', (effect) => deferred.push(effect));

    expect(fraud.notifyOrgAdmins).not.toHaveBeenCalled();
    expect(deferred).toHaveLength(1);
    await deferred[0]();
    expect(fraud.notifyOrgAdmins).toHaveBeenCalledWith('o1', expect.objectContaining({ type: 'MACHINE_FULL' }));
  });
});
