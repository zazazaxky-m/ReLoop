import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";
import { POST } from "@/app/api/scan/route";
import * as rbac from "@/lib/rbac";
import * as qr from "@/lib/qr";
import * as machineState from "@/lib/machine-state";
import * as campaign from "@/lib/campaign";
import * as audit from "@/lib/audit";
import * as rateLimit from "@/lib/rate-limit";

/**
 * POST /api/scan runs through startOrResumeDeposit (lib/deposit-session-service.ts):
 * one ReadCommitted transaction that locks User -> Machine, re-reads the
 * machine (token, status, organization, waste types), the machine's active
 * sessions and the campaign, and only then creates. The transaction client
 * here is the mocked prisma itself; `$queryRaw` records the row locks.
 */
const db = vi.hoisted(() => {
  const db: Record<string, any> = {
    machine: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    depositSession: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    depositItem: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    campaign: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    // B01: the organization's funding account and the session's reservation.
    rewardFundingAccount: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
    rewardBudgetReservation: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    rewardBudgetCommit: { aggregate: vi.fn() },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction: vi.fn(),
  };
  return db;
});

vi.mock("@/lib/prisma", () => ({ prisma: db }));

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

vi.mock("@/lib/machine-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/machine-state")>()),
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

const MACHINE_IN_USE = "Mesin sedang digunakan. Silakan coba lagi nanti atau gunakan mesin lain.";

/** Table name of every row lock taken, in order (lib/db-locks.ts). */
function lockOrder(): string[] {
  return db.$queryRaw.mock.calls
    .map((call: unknown[]) => (call[0] as TemplateStringsArray).join("?"))
    .map((sql: string) => sql.match(/FROM "(\w+)"/)?.[1])
    .filter(Boolean);
}

describe("/api/scan", () => {
  const future = () => new Date(Date.now() + 120_000);

  beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(db));
    db.$queryRaw.mockResolvedValue([{ id: "locked" }]);
    db.$executeRaw.mockResolvedValue(0);
    db.user.findUnique.mockResolvedValue({ email: "user@example.com" });
    db.depositSession.findMany.mockResolvedValue([]);
    db.rewardFundingAccount.findUniqueOrThrow.mockResolvedValue({
      id: "acct1", organizationId: "org1", confirmedRupiah: 50_000, heldRupiah: 0, version: 0 });
    db.rewardFundingAccount.update.mockResolvedValue({});
    db.rewardBudgetReservation.findUnique.mockResolvedValue(null);
    db.rewardBudgetReservation.create.mockImplementation(async ({ data }: any) => ({ id: "res1", ...data }));
    db.campaign.findUniqueOrThrow.mockImplementation(async ({ where }: any) => ({
      id: where.id, organizationId: "org1", rewardBudgetRupiah: null, heldRupiah: 0, spentRupiah: 0 }));
    db.campaign.update.mockResolvedValue({});
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
    // B01: a money organization with a configured per-session ceiling.
    maxRewardPerSessionRupiah: 20_000,
    organization: { id: "org1", name: "Org 1", status: "ACTIVE", machineRewardMode: "MONEY_REWARD" },
    wasteTypes: [{ id: "link1", wasteType: { id: "w1", name: "Plastik" } }],
  };

  const session = (over: Record<string, unknown>) => ({
    id: "sess1", userId: "u2", machineId: "m1", status: "ACTIVE", timeoutAt: future(),
    updatedAt: new Date(), startedAt: new Date(), ...over,
  });

  it("returns generic message when machine does not accept sessions", async () => {
    db.machine.findUnique.mockResolvedValue({ ...baseMachine, status: "MAINTENANCE" });
    vi.mocked(machineState.machineAcceptsSessions).mockReturnValue(false);

    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(409);

    const data = await res.json();
    expect(data.error).toBe("Mesin tidak menerima setoran saat ini");
    expect(data.error).not.toContain("MAINTENANCE");
  });

  it("returns generic message when campaign eligibility fails", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    db.campaign.findUnique.mockResolvedValue({
      id: "c1",
      organizationId: "org1",
      campaignType: "MACHINE_DEPOSIT",
    });
    vi.mocked(campaign.isCampaignEligible).mockReturnValue({
      eligible: false,
      reason: "PRIVATE_DOMAIN_MISMATCH",
    });

    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok", campaignId: "c1" }));
    expect(res.status).toBe(403);

    const data = await res.json();
    expect(data.error).toBe("Anda tidak memenuhi syarat campaign ini");
    expect(data.error).not.toContain("PRIVATE");
    // Eligibility is checked against the email re-read under the user lock.
    expect(campaign.isCampaignEligible).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }), "user@example.com");
  });

  it("creates a session under User -> Machine locks after re-reading the machine and its sessions", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    db.depositSession.create.mockResolvedValue({ id: "sess1", status: "ACTIVE" });

    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(201);

    const data = await res.json();
    expect(data.session.id).toBe("sess1");
    expect(data.resumed).toBe(false);
    expect(data.machine).toEqual({
      id: "m1", machineCode: "RVM-001", name: "Mesin 1", organizationName: "Org 1",
      supportedWasteTypes: [{ id: "w1", name: "Plastik" }],
    });
    // B01: the organization's funding account comes between the User and the
    // Machine; the reservation re-takes it afterwards (re-entrant, already held).
    expect(lockOrder()).toEqual(["User", "RewardFundingAccount", "Machine", "RewardFundingAccount"]);
    // The decision reads happen after the locks, inside the transaction.
    const machineRead = db.machine.findUnique.mock.invocationCallOrder[1];
    const sessionsRead = db.depositSession.findMany.mock.invocationCallOrder[0];
    const machineLock = db.$queryRaw.mock.invocationCallOrder[2];
    expect(machineRead).toBeGreaterThan(machineLock);
    expect(sessionsRead).toBeGreaterThan(machineLock);
    expect(db.depositSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: "u1", machineId: "m1", campaignId: null, status: "ACTIVE" }),
    });
    expect(audit.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "DEPOSIT_SESSION_START" }),
    );
  });

  it("denies if rate limit exceeded", async () => {
    vi.mocked(rateLimit.checkRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 60_000,
    });
    const res = await POST(makeReq({ machineCode: "RVM-001" }));
    expect(res.status).toBe(429);
    const data = await res.json();
    expect(data.error).toBe("Terlalu banyak percobaan scan. Coba lagi sebentar lagi.");
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("returns 404 if machine not found", async () => {
    db.machine.findUnique.mockResolvedValue(null);
    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(404);
  });

  it("returns 401 if QR token is invalid", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    vi.mocked(qr.isTokenValid).mockReturnValue(false);
    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(401);
    expect(db.depositSession.create).not.toHaveBeenCalled();
  });

  it("returns 401 if QR token is missing", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    vi.mocked(qr.isTokenValid).mockReturnValue(false);
    const res = await POST(makeReq({ machineCode: "RVM-001" }));
    expect(res.status).toBe(401);
    expect(qr.isTokenValid).toHaveBeenCalledWith(expect.anything(), "");
  });

  it("returns 409 if organization is inactive", async () => {
    db.machine.findUnique.mockResolvedValue({
      ...baseMachine,
      organization: { ...baseMachine.organization, status: "INACTIVE" },
    });
    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Organisasi mesin tidak aktif");
  });

  it("returns 409 if machine has no waste types", async () => {
    db.machine.findUnique.mockResolvedValue({ ...baseMachine, wasteTypes: [] });
    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toBe("Mesin belum dikonfigurasi jenis sampah");
  });

  it("returns a neutral 409 without owner details if another user's live session holds the machine", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    db.depositSession.findMany.mockResolvedValue([session({ id: "sess-other", userId: "u2" })]);
    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data).toEqual({ error: MACHINE_IN_USE });
    expect(JSON.stringify(data)).not.toMatch(/u2|sess-other/);
    expect(db.depositSession.create).not.toHaveBeenCalled();
    expect(db.depositSession.update).not.toHaveBeenCalled();
  });

  describe("B01: the session's reward ceiling is reserved before the admission commits", () => {
    const reservationCreate = () => db.rewardBudgetReservation.create.mock.calls[0]?.[0]?.data;

    it("reserves the machine's ceiling for a money organization, under the account lock, after the session row", async () => {
      db.machine.findUnique.mockResolvedValue(baseMachine);
      db.depositSession.create.mockResolvedValue({ id: "sess1", userId: "u1", status: "ACTIVE" });
      const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
      expect(res.status).toBe(201);
      expect(reservationCreate()).toEqual({
        businessKey: "session:sess1:admission", accountId: "acct1", campaignId: null, userId: "u1",
        sourceType: "SESSION", sourceId: "sess1", ceilingRupiah: 20_000, remainingRupiah: 20_000,
        shortfallRupiah: 0, campaignShortfallRupiah: 0,
      });
      expect(db.rewardFundingAccount.update).toHaveBeenCalledWith({
        where: { id: "acct1" }, data: { confirmedRupiah: 50_000, heldRupiah: 20_000, version: { increment: 1 } } });
      expect(db.rewardBudgetReservation.create.mock.invocationCallOrder[0])
        .toBeGreaterThan(db.depositSession.create.mock.invocationCallOrder[0]);
    });

    it("uses the campaign's ceiling and budget when the session binds a campaign, locking it before the Machine", async () => {
      db.machine.findUnique.mockResolvedValue(baseMachine);
      db.campaign.findUnique.mockResolvedValue({
        id: "c1", organizationId: "org1", campaignType: "MACHINE_DEPOSIT", rewardMode: "MONEY_REWARD",
        supportsMachine: false, visibility: "PUBLIC", maxRewardPerSessionRupiah: 5_000 });
      db.campaign.findUniqueOrThrow.mockResolvedValue({
        id: "c1", organizationId: "org1", rewardBudgetRupiah: 100_000, heldRupiah: 0, spentRupiah: 0 });
      vi.mocked(campaign.isCampaignEligible).mockReturnValue({ eligible: true } as any);
      db.depositSession.create.mockResolvedValue({ id: "sess1", userId: "u1", status: "ACTIVE" });
      const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok", campaignId: "c1" }));
      expect(res.status).toBe(201);
      expect(lockOrder()).toEqual(["User", "RewardFundingAccount", "Campaign", "Machine", "RewardFundingAccount", "Campaign"]);
      expect(reservationCreate()).toMatchObject({ campaignId: "c1", ceilingRupiah: 5_000, remainingRupiah: 5_000 });
      expect(db.campaign.update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { heldRupiah: { increment: 5_000 } } });
    });

    it("reserves nothing for a COMPLIANCE_ONLY organization", async () => {
      db.machine.findUnique.mockResolvedValue({
        ...baseMachine, organization: { ...baseMachine.organization, machineRewardMode: "COMPLIANCE_ONLY" } });
      db.depositSession.create.mockResolvedValue({ id: "sess1", userId: "u1", status: "ACTIVE" });
      expect((await POST(makeReq({ machineCode: "RVM-001", token: "tok" }))).status).toBe(201);
      expect(db.rewardBudgetReservation.create).not.toHaveBeenCalled();
      expect(db.rewardFundingAccount.update).not.toHaveBeenCalled();
    });

    it("without a configured ceiling: refused under enforcement, admitted with a zero ceiling in shadow mode", async () => {
      db.machine.findUnique.mockResolvedValue({ ...baseMachine, maxRewardPerSessionRupiah: null });
      db.depositSession.create.mockResolvedValue({ id: "sess1", userId: "u1", status: "ACTIVE" });
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const previous = process.env.REWARD_FUNDING_ENFORCED;
      try {
        process.env.REWARD_FUNDING_ENFORCED = "true";
        const refused = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
        expect(refused.status).toBe(409);
        expect((await refused.json()).error).toBe("Program sementara tidak menerima setoran berhadiah");
        expect(db.rewardBudgetReservation.create).not.toHaveBeenCalled();

        process.env.REWARD_FUNDING_ENFORCED = "false";
        const shadow = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
        expect(shadow.status).toBe(201);
        expect(reservationCreate()).toMatchObject({ ceilingRupiah: 0, remainingRupiah: 0 });
      } finally {
        if (previous === undefined) delete process.env.REWARD_FUNDING_ENFORCED;
        else process.env.REWARD_FUNDING_ENFORCED = previous;
        warn.mockRestore();
      }
    });

    it("refuses the admission under enforcement when the organization's capacity is short, before any reservation", async () => {
      db.machine.findUnique.mockResolvedValue(baseMachine);
      db.rewardFundingAccount.findUniqueOrThrow.mockResolvedValue({
        id: "acct1", organizationId: "org1", confirmedRupiah: 10_000, heldRupiah: 0, version: 0 });
      db.depositSession.create.mockResolvedValue({ id: "sess1", userId: "u1", status: "ACTIVE" });
      const previous = process.env.REWARD_FUNDING_ENFORCED;
      try {
        process.env.REWARD_FUNDING_ENFORCED = "true";
        const refused = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
        expect(refused.status).toBe(409);
        expect((await refused.json()).error).toBe("Program sementara tidak menerima setoran berhadiah");
        expect(db.rewardBudgetReservation.create).not.toHaveBeenCalled();
        expect(db.rewardFundingAccount.update).not.toHaveBeenCalled();
      } finally {
        if (previous === undefined) delete process.env.REWARD_FUNDING_ENFORCED;
        else process.env.REWARD_FUNDING_ENFORCED = previous;
      }
    });
  });

  it("resumes session if active session exists for same user", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    db.depositSession.findMany.mockResolvedValue([session({ id: "sess1", userId: "u1" })]);
    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.resumed).toBe(true);
    expect(data.session.id).toBe("sess1");
    expect(db.depositSession.create).not.toHaveBeenCalled();
    expect(db.depositSession.update).not.toHaveBeenCalled();
  });

  it("closes another user's timed-out session through the timeout policy, then starts", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    const stale = session({ id: "sess-old", userId: "u2", timeoutAt: new Date(Date.now() - 1_000) });
    db.depositSession.findMany.mockResolvedValue([stale]);
    db.depositSession.findUnique.mockResolvedValue(stale);
    db.depositItem.findMany.mockResolvedValue([{ id: "item-1", sessionId: "sess-old" }]);
    db.depositItem.findUnique.mockResolvedValue({ id: "item-1", status: "PENDING", acceptanceEventId: null, validationReasonCode: null });
    db.depositItem.updateMany.mockResolvedValue({ count: 1 });
    db.depositSession.create.mockResolvedValue({ id: "sess-new", status: "ACTIVE" });

    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(201);
    expect(lockOrder()).toEqual(["User", "RewardFundingAccount", "Machine", "DepositSession", "DepositItem", "RewardFundingAccount"]);
    expect(db.depositItem.updateMany).toHaveBeenCalledWith({
      where: { id: "item-1", status: "PENDING", acceptanceEventId: null },
      data: { status: "REVIEW", validationReasonCode: "SESSION_TIMEOUT" },
    });
    expect(db.depositSession.update).toHaveBeenCalledWith({
      where: { id: "sess-old" },
      data: expect.objectContaining({ status: "EXPIRED" }),
    });
    expect(audit.logAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "DEPOSIT_SESSION_EXPIRE", entityId: "sess-old",
      metadata: expect.objectContaining({ reason: "TIMEOUT", heldItemIds: ["item-1"] }),
    }));
  });

  it("expires several timed-out sessions locking all sessions, then all their items, each class in id order (M1)", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    const past = new Date(Date.now() - 1_000);
    const sessions: Record<string, any> = {
      "s-b": session({ id: "s-b", userId: "u2", timeoutAt: past, startedAt: new Date(Date.now() - 600_000) }),
      "s-a": session({ id: "s-a", userId: "u3", timeoutAt: past, startedAt: new Date(Date.now() - 300_000) }),
    };
    const items: Record<string, any> = {
      "i-2": { id: "i-2", sessionId: "s-a", status: "PENDING", acceptanceEventId: null, validationReasonCode: null },
      "i-1": { id: "i-1", sessionId: "s-b", status: "PENDING", acceptanceEventId: null, validationReasonCode: null },
    };
    db.depositSession.findMany.mockResolvedValue([sessions["s-b"], sessions["s-a"]]); // startedAt order
    db.depositSession.findUnique.mockImplementation(async ({ where }: any) => sessions[where.id]);
    db.depositItem.findMany.mockImplementation(async ({ where }: any) => {
      const wanted: string[] = typeof where.sessionId === "string" ? [where.sessionId] : where.sessionId.in;
      return Object.values(items).filter((i) => wanted.includes(i.sessionId))
        .sort((a, b) => a.id.localeCompare(b.id)).map(({ id, sessionId }) => ({ id, sessionId }));
    });
    db.depositItem.findUnique.mockImplementation(async ({ where }: any) => items[where.id]);
    db.depositItem.updateMany.mockResolvedValue({ count: 1 });
    db.depositSession.create.mockResolvedValue({ id: "sess-new", status: "ACTIVE" });

    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(201);
    const locks = db.$queryRaw.mock.calls.map((call: unknown[]) =>
      [(call[0] as TemplateStringsArray).join("?").match(/FROM "(\w+)"/)?.[1], call[1]]);
    expect(locks).toEqual([
      ["User", "u1"], ["RewardFundingAccount", "org1"], ["Machine", "m1"],
      ["DepositSession", "s-a"], ["DepositSession", "s-b"],
      ["DepositItem", "i-1"], ["DepositItem", "i-2"],
      // The reservation re-takes the account row it already holds (re-entrant).
      ["RewardFundingAccount", "org1"],
    ]);
    const expired = vi.mocked(audit.logAudit).mock.calls.map((call) => call[0])
      .filter((entry) => entry.action === "DEPOSIT_SESSION_EXPIRE")
      .map((entry) => [entry.entityId, (entry.metadata as any).heldItemIds]);
    expect(expired.sort()).toEqual([["s-a", ["i-2"]], ["s-b", ["i-1"]]]);
  });

  it("never picks one of two live sessions on a machine (legacy duplicates)", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    db.depositSession.findMany.mockResolvedValue([
      session({ id: "sess-a", userId: "u1" }), session({ id: "sess-b", userId: "u2" })]);
    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Mesin sedang tidak dapat digunakan. Silakan gunakan mesin lain." });
    expect(db.depositSession.create).not.toHaveBeenCalled();
  });

  it("maps a unique-index race on create to 409 for another owner and to a resume for the same owner", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    const duplicate = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002", clientVersion: "test", meta: { modelName: "DepositSession", target: ["machineId"] },
    });
    db.depositSession.create.mockRejectedValue(duplicate);
    db.depositSession.findMany
      .mockResolvedValueOnce([]) // inside the transaction
      .mockResolvedValueOnce([session({ id: "winner", userId: "u2" })]); // after the refused insert
    let res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: MACHINE_IN_USE });

    db.depositSession.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([session({ id: "mine", userId: "u1" })]);
    res = await POST(makeReq({ machineCode: "RVM-001", token: "tok" }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ resumed: true, session: { id: "mine" } });
  });

  it("returns 422 if campaign invalid for machine org", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    db.campaign.findUnique.mockResolvedValue({
      id: "c1",
      organizationId: "org2", // mismatch
    });
    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok", campaignId: "c1" }));
    expect(res.status).toBe(422);
    const data = await res.json();
    expect(data.error).toBe("Campaign tidak valid untuk mesin ini");
  });

  it("refuses campaigns that do not run at machines (M04)", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    vi.mocked(campaign.isCampaignEligible).mockReturnValue({ eligible: true });
    for (const [campaignType, supportsMachine] of [
      ["TRASH_BAG", true], ["TOURISM_PROGRAM", true], ["EVENT", false], ["SCHOOL_PROGRAM", false],
    ] as const) {
      db.campaign.findUnique.mockResolvedValue({
        id: "c1", organizationId: "org1", campaignType, supportsMachine });
      const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok", campaignId: "c1" }));
      expect(res.status, campaignType).toBe(422);
      expect((await res.json()).error).toBe("Campaign ini tidak berlaku untuk setoran mesin");
    }
    expect(db.depositSession.create).not.toHaveBeenCalled();
  });

  it("starts a session for an EVENT campaign that supports machines", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    vi.mocked(campaign.isCampaignEligible).mockReturnValue({ eligible: true });
    db.campaign.findUnique.mockResolvedValue({
      id: "c1", organizationId: "org1", campaignType: "EVENT", supportsMachine: true });
    db.depositSession.create.mockResolvedValue({ id: "s1", campaignId: "c1" });
    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok", campaignId: "c1" }));
    expect(res.status).toBe(201);
    expect(db.depositSession.create).toHaveBeenCalledWith({ data: expect.objectContaining({ campaignId: "c1" }) });
  });

  it("returns 422 if campaign not found", async () => {
    db.machine.findUnique.mockResolvedValue(baseMachine);
    db.campaign.findUnique.mockResolvedValue(null);
    const res = await POST(makeReq({ machineCode: "RVM-001", token: "tok", campaignId: "c1" }));
    expect(res.status).toBe(422);
  });
});
