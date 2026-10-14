import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import SuperadminDashboardPage from '@/app/dashboard/superadmin/page';
import { formatRupiah } from '@/lib/format';
import { prisma } from '@/lib/prisma';
import { getLiabilitySummary } from '@/lib/reconciliation-report';

vi.mock('@/lib/rbac', () => ({ requirePageUser: vi.fn(async () => ({ id: 's1', role: 'SUPERADMIN' })) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    organization: { count: vi.fn(async () => 2) },
    machine: { count: vi.fn(async () => 3) },
    user: { count: vi.fn(async () => 4) },
    depositItem: { count: vi.fn(async () => 5) },
    // Gross EARN AVAILABLE (100.000) of which 40.000 was already paid out.
    rewardLedger: { aggregate: vi.fn(async () => ({ _sum: { amount: 100_000 } })) },
    organizationCollectorPartner: { count: vi.fn(async () => 0) },
  },
}));
vi.mock('@/lib/config', () => ({ getMinRedemption: vi.fn(async () => 10_000) }));
vi.mock('@/lib/security-events', () => ({
  getSecuritySummary: vi.fn(async () => ({ alerts24h: 0 })),
  getSecurityEvents: vi.fn(async () => []),
}));
vi.mock('@/lib/reconciliation-report', () => ({
  getLiabilitySummary: vi.fn(async () => ({
    availableLiability: 60_000, pendingLiability: 0, reservedLiability: 0, paidTotal: 40_000, totalObligation: 60_000,
  })),
}));

/** Props of every element in the returned tree that carries a label and a value (MetricCard). */
function metricCards(node: ReactNode): Array<{ label: unknown; value: unknown; hint?: unknown }> {
  if (Array.isArray(node)) return node.flatMap(metricCards);
  if (!isValidElement(node)) return [];
  const props = node.props as { label?: unknown; value?: unknown; hint?: unknown; children?: ReactNode };
  const own = props.label !== undefined && 'value' in props ? [{ label: props.label, value: props.value, hint: props.hint }] : [];
  return [...own, ...metricCards(props.children)];
}

describe('superadmin dashboard page (M05 fix round 1)', () => {
  it('shows the net spendable liability, the same figure as the mobile overview, never the gross earning', async () => {
    const cards = metricCards(await SuperadminDashboardPage());
    const reward = cards.find((card) => card.label === 'Reward tersedia');
    expect(reward?.value).toBe(formatRupiah(60_000));
    expect(getLiabilitySummary).toHaveBeenCalledTimes(1);
    expect(prisma.rewardLedger.aggregate).not.toHaveBeenCalled();
  });
});
