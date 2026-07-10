import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/machine-events/route';
import { prisma } from '@/lib/prisma';
import * as mAuth from '@/lib/machine-auth';
import * as me from '@/lib/machine-events';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machine: { findUnique: vi.fn() },
    machineEvent: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/machine-auth', () => ({
  verifyMachineRequest: vi.fn(),
}));

vi.mock('@/lib/machine-events', () => ({
  ingestMachineEvent: vi.fn(),
}));

describe('POST /api/machine-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.machineEvent.findMany).mockResolvedValue([]);
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
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: false, reason: 'Invalid' } as any);
    
    const res = await POST(makeReq({ machineCode: 'm1', events: [] }));
    expect(res.status).toBe(401);
  });

  it('falls back to Unauthorised when verify reason is empty', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: false, reason: '' } as any);

    const res = await POST(makeReq({ machineCode: 'm1', events: [] }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('processes batch events successfully (200)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: 'm1',
      ingestSecret: 'secret',
      organization: { id: 'org1' },
    } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    
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
    expect(data.results[2]).toEqual({ localEventId: '3', status: 'error', error: 'EVENT_REJECTED' });
    
    expect(me.ingestMachineEvent).toHaveBeenCalledTimes(3);
  });

  it('short-circuits known duplicates from DB before ingest', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: 'm1',
      ingestSecret: 'secret',
      organization: { id: 'org1' },
    } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineEvent.findMany).mockResolvedValue([
      { localEventId: 'dup1', id: 'evt_db', depositItemId: null },
    ] as any);

    const res = await POST(makeReq({
      machineCode: 'm1',
      events: [{ localEventId: 'dup1', eventType: 'HEARTBEAT' }],
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results[0]).toEqual({
      localEventId: 'dup1',
      status: 'duplicate',
      eventId: 'evt_db',
    });
    expect(me.ingestMachineEvent).not.toHaveBeenCalled();
  });

  it('skips findMany when events array is empty', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: 'm1',
      ingestSecret: 'secret',
      organization: { id: 'org1' },
    } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);

    const res = await POST(makeReq({ machineCode: 'm1', events: [] }));
    expect(res.status).toBe(200);
    expect(prisma.machineEvent.findMany).not.toHaveBeenCalled();
  });

  it('returns 404 when machine has no ingest secret', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: 'm1',
      ingestSecret: null,
      organization: { id: 'org1' },
    } as any);
    const res = await POST(makeReq({ machineCode: 'm1', events: [] }));
    expect(res.status).toBe(404);
  });

  it('marks accepted ingest as duplicate cache for later events in batch', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      id: 'm1',
      ingestSecret: 'secret',
      organization: { id: 'org1' },
    } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(me.ingestMachineEvent).mockResolvedValue({
      duplicate: false,
      eventId: 'evt_new',
      depositItemId: 'di1',
    } as any);

    const res = await POST(makeReq({
      machineCode: 'm1',
      events: [
        { localEventId: 'same', eventType: 'HEARTBEAT' },
        { localEventId: 'same', eventType: 'HEARTBEAT' },
      ],
    }));
    const data = await res.json();
    expect(data.results[0].status).toBe('accepted');
    expect(data.results[1]).toEqual({
      localEventId: 'same',
      status: 'duplicate',
      eventId: 'evt_new',
    });
    expect(me.ingestMachineEvent).toHaveBeenCalledTimes(1);
  });

  it('returns handled error on unexpected failure', async () => {
    vi.mocked(prisma.machine.findUnique).mockRejectedValue(new Error('events boom'));
    expect((await POST(makeReq({ machineCode: 'm1', events: [] }))).status).toBe(500);
  });
});
