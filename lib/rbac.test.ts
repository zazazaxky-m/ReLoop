import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as rbac from './rbac';
import * as auth from './auth';
import { prisma } from './prisma';
import { redirect } from 'next/navigation';

vi.mock('./auth', () => ({
  readSessionToken: vi.fn(),
  verifySessionToken: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    organizationCollectorPartner: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

describe('lib/rbac', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getCurrentUser', () => {
    it('returns null if no session token', async () => {
      vi.mocked(auth.readSessionToken).mockResolvedValue(undefined);
      const user = await rbac.getCurrentUser();
      expect(user).toBeNull();
    });

    it('returns null if token is invalid', async () => {
      vi.mocked(auth.readSessionToken).mockResolvedValue('invalid_token');
      vi.mocked(auth.verifySessionToken).mockResolvedValue(null);
      const user = await rbac.getCurrentUser();
      expect(user).toBeNull();
    });

    it('returns null if user not found or inactive', async () => {
      vi.mocked(auth.readSessionToken).mockResolvedValue('valid_token');
      vi.mocked(auth.verifySessionToken).mockResolvedValue({ sub: 'user_1', tokenVersion: 0 } as any);
      
      // Not found
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
      expect(await rbac.getCurrentUser()).toBeNull();

      // Inactive
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ status: 'SUSPENDED' } as any);
      expect(await rbac.getCurrentUser()).toBeNull();
    });

    it('returns current user with correct mapped fields', async () => {
      vi.mocked(auth.readSessionToken).mockResolvedValue('valid_token');
      vi.mocked(auth.verifySessionToken).mockResolvedValue({ sub: 'user_1', tokenVersion: 0 } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'user_1',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '123456',
        role: 'ADMIN',
        organizationId: 'org_1',
        payoutEligible: true,
        status: 'ACTIVE',
        tokenVersion: 0,
        organization: { name: 'Acme Corp' },
      } as any);

      const user = await rbac.getCurrentUser();
      expect(user).toEqual({
        id: 'user_1',
        name: 'John Doe',
        email: 'john@example.com',
        phone: '123456',
        role: 'ADMIN',
        organizationId: 'org_1',
        organizationName: 'Acme Corp',
        payoutEligible: true,
        status: 'ACTIVE',
      });
    });
  });

  describe('requirePageUser', () => {
    it('redirects to /login if no user', async () => {
      vi.mocked(auth.readSessionToken).mockResolvedValue(undefined); // No user
      await rbac.requirePageUser();
      expect(redirect).toHaveBeenCalledWith('/login');
    });

    it('redirects to dashboard if user lacks required role', async () => {
      vi.mocked(auth.readSessionToken).mockResolvedValue('valid_token');
      vi.mocked(auth.verifySessionToken).mockResolvedValue({ sub: 'user_1', tokenVersion: 0 } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user_1', role: 'USER', status: 'ACTIVE' } as any);
      
      await rbac.requirePageUser(['ADMIN']);
      expect(redirect).toHaveBeenCalledWith('/dashboard/user');
    });

    it('returns user if authenticated and has required role', async () => {
      vi.mocked(auth.readSessionToken).mockResolvedValue('valid_token');
      vi.mocked(auth.verifySessionToken).mockResolvedValue({ sub: 'user_1', tokenVersion: 0 } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user_1', role: 'ADMIN', status: 'ACTIVE' } as any);
      
      const user = await rbac.requirePageUser(['ADMIN']);
      expect(user.role).toBe('ADMIN');
      expect(redirect).not.toHaveBeenCalled();
    });
  });

  describe('requireApiUser', () => {
    it('throws 401 if no user', async () => {
      vi.mocked(auth.readSessionToken).mockResolvedValue(undefined);
      await expect(rbac.requireApiUser()).rejects.toThrow(rbac.HttpError);
      await expect(rbac.requireApiUser()).rejects.toHaveProperty('status', 401);
    });

    it('throws 403 if user lacks required role', async () => {
      vi.mocked(auth.readSessionToken).mockResolvedValue('valid_token');
      vi.mocked(auth.verifySessionToken).mockResolvedValue({ sub: 'user_1', tokenVersion: 0 } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user_1', role: 'USER', status: 'ACTIVE' } as any);
      
      await expect(rbac.requireApiUser(['ADMIN'])).rejects.toThrow(rbac.HttpError);
      await expect(rbac.requireApiUser(['ADMIN'])).rejects.toHaveProperty('status', 403);
    });

    it('returns user if authenticated and has required role', async () => {
      vi.mocked(auth.readSessionToken).mockResolvedValue('valid_token');
      vi.mocked(auth.verifySessionToken).mockResolvedValue({ sub: 'user_1', tokenVersion: 0 } as any);
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user_1', role: 'ADMIN', status: 'ACTIVE' } as any);
      
      const user = await rbac.requireApiUser(['ADMIN', 'SUPERADMIN']);
      expect(user.role).toBe('ADMIN');
    });
  });

  describe('assertOrgScope', () => {
    const orgId = 'org_1';
    
    it('allows SUPERADMIN regardless of organization', () => {
      const user = { role: 'SUPERADMIN', organizationId: null } as rbac.CurrentUser;
      expect(() => rbac.assertOrgScope(user, orgId)).not.toThrow();
    });

    it('allows ADMIN if organization matches', () => {
      const user = { role: 'ADMIN', organizationId: orgId } as rbac.CurrentUser;
      expect(() => rbac.assertOrgScope(user, orgId)).not.toThrow();
    });

    it('throws 403 if ADMIN organization does not match', () => {
      const user = { role: 'ADMIN', organizationId: 'org_2' } as rbac.CurrentUser;
      expect(() => rbac.assertOrgScope(user, orgId)).toThrow(rbac.HttpError);
    });

    it('throws 403 for other roles', () => {
      const user = { role: 'USER', organizationId: orgId } as rbac.CurrentUser;
      expect(() => rbac.assertOrgScope(user, orgId)).toThrow(rbac.HttpError);
    });
  });

  describe('Partnership logic', () => {
    it('assertActivePartnership throws 403 if not active', async () => {
      vi.mocked(prisma.organizationCollectorPartner.findFirst).mockResolvedValue(null);
      await expect(rbac.assertActivePartnership('coll_1', 'org_1')).rejects.toThrow(rbac.HttpError);
    });

    it('assertActivePartnership returns partner if active', async () => {
      const mockPartner = { id: 'partner_1' } as any;
      vi.mocked(prisma.organizationCollectorPartner.findFirst).mockResolvedValue(mockPartner);
      const partner = await rbac.assertActivePartnership('coll_1', 'org_1');
      expect(partner).toEqual(mockPartner);
    });

    it('activePartnerOrgIds returns list of org IDs', async () => {
      vi.mocked(prisma.organizationCollectorPartner.findMany).mockResolvedValue([
        { organizationId: 'org_1' },
        { organizationId: 'org_2' },
      ] as any);
      const orgIds = await rbac.activePartnerOrgIds('coll_1');
      expect(orgIds).toEqual(['org_1', 'org_2']);
    });
  });
});
