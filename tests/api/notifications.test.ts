import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET, PATCH } from '@/app/api/notifications/route';
import * as rbac from '@/lib/rbac';
import * as notifications from '@/lib/notifications';

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) { super(message); }
  },
}));

vi.mock('@/lib/notifications', () => ({
  listNotifications: vi.fn(),
  getUnreadCount: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

describe('Notifications API', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('GET', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(401, 'Unauthorized'));
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it('returns notifications and unread count', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(notifications.listNotifications).mockResolvedValue([
        { id: 'n1', title: 'Test', body: 'Test notification' },
      ] as any);
      vi.mocked(notifications.getUnreadCount).mockResolvedValue(1);

      const res = await GET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.notifications).toHaveLength(1);
      expect(data.unreadCount).toBe(1);
    });
  });

  describe('PATCH', () => {
    it('returns 401 when not authenticated', async () => {
      vi.mocked(rbac.requireApiUser).mockRejectedValue(new (rbac as any).HttpError(401, 'Unauthorized'));
      const res = await PATCH(new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({}),
      }));
      expect(res.status).toBe(401);
    });

    it('marks specific notifications as read', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(notifications.markNotificationsRead).mockResolvedValue(2);

      const res = await PATCH(new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({ ids: ['n1', 'n2'] }),
      }));
      expect(res.status).toBe(200);
      expect(notifications.markNotificationsRead).toHaveBeenCalledWith('u1', ['n1', 'n2']);
    });

    it('marks all notifications as read when ids omitted', async () => {
      vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1' } as any);
      vi.mocked(notifications.markNotificationsRead).mockResolvedValue(5);

      const res = await PATCH(new Request('http://localhost', {
        method: 'PATCH', body: JSON.stringify({}),
      }));
      expect(res.status).toBe(200);
      expect(notifications.markNotificationsRead).toHaveBeenCalledWith('u1', undefined);
    });
  });
});
