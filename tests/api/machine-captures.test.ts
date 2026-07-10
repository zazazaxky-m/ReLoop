import { describe, expect, it, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/machine-captures/route';
import { prisma } from '@/lib/prisma';
import * as mAuth from '@/lib/machine-auth';
import * as fs from 'node:fs/promises';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machine: { findUnique: vi.fn() },
    machineCapture: { findUnique: vi.fn(), create: vi.fn() },
    depositSession: { findFirst: vi.fn() },
  },
}));

vi.mock('@/lib/machine-auth', () => ({
  verifyMachineRequest: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

describe('POST /api/machine-captures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const validJpegBase64 = Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString('base64');
  
  const makeReq = (body: any, headers: Record<string, string> = {}) => new Request('http://localhost/api/machine-captures', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'x-reloop-timestamp': '1234567890',
      'x-reloop-nonce': 'nonce',
      'x-reloop-signature': 'sig',
      'x-reloop-machine': body.machineCode,
      ...headers,
    },
  });

  it('fails if signature is invalid (401)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: false, reason: 'Invalid' } as any);
    
    const res = await POST(makeReq({ 
      machineCode: 'm1', 
      localCaptureId: 'b337852c-bd32-4752-b8de-8a07f0bb0020',
      kind: 'FACE',
      reason: 'FRAUD_DETECTED',
      occurredAt: new Date().toISOString(),
      sceneBase64: validJpegBase64,
    }));
    expect(res.status).toBe(401);
  });

  it('fails if jpeg is invalid (422)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    
    const res = await POST(makeReq({ 
      machineCode: 'm1', 
      localCaptureId: 'b337852c-bd32-4752-b8de-8a07f0bb0020',
      kind: 'FACE',
      reason: 'FRAUD_DETECTED',
      occurredAt: new Date().toISOString(),
      sceneBase64: 'invalid_base64_not_jpeg',
    }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Encoding gambar tidak valid');
  });

  it('saves capture successfully (201)', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineCapture.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.machineCapture.create).mockResolvedValue({ id: 'cap_1' } as any);
    
    const reqBody = { 
      machineCode: 'm1', 
      localCaptureId: 'b337852c-bd32-4752-b8de-8a07f0bb0020',
      kind: 'FACE',
      reason: 'FRAUD_DETECTED',
      occurredAt: new Date().toISOString(),
      sceneBase64: validJpegBase64,
    };
    
    const res = await POST(makeReq(reqBody));
    expect(res.status).toBe(201);
    
    expect(fs.mkdir).toHaveBeenCalled();
    expect(fs.writeFile).toHaveBeenCalled();
    expect(prisma.machineCapture.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ localCaptureId: reqBody.localCaptureId })
    }));
  });

  it('returns 404 when machine is missing', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
    const res = await POST(makeReq({
      machineCode: 'missing',
      localCaptureId: 'b337852c-bd32-4752-b8de-8a07f0bb0020',
      kind: 'FACE',
      reason: 'FRAUD_DETECTED',
      occurredAt: new Date().toISOString(),
      sceneBase64: validJpegBase64,
    }));
    expect(res.status).toBe(404);
  });

  it('rejects mismatched machine header', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);

    const res = await POST(makeReq({
      machineCode: 'm1',
      localCaptureId: 'b337852c-bd32-4752-b8de-8a07f0bb0020',
      kind: 'FACE',
      reason: 'FRAUD_DETECTED',
      occurredAt: new Date().toISOString(),
      sceneBase64: validJpegBase64,
    }, { 'x-reloop-machine': 'other' }));
    expect(res.status).toBe(401);
  });

  it('returns duplicate capture without rewriting files', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineCapture.findUnique).mockResolvedValue({ id: 'cap_dup' } as any);

    const res = await POST(makeReq({
      machineCode: 'm1',
      localCaptureId: 'b337852c-bd32-4752-b8de-8a07f0bb0020',
      kind: 'FACE',
      reason: 'FRAUD_DETECTED',
      occurredAt: new Date().toISOString(),
      sceneBase64: validJpegBase64,
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.duplicate).toBe(true);
    expect(fs.writeFile).not.toHaveBeenCalled();
  });

  it('clears invalid sessionId and stores face crops', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineCapture.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.depositSession.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.machineCapture.create).mockResolvedValue({ id: 'cap_2' } as any);

    const res = await POST(makeReq({
      machineCode: 'm1',
      localCaptureId: 'b337852c-bd32-4752-b8de-8a07f0bb0021',
      kind: 'FACE',
      reason: 'FRAUD_DETECTED',
      sessionId: 'sess-missing',
      occurredAt: new Date().toISOString(),
      sceneBase64: validJpegBase64,
      facesBase64: [validJpegBase64],
      metadata: { personDetected: true },
    }));
    expect(res.status).toBe(201);
    expect(fs.writeFile).toHaveBeenCalledTimes(2);
    expect(prisma.machineCapture.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionId: null,
          faceCount: 1,
          personDetected: true,
        }),
      }),
    );
  });

  it('returns 422 for non-jpeg binary payload', async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
    vi.mocked(mAuth.verifyMachineRequest).mockResolvedValue({ ok: true } as any);
    vi.mocked(prisma.machineCapture.findUnique).mockResolvedValue(null);
    const notJpeg = Buffer.from([0x00, 0x01, 0x02, 0x03]).toString('base64');

    const res = await POST(makeReq({
      machineCode: 'm1',
      localCaptureId: 'b337852c-bd32-4752-b8de-8a07f0bb0022',
      kind: 'FACE',
      reason: 'FRAUD_DETECTED',
      occurredAt: new Date().toISOString(),
      sceneBase64: notJpeg,
    }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe('Bukti kamera harus berupa JPEG yang valid');
  });

  it('returns handled error for unexpected failures', async () => {
    vi.mocked(prisma.machine.findUnique).mockRejectedValue(new Error('captures boom'));
    const res = await POST(makeReq({
      machineCode: 'm1',
      localCaptureId: 'b337852c-bd32-4752-b8de-8a07f0bb0020',
      kind: 'FACE',
      reason: 'FRAUD_DETECTED',
      occurredAt: new Date().toISOString(),
      sceneBase64: validJpegBase64,
    }));
    expect(res.status).toBe(500);
  });

  it('returns 422 for invalid JSON body', async () => {
    const res = await POST(new Request('http://localhost/api/machine-captures', {
      method: 'POST',
      body: '{not-json',
      headers: {
        'x-reloop-timestamp': '1234567890',
        'x-reloop-nonce': 'nonce',
        'x-reloop-signature': 'sig',
        'x-reloop-machine': 'm1',
      },
    }));
    expect(res.status).toBe(422);
  });
});
