import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as auth from './auth';

vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

describe('lib/auth', () => {
  const mockPayload: auth.SessionPayload = {
    sub: 'user_1',
    email: 'test@example.com',
    name: 'Test User',
    role: 'USER',
    organizationId: null,
    tokenVersion: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Password Hashing', () => {
    it('should hash a password and verify it successfully', async () => {
      const password = 'mySuperSecretPassword123';
      const hash = await auth.hashPassword(password);
      
      expect(hash).not.toBe(password);
      expect(hash).toContain('$2a$'); // bcrypt prefix
      
      const isValid = await auth.verifyPassword(password, hash);
      expect(isValid).toBe(true);
    });

    it('should fail verification for incorrect password', async () => {
      const password = 'password123';
      const hash = await auth.hashPassword(password);
      
      const isValid = await auth.verifyPassword('wrongpassword', hash);
      expect(isValid).toBe(false);
    });
  });

  describe('JWT Sessions', () => {
    it('should sign and verify a session token', async () => {
      const token = await auth.signSession(mockPayload);
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);

      const verified = await auth.verifySessionToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.sub).toBe(mockPayload.sub);
      expect(verified?.email).toBe(mockPayload.email);
      expect(verified?.name).toBe(mockPayload.name);
      expect(verified?.role).toBe(mockPayload.role);
    });

    it('should return null for an invalid token', async () => {
      const verified = await auth.verifySessionToken('invalid.token.string');
      expect(verified).toBeNull();
    });

    it('defaults missing tokenVersion to 0 when verifying', async () => {
      const { SignJWT } = await import('jose');
      const secret = new TextEncoder().encode('dev-insecure-secret-change-me');
      // Build a token without tokenVersion claim.
      const token = await new SignJWT({
        email: 't@x.com',
        name: 'T',
        role: 'USER',
        organizationId: null,
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject('user_x')
        .setExpirationTime('1h')
        .sign(secret);

      const verified = await auth.verifySessionToken(token);
      expect(verified?.tokenVersion).toBe(0);
    });
  });

  describe('Cookie Management', () => {
    it('should set session cookie', async () => {
      const mockSet = vi.fn();
      const { cookies } = await import('next/headers');
      vi.mocked(cookies).mockResolvedValue({ set: mockSet } as any);

      await auth.setSessionCookie(mockPayload);

      expect(mockSet).toHaveBeenCalledWith(
        auth.SESSION_COOKIE,
        expect.any(String),
        expect.objectContaining({
          httpOnly: true,
          path: '/',
          sameSite: 'lax',
        })
      );
    });

    it('should clear session cookie', async () => {
      const mockSet = vi.fn();
      const { cookies } = await import('next/headers');
      vi.mocked(cookies).mockResolvedValue({ set: mockSet } as any);

      await auth.clearSessionCookie();

      expect(mockSet).toHaveBeenCalledWith(
        auth.SESSION_COOKIE,
        '',
        expect.objectContaining({ maxAge: 0 })
      );
    });

    it('should read session token from cookies', async () => {
      const { cookies } = await import('next/headers');
      vi.mocked(cookies).mockResolvedValue({ 
        get: vi.fn().mockReturnValue({ value: 'mock_token' })
      } as any);

      const token = await auth.readSessionToken();
      expect(token).toBe('mock_token');
    });
  });
});
