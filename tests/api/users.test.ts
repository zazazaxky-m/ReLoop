import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, POST } from '@/app/api/users/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';
import * as audit from '@/lib/audit';
import * as auth from '@/lib/auth';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  hashPassword: vi.fn(),
}));

describe('/api/users API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    const makeGetReq = (url: string = 'http://localhost/api/users') => {
      return new Request(url);
    };

    it('requires SUPERADMIN role', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await GET(makeGetReq());
      expect(res.status).toBe(403);
    });

    it('returns list of users', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.user.count).mockResolvedValue(1);
      vi.mocked(prisma.user.findMany).mockResolvedValue([
        { id: '1', name: 'John', email: 'john@a.com', role: 'USER', status: 'ACTIVE' }
      ] as any);

      const res = await GET(makeGetReq());
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.users).toHaveLength(1);
      expect(data.users[0].name).toBe('John');
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: { createdAt: 'desc' }
      }));
    });

    it('filters by role if provided in query string', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
      vi.mocked(prisma.user.count).mockResolvedValue(0);
      vi.mocked(prisma.user.findMany).mockResolvedValue([]);

      await GET(makeGetReq('http://localhost/api/users?role=ADMIN'));
      
      expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: { role: 'ADMIN' }
      }));
    });
  });

  describe('POST', () => {
    const makePostReq = (body: any) => {
      return new Request('http://localhost/api/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });
    };

    it('requires SUPERADMIN role', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(403, 'Forbidden'));
      const res = await POST(makePostReq({}));
      expect(res.status).toBe(403);
    });

    it('fails with validation error (422)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
      const res = await POST(makePostReq({ name: 'A' })); // Missing required fields
      expect(res.status).toBe(422);
    });

    it('fails if email already registered (409)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'existing' } as any);

      const req = makePostReq({ name: 'Test', email: 'test@example.com', password: 'password1234', role: 'USER' });
      const res = await POST(req);
      
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.error).toBe('Email sudah terdaftar');
    });

    it('fails if ADMIN role but no organizationId (422)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const req = makePostReq({ name: 'Admin', email: 'admin@a.com', password: 'password1234', role: 'ADMIN' }); // No orgId
      const res = await POST(req);
      
      expect(res.status).toBe(422);
      const data = await res.json();
      expect(data.error).toContain('Admin wajib terhubung ke organisasi');
    });

    it('creates user successfully and logs audit (201)', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(auth.hashPassword).mockResolvedValue('hashed');
      vi.mocked(prisma.user.create).mockResolvedValue({ id: 'new', email: 'new@a.com', role: 'USER' } as any);

      const req = makePostReq({ name: 'New User', email: 'NEW@a.com', password: 'password1234', role: 'USER' });
      const res = await POST(req);

      expect(res.status).toBe(201);
      
      expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ email: 'new@a.com', role: 'USER', passwordHash: 'hashed' })
      }));
      expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'USER_CREATE', actorId: 'admin' }));
    });

    it('creates PENGEPUL with organizationId successfully', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(auth.hashPassword).mockResolvedValue('hashed');
      vi.mocked(prisma.user.create).mockResolvedValue({ id: 'new', email: 'new@a.com', role: 'PENGEPUL' } as any);

      const req = makePostReq({ name: 'New User', email: 'NEW@a.com', password: 'password1234', role: 'PENGEPUL', organizationId: 'org1' });
      const res = await POST(req);

      expect(res.status).toBe(201);
      expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org1', role: 'PENGEPUL' })
      }));
    });

    it('creates ADMIN with organizationId', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'admin' } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      vi.mocked(auth.hashPassword).mockResolvedValue('hashed');
      vi.mocked(prisma.user.create).mockResolvedValue({ id: 'new', email: 'admin@a.com', role: 'ADMIN' } as any);

      const req = makePostReq({
        name: 'Admin',
        email: 'admin@a.com',
        password: 'password1234',
        role: 'ADMIN',
        organizationId: 'org1',
      });
      const res = await POST(req);

      expect(res.status).toBe(201);
      expect(prisma.user.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ organizationId: 'org1', role: 'ADMIN' }),
      }));
    });

    it('handles unexpected errors', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('Unexpected POST error'));
      const req = makePostReq({ name: 'New User', email: 'NEW@a.com', password: 'password1234', role: 'USER' });
      const res = await POST(req);
      expect(res.status).toBe(500);
    });
  });
});
