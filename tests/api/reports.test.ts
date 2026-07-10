import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/reports/route';
import { prisma } from '@/lib/prisma';
import * as rbac from '@/lib/rbac';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    depositItem: { findMany: vi.fn() },
    rewardLedger: { findMany: vi.fn() },
    pickupRequest: { findMany: vi.fn() },
    trip: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/rbac', () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

vi.mock('@/lib/csv', () => ({
  toCsv: vi.fn((data) => `csv_content_with_${data.length}_rows`),
  csvResponse: vi.fn((csv, filename) => new Response(csv, { headers: { 'Content-Disposition': `attachment; filename="${filename}"` } })),
}));

describe('/api/reports GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const makeReq = (type: string) => new Request(`http://localhost/api/reports?type=${type}`);

  it('generates deposits report', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.depositItem.findMany).mockResolvedValue([
      { createdAt: new Date(), wasteType: { name: 'Plastic' }, quantity: 1, status: 'ACCEPTED' }
    ] as any);

    const res = await GET(makeReq('deposits'));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('csv_content_with_1_rows');
    expect(res.headers.get('Content-Disposition')).toContain('deposits-');
    expect(prisma.depositItem.findMany).toHaveBeenCalled();
  });

  it('exports deposits with nested session machine/user and null fallbacks', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.depositItem.findMany).mockResolvedValue([
      {
        createdAt: new Date(),
        wasteType: { name: 'Plastic' },
        quantity: 1,
        measuredWeightGrams: 12,
        rewardAmount: 100,
        status: 'ACCEPTED',
        session: {
          machine: { machineCode: 'M1', name: 'Mesin 1' },
          user: { email: 'u@x.com' },
        },
      },
      {
        createdAt: new Date(),
        wasteType: { name: 'Glass' },
        quantity: 1,
        measuredWeightGrams: null,
        rewardAmount: 0,
        status: 'PENDING',
        session: null,
      },
    ] as any);

    const res = await GET(makeReq('deposits'));
    expect(res.status).toBe(200);
  });

  it('generates rewards report', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.rewardLedger.findMany).mockResolvedValue([
      {
        createdAt: new Date(),
        user: { email: 'test@example.com' },
        entryType: 'EARN',
        amount: 100,
        status: 'AVAILABLE',
        reasonCode: 'X',
        referenceType: 'DepositItem',
        referenceId: 'd1',
        campaign: { name: 'Camp', campaignType: 'TOURISM_PROGRAM' },
      },
    ] as any);

    const res = await GET(makeReq('rewards'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('rewards-');
    expect(prisma.rewardLedger.findMany).toHaveBeenCalled();
  });

  it('exports rewards with null optional fields', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.rewardLedger.findMany).mockResolvedValue([
      {
        createdAt: new Date(),
        user: { email: 'u@x.com' },
        entryType: 'EARN',
        amount: 10,
        status: 'AVAILABLE',
        reasonCode: null,
        referenceType: null,
        referenceId: null,
        campaign: null,
      },
    ] as any);

    const res = await GET(makeReq('rewards'));
    expect(res.status).toBe(200);
  });

  it('generates pickups report', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([
      {
        createdAt: new Date(),
        status: 'COMPLETED',
        reason: 'FULL',
        machine: { machineCode: 'M1' },
        assignedCollector: { name: 'Collector' },
        _count: { items: 5 },
      },
    ] as any);

    const res = await GET(makeReq('pickups'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('pickups-');
    expect(prisma.pickupRequest.findMany).toHaveBeenCalled();
  });

  it('exports pickups with null machine/collector fallbacks', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'a1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.pickupRequest.findMany).mockResolvedValue([
      {
        createdAt: new Date(),
        status: 'REQUESTED',
        reason: 'FULL',
        machine: null,
        assignedCollector: null,
        _count: { items: 0 },
      },
    ] as any);

    const res = await GET(makeReq('pickups'));
    expect(res.status).toBe(200);
    expect(prisma.pickupRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org1' } }),
    );
  });

  it('generates trips/compliance report', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'ADMIN', organizationId: 'org1' } as any);
    vi.mocked(prisma.trip.findMany).mockResolvedValue([
      {
        id: 't1',
        createdAt: new Date(),
        groupName: 'Grup A',
        status: 'COMPLETED',
        complianceStatus: 'COMPLIANT',
        complianceScore: 90,
        participantCount: 10,
        travelAgentName: null,
        checkInAt: new Date(),
        checkOutAt: new Date(),
        campaign: { name: 'Wisata', campaignType: 'TOURISM_PROGRAM', rewardMode: 'COMPLIANCE_ONLY' },
        travelAgent: { name: 'TA', email: 'ta@x.com' },
        user: { email: 'u@x.com' },
        _count: { bagAssignments: 5, validations: 2 },
      },
    ] as any);

    const res = await GET(makeReq('trips'));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toContain('trips-');
    expect(prisma.trip.findMany).toHaveBeenCalled();
  });

  it('exports trips with null optional fields using fallbacks', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.trip.findMany).mockResolvedValue([
      {
        id: 't2',
        createdAt: new Date(),
        groupName: null,
        status: 'PLANNED',
        complianceStatus: 'NOT_STARTED',
        complianceScore: 0,
        participantCount: 0,
        travelAgentName: 'Legacy TA',
        checkInAt: null,
        checkOutAt: null,
        campaign: { name: 'C', campaignType: 'TOURISM_PROGRAM', rewardMode: 'MONEY_REWARD' },
        travelAgent: null,
        user: null,
        _count: { bagAssignments: 0, validations: 0 },
      },
      {
        id: 't3',
        createdAt: new Date(),
        groupName: null,
        status: 'PLANNED',
        complianceStatus: 'NOT_STARTED',
        complianceScore: 0,
        participantCount: 0,
        travelAgentName: null,
        checkInAt: null,
        checkOutAt: null,
        campaign: { name: 'C2', campaignType: 'TOURISM_PROGRAM', rewardMode: 'MONEY_REWARD' },
        travelAgent: null,
        user: null,
        _count: { bagAssignments: 0, validations: 0 },
      },
    ] as any);

    const res = await GET(makeReq('trips'));
    expect(res.status).toBe(200);
  });

  it('returns 422 for unknown type', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 'u1', role: 'SUPERADMIN' } as any);
    const res = await GET(makeReq('unknown'));
    expect(res.status).toBe(422);
  });

  it('defaults deposits type and uses __none__ when ADMIN has no org', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: 'u1',
      role: 'ADMIN',
      organizationId: null,
    } as any);
    vi.mocked(prisma.depositItem.findMany).mockResolvedValue([]);

    const res = await GET(new Request('http://localhost/api/reports'));
    expect(res.status).toBe(200);
    expect(prisma.depositItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { session: { machine: { organizationId: '__none__' } } },
      }),
    );
  });

  it('exports deposits without org filter for SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.depositItem.findMany).mockResolvedValue([]);

    const res = await GET(makeReq('deposits'));
    expect(res.status).toBe(200);
    expect(prisma.depositItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('exports trips without org filter for SUPERADMIN', async () => {
    vi.mocked(rbac.requireApiUser).mockResolvedValue({ id: 's1', role: 'SUPERADMIN' } as any);
    vi.mocked(prisma.trip.findMany).mockResolvedValue([]);

    const res = await GET(makeReq('trips'));
    expect(res.status).toBe(200);
    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('handles unexpected errors', async () => {
    vi.mocked(rbac.requireApiUser).mockRejectedValue(new Error('boom'));
    const res = await GET(makeReq('deposits'));
    expect(res.status).toBe(500);
  });
});
