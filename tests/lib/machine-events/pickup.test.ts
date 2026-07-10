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

  it('is idempotent when an open pickup already exists', async () => {
    mockTx.pickupRequest.findFirst.mockResolvedValue({ id: 'existing' });

    await maybeCreateAutoPickup(mockTx, { id: 'm1', organizationId: 'o1' }, 'M1');

    expect(mockTx.pickupRequest.create).not.toHaveBeenCalled();
    expect(fraud.notifyOrgAdmins).not.toHaveBeenCalled();
  });
});
