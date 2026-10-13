import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { buildSessionPayload, hashPassword, SESSION_COOKIE, signSession } from "@/lib/auth";
import { generateEmailToken, hashInviteToken, INVITE_TOKEN_TTL_MS } from "@/lib/email-tokens";
import { encrypt } from "@/lib/encryption";
import { getWalletBalance } from "@/lib/ledger";
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/lib/qr";
import type { AppRole } from "@/lib/roles";
import { readCapturedTransport, type CapturedTransport } from "@/lib/test-transport";
import { generateTotpCode, generateTotpSecret } from "@/lib/totp";
import {
  assertPostgresReachable,
  assertRedisReachable,
  auditEnvironment,
  resetDisposableDatabase,
  resetRedisNamespace,
} from "./disposable-db";
import { startRealtimeHarness, type RealtimeHarness } from "./realtime-harness";

export type ActorKey = "guest"|"userA"|"userB"|"adminA"|"adminB"|"superadmin"|"collectorA"|"collectorB";
export type FixtureActor = Exclude<ActorKey, "guest">;
export type TestIds = {
  userA:string;userB:string;adminA:string;adminB:string;superadmin:string;
  collectorA:string;collectorB:string;orgA:string;orgB:string;
  machineA:string;machineCode:string;payoutAccountA:string;
};

/** Contract from the remediation master plan (F01), plus harness extras below it. */
export interface AuditFixture {
  db:PrismaClient;
  ids:TestIds;
  json(as:ActorKey,method:string,path:string,body?:unknown):Promise<Response>;
  seedBalance(amount:number):Promise<void>;
  seedCredit(input:{organization:"A"|"B";amount:number}):Promise<void>;
  processingRedemption(amount:number):Promise<string>;
  redeemAndSettle(amount:number):Promise<string>;
  trip(input:{bagCount:number;organization?:"A"|"B";
    recipientConfirmed?:boolean;status?:"PLANNED"|"ACTIVE"}):Promise<{id:string;bagIds:string[]}>;
  pendingInvite(email:string):Promise<{travelAgentId:string;id:string;token:string}>;
  depositHistory():Promise<void>;
  machineQrToken():Promise<string>;
  pickup():Promise<{id:string}>;
  confirmFunding(amount:number):Promise<void>;
  reserveBudget(input:{businessKey:string;amount:number}):Promise<string>;
  gateway():Promise<RealtimeHarness>;
  dispose():Promise<void>;

  // Harness extras (not production API):
  /** Runner-owned Redis client (keys are reset per test). */
  redis: Redis;
  /** Independent PrismaClient (own pool) for multi-connection race tests; closed by dispose(). */
  connection(): Promise<PrismaClient>;
  /** Production-signed reloop_session value for an actor (what json() sends; browser login uses it). */
  sessionCookie(actor: FixtureActor): Promise<string>;
  /** Login credentials for /api/auth/login tests. */
  credentials(actor: FixtureActor): { email: string; password: string };
  /** Current TOTP code for an MFA-enabled actor (adminA). */
  totpCode(actor: FixtureActor): string;
  /** Mail/push captured by the fake transport in the Next child and this process. */
  capturedTransport(kind?: CapturedTransport["kind"]): Promise<CapturedTransport[]>;
}

/** Thrown by fixture extension points whose domain contract a later task owns. */
export class FixtureContractUnavailable extends Error {
  constructor(task: string, helper: string) {
    super(`${task} contract unavailable: ${helper} is implemented by task ${task}; enable this suite after ${task} lands`);
    this.name = "FixtureContractUnavailable";
  }
}

const ACTORS: Record<FixtureActor, { role: AppRole; name: string; org: "A" | "B" | null; mfa?: true }> = {
  userA: { role: "USER", name: "Pengguna Audit A", org: null },
  userB: { role: "USER", name: "Pengguna Audit B", org: null },
  adminA: { role: "ADMIN", name: "Admin Audit A", org: "A", mfa: true },
  adminB: { role: "ADMIN", name: "Admin Audit B", org: "B" },
  superadmin: { role: "SUPERADMIN", name: "Superadmin Audit", org: null },
  collectorA: { role: "PENGEPUL", name: "Pengepul Audit A", org: null },
  collectorB: { role: "PENGEPUL", name: "Pengepul Audit B", org: null },
};
const EMAIL_DOMAIN = "reloop-audit.test";
const MACHINE_CODE = "AUDIT-A-01";
const DAY_MS = 86_400_000;

const emailOf = (actor: FixtureActor) => `${actor.toLowerCase()}@${EMAIL_DOMAIN}`;

let passwordHash: Promise<string> | undefined;
let dependenciesProbed = false;

function assertRupiah(amount: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(`amount must be a positive integer rupiah value, got ${amount}`);
  }
}

async function expectJson(response: Response, expected: number, what: string): Promise<any> {
  if (response.status !== expected) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`${what}: expected HTTP ${expected}, got ${response.status} ${detail}`);
  }
  return response.json();
}

interface Graph {
  ids: TestIds;
  trashBagCampaign: Record<"A" | "B", string>;
  totpSecret: string;
}

async function seedGraph(password: string): Promise<Graph> {
  passwordHash ??= hashPassword(password);
  const hash = await passwordHash;
  const now = Date.now();
  const [orgA, orgB] = await Promise.all(["A", "B"].map((key) => prisma.organization.create({
    data: { name: `Organisasi Audit ${key}`, type: "OTHER", status: "ACTIVE" },
  })));
  const orgIds = { A: orgA.id, B: orgB.id };
  const totpSecret = generateTotpSecret();
  const users = {} as Record<FixtureActor, string>;
  for (const [key, spec] of Object.entries(ACTORS) as [FixtureActor, (typeof ACTORS)[FixtureActor]][]) {
    const user = await prisma.user.create({
      data: {
        name: spec.name,
        email: emailOf(key),
        passwordHash: hash,
        role: spec.role,
        organizationId: spec.org ? orgIds[spec.org] : null,
        ...(spec.mfa ? { mfaEnabled: true, totpSecret: encrypt(totpSecret) } : {}),
      },
    });
    users[key] = user.id;
  }
  for (const collector of ["collectorA", "collectorB"] as const) {
    await prisma.organizationCollectorPartner.create({
      data: { organizationId: orgA.id, collectorUserId: users[collector], status: "ACTIVE", approvedBySuperadminId: users.superadmin },
    });
  }
  const payout = await prisma.payoutAccount.create({
    data: {
      userId: users.userA,
      provider: "DANA",
      accountIdentifier: `08${randomBytes(5).readUIntBE(0, 5).toString().padStart(10, "0").slice(0, 10)}`,
      accountName: ACTORS.userA.name,
      status: "VERIFIED",
      verifiedAt: new Date(now),
    },
  });
  const machine = await prisma.machine.create({
    data: {
      organizationId: orgA.id,
      machineCode: MACHINE_CODE,
      name: "Mesin Audit A",
      status: "ONLINE",
      lastHeartbeatAt: new Date(now),
      ingestSecret: randomBytes(32).toString("hex"),
      qrToken: generateToken(),
      qrTokenExpiresAt: new Date(now + 10 * 60_000),
    },
  });
  const wasteType = await prisma.wasteType.create({
    data: { name: "Botol Plastik Audit", unit: "ITEM", active: true },
  });
  await prisma.machineWasteType.create({ data: { machineId: machine.id, wasteTypeId: wasteType.id, active: true } });
  await prisma.rewardRate.create({
    data: { organizationId: orgA.id, wasteTypeId: wasteType.id, unit: "ITEM", pointsPerItem: 100, active: true },
  });
  const window = { status: "ACTIVE" as const, rewardMode: "MONEY_REWARD" as const,
    startAt: new Date(now - DAY_MS), endAt: new Date(now + 30 * DAY_MS) };
  await prisma.campaign.create({
    data: { ...window, organizationId: orgA.id, name: "Program Mesin Audit A", campaignType: "MACHINE_DEPOSIT" },
  });
  const trashBag = {} as Record<"A" | "B", string>;
  for (const key of ["A", "B"] as const) {
    const campaign = await prisma.campaign.create({
      data: { ...window, organizationId: orgIds[key], name: `Program Kantong Audit ${key}`, campaignType: "TRASH_BAG" },
    });
    trashBag[key] = campaign.id;
  }
  return {
    ids: {
      ...users,
      orgA: orgA.id,
      orgB: orgB.id,
      machineA: machine.id,
      machineCode: machine.machineCode,
      payoutAccountA: payout.id,
    },
    trashBagCampaign: trashBag,
    totpSecret,
  };
}

/**
 * Builds a fresh fixture: guards the environment, wipes the runner-owned
 * database/Redis, and seeds the contract graph through the production Prisma
 * client (so encryption hooks run). Used by Vitest (audit-fixture.ts) and
 * Playwright (browser-fixture.ts).
 */
export async function createAuditFixture(): Promise<AuditFixture> {
  const env = auditEnvironment();
  const password = process.env.AUDIT_FIXTURE_PASSWORD;
  const sink = process.env.AUDIT_TRANSPORT_SINK;
  if (!password || !sink) {
    throw new Error("AUDIT_FIXTURE_PASSWORD/AUDIT_TRANSPORT_SINK missing; run through scripts/run-audit-tests.mjs");
  }
  if (!dependenciesProbed) {
    await assertPostgresReachable(env.databaseUrl);
    await assertRedisReachable(env.redisUrl);
    dependenciesProbed = true;
  }
  // Fail fast if the runner's Redis disappears mid-test; never reconnect forever.
  const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true, retryStrategy: () => null });
  await redis.connect();
  const extraClients: PrismaClient[] = [];
  const gateways: RealtimeHarness[] = [];

  const resetAll = async () => {
    await resetDisposableDatabase(prisma, env.databaseUrl, env.runId);
    await resetRedisNamespace(redis, env.runId);
    writeFileSync(sink, "", { mode: 0o600 });
  };
  let graph: Graph;
  try {
    await resetAll();
    graph = await seedGraph(password);
  } catch (error) {
    redis.disconnect();
    await prisma.$disconnect();
    throw error;
  }
  const { ids } = graph;
  const jar = new Map<FixtureActor, string | null>();

  async function sessionToken(actor: FixtureActor): Promise<string> {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: ids[actor] } });
    return signSession(buildSessionPayload({ ...user, role: user.role as AppRole }));
  }

  /** Per-actor cookie jar: signed once, then follows Set-Cookie rotation/clearing. */
  async function cookieFor(actor: FixtureActor): Promise<string | null> {
    if (!jar.has(actor)) jar.set(actor, await sessionToken(actor));
    return jar.get(actor) ?? null;
  }

  function remember(actor: FixtureActor, response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      if (!cookie.startsWith(`${SESSION_COOKIE}=`)) continue;
      const value = cookie.slice(SESSION_COOKIE.length + 1).split(";")[0];
      jar.set(actor, value && !/max-age=0/i.test(cookie) ? value : null);
    }
  }

  async function json(as: ActorKey, method: string, path: string, body?: unknown): Promise<Response> {
    const base = process.env.AUDIT_BASE_URL;
    if (!base) {
      throw new Error("Next HTTP origin unavailable: AUDIT_BASE_URL is not set (json() needs test:integration or test:browser)");
    }
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (as !== "guest") {
      const token = await cookieFor(as);
      if (token) headers.cookie = `${SESSION_COOKIE}=${token}`;
    }
    let response: Response;
    try {
      response = await fetch(new URL(path, base), {
        method, headers, redirect: "manual",
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new Error(`Next HTTP test server unreachable at ${base}: ${(error as Error).message}`);
    }
    if (as !== "guest") remember(as, response);
    return response;
  }

  async function credit(amount: number, organizationId: string | null) {
    assertRupiah(amount);
    const referenceId = `audit-fixture:${randomUUID()}`;
    await prisma.rewardLedger.create({
      data: { userId: ids.userA, organizationId, entryType: "EARN", amount, status: "AVAILABLE",
        reasonCode: "AUDIT_FIXTURE", referenceType: "AuditFixture", referenceId },
    });
    const count = await prisma.rewardLedger.count({ where: { referenceType: "AuditFixture", referenceId } });
    if (count !== 1) throw new Error(`fixture ledger key ${referenceId} is not unique (${count})`);
  }

  async function requestRedemption(amount: number): Promise<string> {
    const body = await expectJson(await json("userA", "POST", "/api/redemptions", {
      amount, payoutAccountId: ids.payoutAccountA, idempotencyKey: `audit-${randomUUID()}`,
    }), 201, "POST /api/redemptions");
    return body.redemption.id;
  }

  async function transition(id: string, action: string, extra: Record<string, unknown> = {}) {
    await expectJson(await json("superadmin", "PATCH", `/api/redemptions/${id}`, { action, ...extra }),
      200, `PATCH /api/redemptions ${action}`);
  }

  const fixture: AuditFixture = {
    db: prisma,
    ids,
    redis,
    json,
    seedBalance: (amount) => credit(amount, null),
    seedCredit: async ({ organization, amount }) => credit(amount, organization === "A" ? ids.orgA : ids.orgB),
    async processingRedemption(amount) {
      assertRupiah(amount);
      const { available } = await getWalletBalance(ids.userA);
      if (available < amount) await credit(amount - available, null);
      const id = await requestRedemption(amount);
      await transition(id, "approve");
      await transition(id, "process");
      return id;
    },
    async redeemAndSettle(amount) {
      assertRupiah(amount);
      const id = await requestRedemption(amount);
      await transition(id, "approve");
      await transition(id, "process");
      await transition(id, "success", { providerReference: `AUDIT-REF-${randomBytes(4).toString("hex")}` });
      return id;
    },
    async trip({ bagCount, organization = "A", recipientConfirmed, status = "ACTIVE" }) {
      if (recipientConfirmed !== undefined) throw new FixtureContractUnavailable("B03", "trip({ recipientConfirmed })");
      if (!Number.isSafeInteger(bagCount) || bagCount < 0) throw new Error(`bagCount must be a non-negative integer, got ${bagCount}`);
      const trip = await prisma.trip.create({
        data: { campaignId: graph.trashBagCampaign[organization], userId: ids.userA, status },
      });
      const bagIds: string[] = [];
      for (let i = 0; i < bagCount; i += 1) {
        const bag = await prisma.trashBagAssignment.create({
          data: { tripId: trip.id, bagQrCode: `AUDIT-BAG-${randomUUID()}`, bagCount: 1 },
        });
        bagIds.push(bag.id);
      }
      return { id: trip.id, bagIds };
    },
    async pendingInvite(email) {
      const agent = await prisma.travelAgent.create({
        data: { name: "Agen Audit", email: `agent-${randomUUID()}@${EMAIL_DOMAIN}` },
      });
      // The rows POST /api/travel-agents creates (A03): a PENDING agent link and
      // a delivered invitation. Only the token's hash is persisted; the raw
      // token lives in fixture memory, as it would in the invited mailbox.
      await prisma.travelAgentOrganization.create({
        data: { travelAgentId: agent.id, organizationId: ids.orgA, status: "PENDING", invitedById: ids.adminA },
      });
      const token = generateEmailToken();
      const invite = await prisma.travelAgentInvite.create({
        data: {
          travelAgentId: agent.id, organizationId: ids.orgA, email, status: "PENDING", invitedById: ids.adminA,
          tokenHash: hashInviteToken(token), expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
        },
      });
      return { travelAgentId: agent.id, id: invite.id, token };
    },
    async depositHistory() {
      await prisma.depositSession.create({
        data: { userId: ids.userA, machineId: ids.machineA, status: "COMPLETED", completedAt: new Date() },
      });
    },
    async machineQrToken() {
      const token = generateToken();
      await prisma.machine.update({
        where: { id: ids.machineA },
        data: { qrToken: token, qrTokenExpiresAt: new Date(Date.now() + 5 * 60_000) },
      });
      return token;
    },
    async pickup() {
      const body = await expectJson(await json("adminA", "POST", "/api/pickups", { reason: "MANUAL", notes: "audit fixture" }),
        201, "POST /api/pickups");
      return { id: body.pickup.id };
    },
    async confirmFunding() {
      throw new FixtureContractUnavailable("B01", "confirmFunding()");
    },
    async reserveBudget() {
      throw new FixtureContractUnavailable("B01", "reserveBudget()");
    },
    async gateway() {
      const harness = await startRealtimeHarness({
        internalSecret: process.env.REALTIME_INTERNAL_SECRET ?? "",
        async issueSession(actor) {
          const user = await prisma.user.findUniqueOrThrow({ where: { id: ids[actor] } });
          const token = await signSession(buildSessionPayload({ ...user, role: user.role as AppRole }));
          return { token, user: { id: user.id, role: user.role, organizationId: user.organizationId, tokenVersion: user.tokenVersion } };
        },
      });
      gateways.push(harness);
      return harness;
    },
    async connection() {
      const client = new PrismaClient({ datasourceUrl: env.databaseUrl });
      extraClients.push(client);
      return client;
    },
    async sessionCookie(actor) {
      const token = await cookieFor(actor);
      if (!token) throw new Error(`${actor}'s session was cleared by a Set-Cookie response`);
      return token;
    },
    credentials: (actor) => ({ email: emailOf(actor), password }),
    totpCode(actor) {
      if (!ACTORS[actor].mfa) throw new Error(`${actor} has no MFA secret in the fixture`);
      return generateTotpCode(graph.totpSecret);
    },
    async capturedTransport(kind) {
      const all = readCapturedTransport(sink);
      return kind ? all.filter((message) => message.kind === kind) : all;
    },
    async dispose() {
      try {
        await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
        await Promise.all(extraClients.splice(0).map((client) => client.$disconnect()));
        await resetAll();
      } finally {
        redis.disconnect();
        await prisma.$disconnect();
      }
    },
  };
  return fixture;
}
