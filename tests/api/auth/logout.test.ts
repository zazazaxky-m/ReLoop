import { describe, expect, it, vi } from 'vitest';
import { POST } from '@/app/api/auth/logout/route';
import * as auth from '@/lib/auth';

vi.mock('@/lib/auth', () => ({
  clearSessionCookie: vi.fn(),
}));

describe('POST /api/auth/logout', () => {
  it('clears session cookie and returns ok', async () => {
    const res = await POST();
    expect(auth.clearSessionCookie).toHaveBeenCalled();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('returns handled error when clearing the session fails', async () => {
    vi.mocked(auth.clearSessionCookie).mockRejectedValueOnce(new Error('cookie clear failed'));
    const res = await POST();
    expect(res.status).toBe(500);
  });
});
