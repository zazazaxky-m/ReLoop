import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as auth from './auth';
import { signMfaChallenge } from './mfa';
import { SignJWT, decodeJwt, type JWTPayload } from 'jose';

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
      expect(hash).toMatch(/^\$2[aby]\$12\$/); // bcrypt cost 12

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
    it('rejects a valid MFA challenge as a session', async () => {
      const token = await signMfaChallenge('audit-user', 0);
      expect(await auth.verifySessionToken(token)).toBeNull();
    });
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
      // R04: the realtime verifier needs the verified expiry (Unix seconds).
      expect(verified?.expiresAt).toBe(decodeJwt(token).exp);
    });

    it('should return null for an invalid token', async () => {
      const verified = await auth.verifySessionToken('invalid.token.string');
      expect(verified).toBeNull();
    });

    it('includes the session purpose, issuer and audience', async () => {
      expect(decodeJwt(await auth.signSession(mockPayload))).toMatchObject({
        purpose: 'session', iss: 'reloop', aud: 'reloop-session', tokenVersion: 0,
      });
    });

    it.each([
      ['legacy', { purpose: undefined, iss: undefined, aud: undefined }],
      ['missing purpose', { purpose: undefined }], ['MFA purpose', { purpose: 'mfa' }],
      ['wrong audience', { aud: 'reloop-mfa' }], ['wrong issuer', { iss: 'other' }],
      ['missing version', { tokenVersion: undefined }], ['string version', { tokenVersion: '0' }],
      ['negative version', { tokenVersion: -1 }], ['fractional version', { tokenVersion: 0.5 }],
      ['empty subject', { sub: '' }], ['missing name', { name: undefined }],
      ['invalid email type', { email: 42 }], ['invalid role', { role: 'ROOT' }],
      ['missing organization', { organizationId: undefined }],
      ['invalid organization', { organizationId: 4 }], ['missing issued time', { iat: undefined }],
      ['invalid issued time', { iat: 'now' }], ['missing expiry', { exp: undefined }],
      ['expired', { exp: 1 }],
    ])('rejects %s claims', async (_label, overrides) => {
      const now = Math.floor(Date.now() / 1000);
      const token = await new SignJWT({ ...mockPayload, purpose: 'session', iss: 'reloop',
        aud: 'reloop-session', iat: now, exp: now + 60, ...overrides } as unknown as JWTPayload)
        .setProtectedHeader({ alg: 'HS256' })
        .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET || 'dev-insecure-secret-change-me'));
      expect(await auth.verifySessionToken(token)).toBeNull();
    });

    it('rejects a correctly signed token using another algorithm', async () => {
      const token = await new SignJWT({ ...mockPayload, purpose: 'session' })
        .setIssuer('reloop').setAudience('reloop-session').setIssuedAt().setExpirationTime('1m')
        .setProtectedHeader({ alg: 'HS384' })
        .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET || 'dev-insecure-secret-change-me'));
      expect(await auth.verifySessionToken(token)).toBeNull();
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
