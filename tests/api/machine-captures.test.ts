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
  verifyMachineSignature: vi.fn(),
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
    vi.mocked(mAuth.verifyMachineSignature).mockReturnValue({ ok: false, reason: 'Invalid' } as any);
    
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
    vi.mocked(mAuth.verifyMachineSignature).mockReturnValue({ ok: true } as any);
    
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
    vi.mocked(mAuth.verifyMachineSignature).mockReturnValue({ ok: true } as any);
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
});
