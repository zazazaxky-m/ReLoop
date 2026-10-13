import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { getWalletBalance } from "@/lib/ledger";
import { f } from "../support/audit-fixture";
import { scanSessionContractV1, scanSessionResponseV1 } from "../support/contracts";
import {
  assertPostgresReachable,
  assertRedisReachable,
  resetDisposableDatabase,
} from "../support/disposable-db";
import {
  InjectedFault,
  deferred,
  failAfterCommit,
  isStillPending,
  waitForLockWait,
  type ServiceHooks,
} from "../support/race-probe";

async function closedLoopbackPort(): Promise<number> {
  const { createServer } = await import("node:net");
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

function withPort(url: string, port: number): string {
  const parsed = new URL(url);
  parsed.port = String(port);
  return parsed.toString();
}

describe("real PostgreSQL fixture", () => {
  it("rolls back real PostgreSQL writes and enforces foreign keys",async()=>{
    const before=await f.db.user.count();
    await expect(f.db.$transaction(async tx=>{
      await tx.user.create({data:{name:"Rollback",email:"rollback@example.test"}});
      throw new Error("ROLLBACK_PROBE");
    })).rejects.toThrow("ROLLBACK_PROBE");
    expect(await f.db.user.count()).toBe(before);
    await expect(f.db.depositSession.create({data:{
      userId:"missing-user",machineId:f.ids.machineA,status:"ACTIVE",
    }})).rejects.toMatchObject({code:"P2003"});
  });

  it("runs against the runner-owned PostgreSQL 16 test database", async () => {
    const [row] = await f.db.$queryRaw<{ db: string; cluster: string; major: number }[]>`
      SELECT current_database() AS db,
             current_setting('cluster_name') AS cluster,
             (current_setting('server_version_num')::int / 10000) AS major`;
    expect(row.db).toBe("reloop_audit_test");
    expect(row.cluster).toBe(`reloop-audit-${process.env.AUDIT_RUN_ID}`);
    expect(row.major).toBe(16);
    expect(await f.redis.get("reloop-audit:owner")).toBe(process.env.AUDIT_RUN_ID);
  });

  it("seeds the contract graph through the production encryption hooks", async () => {
    const users = await f.db.user.findMany({ orderBy: { email: "asc" } });
    expect(users).toHaveLength(7);
    for (const user of users) expect(user.email).toMatch(/\.test$/);
    const roles = Object.fromEntries(users.map((u) => [u.id, u.role]));
    expect(roles[f.ids.userA]).toBe("USER");
    expect(roles[f.ids.userB]).toBe("USER");
    expect(roles[f.ids.adminA]).toBe("ADMIN");
    expect(roles[f.ids.adminB]).toBe("ADMIN");
    expect(roles[f.ids.superadmin]).toBe("SUPERADMIN");
    expect(roles[f.ids.collectorA]).toBe("PENGEPUL");
    expect(roles[f.ids.collectorB]).toBe("PENGEPUL");

    const [raw] = await f.db.$queryRaw<{ email: string; emailLookup: string; totpSecret: string | null; mfaEnabled: boolean }[]>`
      SELECT email, "emailLookup", "totpSecret", "mfaEnabled" FROM "User" WHERE id = ${f.ids.adminA}`;
    expect(raw.email).not.toContain("@");
    expect(raw.emailLookup).toMatch(/^[0-9a-f]{64}$/);
    expect(raw.mfaEnabled).toBe(true);
    expect(raw.totpSecret).toMatch(/^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);

    const [payout] = await f.db.$queryRaw<{ accountIdentifier: string; status: string; userId: string }[]>`
      SELECT "accountIdentifier", status::text AS status, "userId" FROM "PayoutAccount" WHERE id = ${f.ids.payoutAccountA}`;
    expect(payout).toMatchObject({ status: "VERIFIED", userId: f.ids.userA });
    expect(payout.accountIdentifier).not.toMatch(/^\d+$/);

    const machine = await f.db.machine.findUniqueOrThrow({
      where: { id: f.ids.machineA },
      include: { organization: true, wasteTypes: { include: { wasteType: { include: { rewardRates: true } } } } },
    });
    expect(machine).toMatchObject({ machineCode: f.ids.machineCode, status: "ONLINE", organizationId: f.ids.orgA });
    expect(machine.organization.status).toBe("ACTIVE");
    expect(machine.wasteTypes.filter((w) => w.active && w.wasteType.active)).toHaveLength(1);
    expect(machine.wasteTypes[0].wasteType.rewardRates.some((r) => r.active && r.pointsPerItem > 0)).toBe(true);

    const campaigns = await f.db.campaign.findMany({ where: { status: "ACTIVE", rewardMode: "MONEY_REWARD" } });
    expect(campaigns.map((c) => `${c.organizationId === f.ids.orgA ? "A" : "B"}:${c.campaignType}`).sort())
      .toEqual(["A:MACHINE_DEPOSIT", "A:TRASH_BAG", "B:TRASH_BAG"]);
    expect(await f.db.organizationCollectorPartner.count({ where: { organizationId: f.ids.orgA, status: "ACTIVE" } })).toBe(2);
  });
});

describe("two-connection lock probes", () => {
  it("blocks a competing row lock until the holder releases, and hides the holder's rolled-back write", async () => {
    const [one, two, observer] = await Promise.all([f.connection(), f.connection(), f.connection()]);
    const holderLocked = deferred<number>();
    const release = deferred();
    const holder = one.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${f.ids.userA} FOR UPDATE`;
      await tx.$executeRaw`UPDATE "User" SET "payoutEligible" = false WHERE id = ${f.ids.userA}`;
      holderLocked.resolve(pid);
      await release.promise;
      throw new Error("ROLLBACK_HOLDER");
    }, { timeout: 20_000 });
    const holderOutcome = holder.then(() => "committed", (error: Error) => error.message);
    const holderPid = await holderLocked.promise;

    const waiterStarted = deferred<number>();
    const waiter = two.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
      await tx.$executeRaw`SET LOCAL statement_timeout = '15s'`;
      const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      waiterStarted.resolve(pid);
      const [row] = await tx.$queryRaw<{ payoutEligible: boolean }[]>`
        SELECT "payoutEligible" FROM "User" WHERE id = ${f.ids.userA} FOR UPDATE`;
      return row.payoutEligible;
    }, { timeout: 20_000 });
    const waiterPid = await waiterStarted.promise;

    expect(waiterPid).not.toBe(holderPid);
    await waitForLockWait(observer, { waiterPid, holderPid });
    expect(await isStillPending(waiter, 250)).toBe(true);

    release.resolve();
    expect(await holderOutcome).toBe("ROLLBACK_HOLDER");
    await expect(waiter).resolves.toBe(true);
  });

  it("ends a blocked lock wait with lock_timeout instead of hanging", async () => {
    const [one, two] = await Promise.all([f.connection(), f.connection()]);
    const locked = deferred();
    const release = deferred();
    const holder = one.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${f.ids.userB} FOR UPDATE`;
      locked.resolve();
      await release.promise;
    }, { timeout: 20_000 });
    await locked.promise;
    try {
      await expect(two.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '300ms'`;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${f.ids.userB} FOR UPDATE`;
      }, { timeout: 20_000 })).rejects.toThrow(/55P03|lock timeout/);
    } finally {
      release.resolve();
      await holder;
    }
  });

  it("keeps a write committed before an injected lost response so the retry replays it", async () => {
    const referenceId = `audit-lost-response:${randomUUID()}`;
    async function recordOnce(hooks: ServiceHooks) {
      const existing = await f.db.rewardLedger.findFirst({ where: { referenceType: "AuditProbe", referenceId } });
      if (existing) return { id: existing.id, replayed: true };
      const created = await f.db.$transaction((tx) => tx.rewardLedger.create({
        data: { userId: f.ids.userA, entryType: "ADJUST", amount: 1, status: "AVAILABLE", referenceType: "AuditProbe", referenceId },
      }));
      await hooks.afterCommit?.();
      return { id: created.id, replayed: false };
    }
    await expect(recordOnce({ afterCommit: failAfterCommit() })).rejects.toBeInstanceOf(InjectedFault);
    const retry = await recordOnce({});
    expect(retry.replayed).toBe(true);
    expect(await f.db.rewardLedger.count({ where: { referenceId } })).toBe(1);
  });
});

describe("real Next HTTP with production sessions", () => {
  it("serves guests and fixture actors through the real Next server", async () => {
    expect((await f.json("guest", "GET", "/api/wallet")).status).toBe(401);
    await f.seedBalance(15_000);
    const wallet = await f.json("userA", "GET", "/api/wallet");
    expect(wallet.status).toBe(200);
    expect((await wallet.json()).balance.available).toBe(15_000);
    expect((await f.json("adminA", "GET", "/api/wallet")).status).toBe(403);
  });

  it("rejects a helper cookie once the user's tokenVersion changes", async () => {
    expect((await f.json("userB", "GET", "/api/wallet")).status).toBe(200);
    await f.db.user.update({ where: { id: f.ids.userB }, data: { tokenVersion: { increment: 1 } } });
    expect((await f.json("userB", "GET", "/api/wallet")).status).toBe(401);
  });

  it("logs in through /api/auth/login and consumes adminA's MFA challenge once in real Redis", async () => {
    const userLogin = await f.json("guest", "POST", "/api/auth/login", f.credentials("userA"));
    expect(userLogin.status).toBe(200);
    expect(userLogin.headers.getSetCookie().some((c) => c.startsWith("reloop_session="))).toBe(true);

    const adminLogin = await f.json("guest", "POST", "/api/auth/login", f.credentials("adminA"));
    expect(adminLogin.status).toBe(200);
    const { requiresMfa, challengeToken } = await adminLogin.json();
    expect(requiresMfa).toBe(true);
    expect(adminLogin.headers.getSetCookie()).toEqual([]);

    const code = f.totpCode("adminA");
    const verified = await f.json("guest", "POST", "/api/auth/mfa/verify", { challengeToken, code });
    expect(verified.status).toBe(200);
    expect(verified.headers.getSetCookie().some((c) => c.startsWith("reloop_session="))).toBe(true);
    const replay = await f.json("guest", "POST", "/api/auth/mfa/verify", { challengeToken, code });
    expect(replay.status).toBe(401);
    expect(await f.redis.keys("mfa-consumed:*")).toHaveLength(1);
  });

  it("captures password-reset mail in the fake transport", async () => {
    const { email } = f.credentials("userA");
    const response = await f.json("guest", "POST", "/api/auth/forgot-password", { email });
    expect(response.status).toBe(200);
    // The reset mail is sent after the response (A04: no timing oracle).
    await vi.waitFor(async () => expect(await f.capturedTransport("mail")).toHaveLength(1), { timeout: 10_000 });
    const mails = await f.capturedTransport("mail");
    expect(mails[0]).toMatchObject({ kind: "mail", to: email });
    expect(mails[0].kind === "mail" && mails[0].text).toMatch(/\/reset-password\?token=[\w-]{20,}/);
  });

  it("moves redemptions through the real API and captures status pushes", async () => {
    await f.db.deviceToken.create({ data: { userId: f.ids.userA, token: `audit-device-${randomUUID()}`, platform: "android" } });
    const processing = await f.processingRedemption(20_000);
    expect((await f.db.redemption.findUniqueOrThrow({ where: { id: processing } })).status).toBe("PROCESSING");
    const reserve = await f.db.rewardLedger.findFirstOrThrow({ where: { referenceId: processing, entryType: "REDEEM" } });
    expect(reserve).toMatchObject({ amount: -20_000, status: "PENDING" });
    expect((await getWalletBalance(f.ids.userA)).available).toBe(0);

    await f.seedBalance(10_000);
    const paid = await f.redeemAndSettle(10_000);
    expect((await f.db.redemption.findUniqueOrThrow({ where: { id: paid } })).status).toBe("SUCCESS");
    expect((await f.db.rewardLedger.findFirstOrThrow({ where: { referenceId: paid, entryType: "REDEEM" } })).status).toBe("REDEEMED");

    await vi.waitFor(async () => expect(await f.capturedTransport("push")).toHaveLength(5), { timeout: 10_000 });
  });

  it("starts a real deposit session whose response satisfies the v1 scan-session contract", async () => {
    const token = await f.machineQrToken();
    const response = await f.json("userA", "POST", "/api/scan", { machineCode: f.ids.machineCode, token });
    expect(response.status).toBe(201);
    const body = await response.json();
    const contract = scanSessionContractV1.parse(JSON.parse(readFileSync(
      path.resolve(__dirname, "../fixtures/contracts/scan-session.v1.json"), "utf8")));
    expect(contract.version).toBe(1);
    const live = scanSessionResponseV1.parse(body);
    expect(Object.keys(live.session).sort()).toEqual(Object.keys(contract.response.session).sort());
    expect(Object.keys(live.machine).sort()).toEqual(Object.keys(contract.response.machine).sort());
    expect(live).toMatchObject({ resumed: false, session: { userId: f.ids.userA, machineId: f.ids.machineA, status: "ACTIVE" } });
  });

  it("creates pickups through the admin API", async () => {
    const pickup = await f.pickup();
    const row = await f.db.pickupRequest.findUniqueOrThrow({ where: { id: pickup.id } });
    expect(row).toMatchObject({ organizationId: f.ids.orgA, requestedById: f.ids.adminA, status: "REQUESTED" });
  });
});

describe("fixture domain helpers", () => {
  it("creates one trash-bag row per bag on an active TRASH_BAG money trip", async () => {
    const own = await f.trip({ bagCount: 3 });
    const bags = await f.db.trashBagAssignment.findMany({ where: { tripId: own.id } });
    expect(bags.map((b) => b.id).sort()).toEqual([...own.bagIds].sort());
    expect(bags.map((b) => b.bagCount)).toEqual([1, 1, 1]);
    const trip = await f.db.trip.findUniqueOrThrow({ where: { id: own.id }, include: { campaign: true } });
    expect(trip).toMatchObject({ status: "ACTIVE", userId: f.ids.userA,
      campaign: { campaignType: "TRASH_BAG", rewardMode: "MONEY_REWARD", organizationId: f.ids.orgA } });

    const foreign = await f.trip({ bagCount: 0, organization: "B", status: "PLANNED" });
    expect(foreign.bagIds).toEqual([]);
    const foreignTrip = await f.db.trip.findUniqueOrThrow({ where: { id: foreign.id }, include: { campaign: true } });
    expect(foreignTrip).toMatchObject({ status: "PLANNED", campaign: { organizationId: f.ids.orgB } });
  });

  it("creates a pending invite without membership and terminal deposit history without money", async () => {
    const invite = await f.pendingInvite("invited@example.test");
    expect(invite.token.length).toBeGreaterThanOrEqual(32);
    expect(await f.db.travelAgentInvite.findUniqueOrThrow({ where: { id: invite.id } }))
      .toMatchObject({ status: "PENDING", email: "invited@example.test", travelAgentId: invite.travelAgentId });
    expect(await f.db.travelAgentUser.count({ where: { travelAgentId: invite.travelAgentId } })).toBe(0);
    expect(await f.db.travelAgentOrganization.count({ where: { travelAgentId: invite.travelAgentId } })).toBe(0);

    await f.depositHistory();
    const session = await f.db.depositSession.findFirstOrThrow({ where: { userId: f.ids.userA } });
    expect(session.status).toBe("COMPLETED");
    expect(session.completedAt).toBeInstanceOf(Date);
    expect(await f.db.rewardLedger.count({ where: { userId: f.ids.userA } })).toBe(0);
  });

  it("refuses later-contract helpers instead of faking success", async () => {
    await expect(f.confirmFunding(10_000)).rejects.toThrow("B01 contract unavailable");
    await expect(f.reserveBudget({ businessKey: "admission-a", amount: 8_000 })).rejects.toThrow("B01 contract unavailable");
    await expect(f.trip({ bagCount: 1, recipientConfirmed: true })).rejects.toThrow("B03 contract unavailable");
    expect(await f.db.trip.count()).toBe(0);
    await expect(f.seedBalance(10.5)).rejects.toThrow(/positive integer/);
  });
});

describe("isolation guards", () => {
  it("fails clearly when PostgreSQL or Redis is unreachable instead of substituting a mock", async () => {
    const port = await closedLoopbackPort();
    await expect(assertPostgresReachable(withPort(process.env.DATABASE_URL!, port)))
      .rejects.toThrow(/PostgreSQL test database unreachable/);
    await expect(assertRedisReachable(withPort(process.env.REDIS_URL!, port)))
      .rejects.toThrow(/Redis test instance unreachable/);
  });

  it("refuses to reset any database other than the runner-owned test database", async () => {
    const admin = await f.connection();
    await admin.$executeRawUnsafe(`CREATE DATABASE reloop_operational_sentinel`);
    const sentinelUrl = new URL(process.env.DATABASE_URL!);
    sentinelUrl.pathname = "/reloop_operational_sentinel";
    const sentinel = new PrismaClient({ datasourceUrl: sentinelUrl.toString() });
    try {
      await sentinel.$executeRawUnsafe(`CREATE TABLE "User" (id text PRIMARY KEY)`);
      await sentinel.$executeRawUnsafe(`INSERT INTO "User" (id) VALUES ('operational-row')`);

      await expect(resetDisposableDatabase(sentinel, sentinelUrl.toString()))
        .rejects.toThrow(/reloop_audit_test/);
      // Even when the URL claims to be the test database, the live identity check refuses.
      await expect(resetDisposableDatabase(sentinel, process.env.DATABASE_URL!))
        .rejects.toThrow(/live database is "reloop_operational_sentinel"/);

      expect(await sentinel.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "User"`))
        .toEqual([{ n: 1 }]);
    } finally {
      await sentinel.$disconnect();
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS reloop_operational_sentinel WITH (FORCE)`);
    }
  });
});
