import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/machine-events/route';
import { prisma } from '@/lib/prisma';
import * as mAuth from '@/lib/machine-auth';
import * as me from '@/lib/machine-events';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machine: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/machine-auth', () => ({
  verifyMachineSignature: vi.fn(),
}));

vi.mock('@/lib/machine-events', () => ({
  ingestMachineEvent: vi.fn(),
}));

describe('POST /api/machine-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (body: any) => new NextRequest('http://localhost/api/machine-events', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'x-reloop-timestamp': '1234567890',
      'x-reloop-nonce': 'nonce',
      'x-reloop-signature': 'sig',
    },
  });

  it('fails if machine not found (404)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    const res = await POST(makeReq({ machineCode: 'm1', events: [] }));
    expect(res.status).toBe(404);
  });

  it('fails if signature is invalid (401)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineSignature).mockReturnValue({ ok: false, reason: 'Invalid' } as any);
    
    const res = await POST(makeReq({ machineCode: 'm1', events: [] }));
    expect(res.status).toBe(401);
  });

  it('processes batch events successfully (200)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineSignature).mockReturnValue({ ok: true } as any);
    
    vi.mocked(me.ingestMachineEvent)
      .mockResolvedValueOnce({ duplicate: false, eventId: 'evt_1' } as any)
      .mockResolvedValueOnce({ duplicate: true, eventId: 'evt_2' } as any)
      .mockRejectedValueOnce(new Error('Processing error'));

    const res = await POST(makeReq({ 
      machineCode: 'm1', 
      events: [
        { localEventId: '1', eventType: 'HEARTBEAT' },
        { localEventId: '2', eventType: 'STATUS_CHANGED' },
        { localEventId: '3', eventType: 'UNKNOWN' }
      ] 
    }));
    
    expect(res.status).toBe(200);
    const data = await res.json();
    
    expect(data.received).toBe(3);
    expect(data.results[0]).toEqual({ localEventId: '1', status: 'accepted', eventId: 'evt_1' });
    expect(data.results[1]).toEqual({ localEventId: '2', status: 'duplicate', eventId: 'evt_2' });
    expect(data.results[2]).toEqual({ localEventId: '3', status: 'error', error: 'Processing error' });
    
    expect(me.ingestMachineEvent).toHaveBeenCalledTimes(3);
  });
});
