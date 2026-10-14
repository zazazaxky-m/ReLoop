import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/machines/[id]/remote-commands/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as realtime from '@/lib/realtime';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    machine: { findUnique: vi.fn() },
    machineRemoteCommand: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/realtime', () => ({ publishRealtime: vi.fn() }));
vi.mock('@/lib/remote-commands', () => ({ REMOTE_COMMAND_EXPIRY_SECONDS: 3600 }));
vi.mock('@prisma/client', () => ({
  RemoteCommandType: { RESTART_APP: 'RESTART_APP', REBOOT: 'REBOOT' },
}));

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

describe('Remote Commands API', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET', () => {
    it('returns 403 when not SUPERADMIN', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await GET(new Request('http://localhost'), makeParams('m1'));
      expect(res.status).toBe(403);
    });

    it('returns 404 when machine not found', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);
      const res = await GET(new Request('http://localhost'), makeParams('m1'));
      expect(res.status).toBe(404);
    });

    it('expires stale commands and returns list', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1' } as any);
      vi.mocked(prisma.machineRemoteCommand.updateMany).mockResolvedValue({ count: 1 } as any);
      vi.mocked(prisma.machineRemoteCommand.findMany).mockResolvedValue([
        { id: 'cmd1', command: 'REBOOT', status: 'COMPLETED' },
      ] as any);

      const res = await GET(new Request('http://localhost'), makeParams('m1'));
      expect(res.status).toBe(200);
      expect(prisma.machineRemoteCommand.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'EXPIRED' }) })
      );
      const data = await res.json();
      expect(data.commands).toHaveLength(1);
    });
  });

  describe('POST', () => {
    it('returns 404 when machine is missing on POST', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue(null);

      const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ command: 'REBOOT' }) });
      const res = await POST(req, makeParams('m1'));
      expect(res.status).toBe(404);
    });

    it('returns 422 if machine lacks ingestSecret', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: null } as any);

      const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ command: 'REBOOT' }) });
      const res = await POST(req, makeParams('m1'));
      expect(res.status).toBe(422);
    });

    it('returns duplicate flag if identical pending command exists', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', ingestSecret: 'secret' } as any);
      vi.mocked(prisma.machineRemoteCommand.findFirst).mockResolvedValue({ id: 'cmd1' } as any);

      const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ command: 'REBOOT' }) });
      const res = await POST(req, makeParams('m1'));
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.duplicate).toBe(true);
    });

    it('creates new command and publishes realtime event', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockResolvedValue({ id: 'm1', machineCode: 'M1', ingestSecret: 'secret', organizationId: 'org-a' } as any);
      vi.mocked(prisma.machineRemoteCommand.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.machineRemoteCommand.create).mockResolvedValue({ id: 'cmd2', command: 'RESTART_APP' } as any);

      const req = new Request('http://localhost', { method: 'POST', body: JSON.stringify({ command: 'RESTART_APP' }) });
      const res = await POST(req, makeParams('m1'));
      expect(res.status).toBe(201);
      
      const data = await res.json();
      expect(data.duplicate).toBe(false);
      expect(realtime.publishRealtime).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'REMOTE_COMMAND_QUEUED', machineCode: 'M1', organizationId: 'org-a' })
      );
      // R04: the organization comes from the machine row.
      expect(prisma.machine.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ select: expect.objectContaining({ organizationId: true }) })
      );
    });

    it('handles unexpected POST errors', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.machine.findUnique).mockRejectedValue(new Error('db down'));

      const req = new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ command: 'REBOOT' }),
      });
      const res = await POST(req, makeParams('m1'));
      expect(res.status).toBe(500);
    });
  });
});
