import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdminDashboardPage from '@/app/dashboard/admin/page';
import { prisma } from '@/lib/prisma';

vi.mock('@/lib/rbac', () => ({
  requirePageUser: vi.fn(async () => ({ id: 'a1', role: 'ADMIN', organizationId: 'org1' })),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    // machineCount, fullMachines, then offlineMachines ("Perlu perhatian").
    machine: { count: vi.fn(async () => 0), findMany: vi.fn(async () => []) },
    pickupRequest: { findMany: vi.fn(async () => []) },
    campaign: { count: vi.fn(async () => 1) },
    depositSession: { count: vi.fn(async () => 0) },
  },
}));

/** Answers the page's three machine counts: total 4, full 1, needing attention `attention`. */
function machineCounts(attention: number) {
  vi.mocked(prisma.machine.count)
    .mockResolvedValueOnce(4)
    .mockResolvedValueOnce(1)
    .mockResolvedValueOnce(attention);
}

describe('admin dashboard page (editorial theme)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emphasizes machines needing attention only when there are some', async () => {
    machineCounts(0);
    expect(renderToStaticMarkup(await AdminDashboardPage())).not.toContain('data-emphasis');

    machineCounts(2);
    const html = renderToStaticMarkup(await AdminDashboardPage());
    expect(html.match(/data-emphasis="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-emphasis="true"[^>]*>(?:(?!data-emphasis)[\s\S])*Perlu perhatian/);
  });

  it("dates the header with today's Jakarta day", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T18:30:00Z'));
    machineCounts(0);
    expect(renderToStaticMarkup(await AdminDashboardPage())).toContain('Selasa, 27 Oktober');
  });
});
