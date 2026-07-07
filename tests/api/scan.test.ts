import { describe, expect, it, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/scan/route";
import { prisma } from "@/lib/prisma";
import * as rbac from "@/lib/rbac";
import * as qr from "@/lib/qr";
import * as machineState from "@/lib/machine-state";
import * as campaign from "@/lib/campaign";
import * as audit from "@/lib/audit";
import * as rateLimit from "@/lib/rate-limit";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    machine: { findUnique: vi.fn() },
    depositSession: { findFirst: vi.fn(), create: vi.fn() },
    campaign: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/rbac", () => ({
  requireApiUser: vi.fn(),
  HttpError: class HttpError extends Error {
    constructor(
      public status: number,
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@/lib/qr", () => ({
  isTokenValid: vi.fn(),
}));

vi.mock("@/lib/machine-state", () => ({
  machineAcceptsSessions: vi.fn(),
}));

vi.mock("@/lib/campaign", () => ({
  isCampaignEligible: vi.fn(),
}));

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

describe("/api/scan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 19,
      resetAt: Date.now() + 60_000,
    });
    vi.mocked(rbac.requireApiUser).mockResolvedValue({
      id: "u1",
      email: "user@example.com",
      role: "USER",
    } as any);
    vi.mocked(qr.isTokenValid).mockReturnValue(true);
    vi.mocked(machineState.machineAcceptsSessions).mockReturnValue(true);
  });

  const makeReq = (body: Record<string, unknown>) =>
    new Request("http://localhost/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const baseMachine = {
    id: "m1",
    machineCode: "RVM-001",
    name: "Mesin 1",
    status: "ONLINE",
    organizationId: "org1",
    sessionIdleTimeoutMinutes: 5,
    organization: { id: "org1", name: "Org 1", status: "ACTIVE" },
    wasteTypes: [{ wasteType: { id: "w1", name: "Plastik" } }],
  };

  it("returns generic message when machine does not accept sessions", async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue({
      ...baseMachine,
      status: "MAINTENANCE",
    } as any);
    vi.mocked(machineState.machineAcceptsSessions).mockReturnValue(false);

    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(409);

    const data = await res.json();
    expect(data.error).toBe("Mesin tidak menerima setoran saat ini");
    expect(data.error).not.toContain("MAINTENANCE");
  });

  it("returns generic message when campaign eligibility fails", async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(baseMachine as any);
    vi.mocked(prisma.depositSession.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.campaign.findUnique).mockResolvedValue({
      id: "c1",
      organizationId: "org1",
    } as any);
    vi.mocked(campaign.isCampaignEligible).mockReturnValue({
      eligible: false,
      reason: "PRIVATE_DOMAIN_MISMATCH",
    });

    const res = await POST(
      makeReq({ machineCode: "RVM-001", token: "tok", campaignId: "c1" }),
    );
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toBe("Anda tidak memenuhi syarat campaign ini");
    expect(data.error).not.toContain("PRIVATE");
  });

  it("creates session when scan is valid", async () => {
    vi.mocked(prisma.machine.findUnique).mockResolvedValue(baseMachine as any);
    vi.mocked(prisma.depositSession.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.depositSession.create).mockResolvedValue({
      id: "sess1",
      status: "ACTIVE",
    } as any);

    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.session.id).toBe("sess1");
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DEPOSIT_SESSION_START" }),
    );
  });
});
