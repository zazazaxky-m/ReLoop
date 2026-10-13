import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@/lib/auth";
import { deliverEmailOutbox, enqueueEmailVerification, processDueEmailOutbox } from "@/lib/email-outbox";
import { hashEmailVerificationToken, hashInviteToken } from "@/lib/email-tokens";
import { emailLookupHash } from "@/lib/encryption";
import {
  INVITE_EMAIL_MISMATCH, INVITE_INACTIVE, INVITE_USED, acceptTravelAgentInvite, issueTravelAgentInvite, travelAgentAccessImpact,
} from "@/lib/invitations";
import type { CapturedTransport } from "@/lib/test-transport";
import { tripNotificationRecipients } from "@/lib/trip-validation";
import { f, type FixtureActor } from "../support/audit-fixture";
import { InjectedFault, deferred, isStillPending, waitForBlockedBy } from "../support/race-probe";

/**
 * SEC-03 / A03: a mailbox must be proven before an account gains travel-agent
 * access. Registration alone never claims a pending invitation.
 */

type Json = Record<string, any>;
type Mail = Extract<CapturedTransport, { kind: "mail" }>;

const ACCEPT = "/api/travel-agent-invitations/accept";
const VERIFY = "/api/auth/verify-email";
const RESEND = "/api/auth/verify-email/resend";
const PASSWORD = "Audit-pass-12345!";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(actor: FixtureActor | "guest", method: string, route: string, body?: unknown) {
  const response = await f.json(actor, method, route, body);
  return { response, status: response.status, body: (await response.json().catch(() => null)) as Json };
}

/** A request with an explicit session token (an account registered during the test). */
async function callWith(token: string, method: string, route: string, body?: unknown) {
  const base = process.env.AUDIT_BASE_URL;
  if (!base) throw new Error("AUDIT_BASE_URL missing; run through npm run test:integration");
  const headers: Record<string, string> = { accept: "application/json", cookie: `${SESSION_COOKIE}=${token}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(new URL(route, base), {
    method, headers, redirect: "manual", body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json().catch(() => null)) as Json };
}

async function page(actor: FixtureActor | "guest", route: string) {
  const headers: Record<string, string> = { accept: "text/html" };
  if (actor !== "guest") headers.cookie = `${SESSION_COOKIE}=${await f.sessionCookie(actor)}`;
  const response = await fetch(new URL(route, process.env.AUDIT_BASE_URL), { headers, redirect: "manual" });
  return { response, status: response.status, html: await response.text() };
}

function sessionFrom(response: Response): string {
  for (const cookie of response.headers.getSetCookie()) {
    if (cookie.startsWith(`${SESSION_COOKIE}=`)) return cookie.slice(SESSION_COOKIE.length + 1).split(";")[0];
  }
  throw new Error("no session cookie in the response");
}

async function register(email: string, name = "Pengguna Baru") {
  const response = await f.json("guest", "POST", "/api/auth/register", { name, email, phone: "081234567890", password: PASSWORD });
  expect(response.status).toBe(201);
  const body = (await response.json()) as Json;
  return { id: body.user.id as string, session: sessionFrom(response), body };
}

const emailOf = (actor: FixtureActor) => f.credentials(actor).email;

/** Waits for after-commit delivery to the fake transport (lib/test-transport.ts). */
async function mailsTo(to: string, subject: RegExp, count = 1, timeoutMs = 20_000): Promise<Mail[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mails = (await f.capturedTransport("mail")).filter(
      (m): m is Mail => m.kind === "mail" && m.to === to && subject.test(m.subject),
    );
    if (mails.length >= count) return mails;
    if (Date.now() > deadline) throw new Error(`expected ${count} mail(s) "${subject}" to ${to}, got ${mails.length}`);
    await sleep(100);
  }
}

const INVITE_SUBJECT = /Undangan travel agent/;
const VERIFY_SUBJECT = /Verifikasi email/;

function tokenIn(mail: Mail, linkPath: string): string {
  const match = new RegExp(`${linkPath}#token=([A-Za-z0-9_-]+)`).exec(mail.text);
  if (!match) throw new Error(`no ${linkPath} link in the mail`);
  // Same link in the HTML part; never as a query parameter.
  expect(mail.html).toContain(`${linkPath}#token=${match[1]}`);
  expect(`${mail.text}${mail.html}`).not.toMatch(/[?&]token=/);
  return match[1];
}

async function trashBagCampaign(organizationId = f.ids.orgA) {
  return f.db.campaign.findFirstOrThrow({ where: { organizationId, campaignType: "TRASH_BAG" } });
}

/** A trip of the agent with no reward recipient (visible only through agent membership). */
async function agentTrip(travelAgentId: string, groupName: string) {
  const campaign = await trashBagCampaign();
  return f.db.trip.create({ data: { campaignId: campaign.id, travelAgentId, groupName, status: "ACTIVE" } });
}

/**
 * A membership as the pre-A03 code created it: the agent INVITED by orgA and
 * an OWNER link made by matching an (unverified) registration email.
 */
async function legacyMembership(actor: FixtureActor, agentEmail = `legacy-${randomBytes(4).toString("hex")}@example.test`) {
  const agent = await f.db.travelAgent.create({ data: { name: `Agen Lama ${actor}`, email: agentEmail } });
  await f.db.travelAgentOrganization.create({
    data: { travelAgentId: agent.id, organizationId: f.ids.orgA, status: "INVITED", approvedAt: new Date() },
  });
  await f.db.travelAgentInvite.create({
    data: { travelAgentId: agent.id, organizationId: f.ids.orgA, email: agentEmail, status: "INVITED" },
  });
  const membership = await f.db.travelAgentUser.create({ data: { travelAgentId: agent.id, userId: f.ids[actor], roleInAgent: "OWNER" } });
  return { agent, membership };
}

async function memberships(travelAgentId: string) {
  return f.db.travelAgentUser.findMany({ where: { travelAgentId } });
}

/** Rows that could carry a token, as raw JSON text (no decryption), plus every audit row. */
async function persistedText(): Promise<string> {
  const rows = await f.db.$queryRaw<{ row: string }[]>`
    SELECT row_to_json(t)::text AS row FROM "EmailOutbox" t
    UNION ALL SELECT row_to_json(t)::text FROM "TravelAgentInvite" t
    UNION ALL SELECT row_to_json(t)::text FROM "EmailVerificationToken" t
    UNION ALL SELECT row_to_json(t)::text FROM "AuditLog" t
    UNION ALL SELECT row_to_json(t)::text FROM "User" t`;
  return rows.map((r) => r.row).join("\n");
}

function nextLogPath() {
  const dir = process.env.AUDIT_ARTIFACT_DIR;
  if (!dir) throw new Error("AUDIT_ARTIFACT_DIR missing; run through npm run test:integration");
  return path.join(dir, "logs", "next.log");
}

/** Another transaction holding the User row lock on its own connection. */
async function holdUserLock(userId: string) {
  const connection = await f.connection();
  const locked = deferred<number>();
  const release = deferred();
  const done = connection.$transaction(async (tx) => {
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR NO KEY UPDATE`;
    locked.resolve(pid);
    await release.promise;
  }, { maxWait: 10_000, timeout: 90_000 });
  done.catch((error) => locked.reject(error));
  const pid = await locked.promise;
  return { pid, async release() { release.resolve(); await done; } };
}

/** Bounded: `count` backends queue (transitively) behind `holderPid`. */
async function waitForLockQueue(observer: PrismaClient, holderPid: number, count: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const waiting = await observer.$queryRaw<{ pid: number; blockers: number[] }[]>`
      SELECT pid, pg_blocking_pids(pid) AS blockers FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND cardinality(pg_blocking_pids(pid)) > 0`;
    const queue = new Set<number>([holderPid]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const { pid, blockers } of waiting) {
        if (!queue.has(pid) && blockers.some((blocker) => queue.has(blocker))) {
          queue.add(pid);
          grew = true;
        }
      }
    }
    if (queue.size - 1 >= count) return;
    await sleep(25);
  }
  throw new Error(`${count} backends did not queue behind ${holderPid} within ${timeoutMs}ms`);
}

describe("travel agent invitations (SEC-03)", () => {
  it("registration alone never claims a pending invitation", async () => {
    const invited = await f.pendingInvite("invited@example.test");
    const res = await f.json("guest", "POST", "/api/auth/register", {
      name:"Unverified",email:"invited@example.test",phone:"081234567890",
      password:"Audit-pass-12345!",
    });
    expect(res.status).toBe(201);
    expect(await f.db.travelAgentUser.count({where:{travelAgentId:invited.travelAgentId}})).toBe(0);
  });

  it("a pre-registered attacker gains nothing when an admin invites their address", async () => {
    // The attacker registers the agent's address first; they cannot read its mailbox.
    const address = "agen-korban@example.test";
    const attacker = await register(address, "Penyerang");
    expect((await f.db.user.findUniqueOrThrow({ where: { id: attacker.id } })).emailVerifiedAt).toBeNull();

    const invited = await call("adminA", "POST", "/api/travel-agents", { name: "Agen Korban", email: address });
    expect(invited.status).toBe(201);
    expect(invited.body).toMatchObject({ organizationStatus: "PENDING", delivery: "QUEUED" });
    expect(JSON.stringify(invited.body)).not.toMatch(/tokenHash/);
    const travelAgentId = invited.body.agent.id as string;
    // Listing used to link matching accounts too; it must not.
    expect((await call("adminA", "GET", "/api/travel-agents")).status).toBe(200);

    // The invitation goes to the mailbox, not to the account that claims the address.
    const [mail] = await mailsTo(address, INVITE_SUBJECT);
    tokenIn(mail, "/accept-invitation");
    expect(await memberships(travelAgentId)).toEqual([]);
    expect(await f.db.travelAgentOrganization.findMany({ where: { travelAgentId }, select: { status: true } }))
      .toEqual([{ status: "PENDING" }]);

    // Without the mailbox token the attacker cannot claim it, nor by naming the address.
    expect((await callWith(attacker.session, "POST", ACCEPT, { token: randomBytes(32).toString("base64url") })).status).toBe(400);
    expect((await callWith(attacker.session, "POST", ACCEPT, { email: address })).status).toBe(422);
    expect((await callWith(attacker.session, "POST", ACCEPT, { token: randomBytes(32).toString("base64url"), email: address })).status).toBe(422);
    const trips = await callWith(attacker.session, "GET", "/api/trips");
    expect(trips.status).toBe(200);
    expect(trips.body.trips).toEqual([]);
    expect((await callWith(attacker.session, "GET", "/api/user/dashboard")).body.isTravelAgent).toBe(false);
    expect(await memberships(travelAgentId)).toEqual([]);
    expect((await f.db.travelAgentInvite.findFirstOrThrow({ where: { travelAgentId } })).acceptedAt).toBeNull();
  });

  it("the invited mailbox owner accepts once: verified membership, active link, verified email, trip access", async () => {
    const email = emailOf("userA");
    const invited = await call("adminA", "POST", "/api/travel-agents", { name: "Agen Wisata A03", email });
    expect(invited.status).toBe(201);
    const travelAgentId = invited.body.agent.id as string;
    const [mail] = await mailsTo(email, INVITE_SUBJECT);
    const token = tokenIn(mail, "/accept-invitation");
    expect(mail.text).toMatch(/berlaku 24 jam/);

    const stored = await f.db.travelAgentInvite.findUniqueOrThrow({ where: { id: invited.body.invite.id } });
    expect(stored.tokenHash).toBe(hashInviteToken(token));
    const ttl = stored.expiresAt!.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(23.5 * 3_600_000);
    expect(ttl).toBeLessThanOrEqual(24 * 3_600_000);
    expect(await memberships(travelAgentId)).toEqual([]);

    const accepted = await call("userA", "POST", ACCEPT, { token });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ accepted: true, travelAgentId, organizationId: f.ids.orgA });

    const [membership] = await memberships(travelAgentId);
    expect(membership).toMatchObject({ userId: f.ids.userA, roleInAgent: "OWNER" });
    expect(membership.verifiedAt).toBeInstanceOf(Date);
    expect(await f.db.travelAgentOrganization.findFirstOrThrow({ where: { travelAgentId } }))
      .toMatchObject({ status: "INVITED", organizationId: f.ids.orgA });
    expect(await f.db.travelAgentInvite.findUniqueOrThrow({ where: { id: stored.id } }))
      .toMatchObject({ acceptedById: f.ids.userA, status: "INVITED" });
    expect((await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } })).emailVerifiedAt).toBeInstanceOf(Date);
    expect(await f.db.auditLog.count({ where: { action: "TRAVEL_AGENT_INVITE_ACCEPTED", entityId: stored.id } })).toBe(1);

    const trip = await agentTrip(travelAgentId, "Rombongan Terverifikasi");
    const list = await call("userA", "GET", "/api/trips");
    expect(list.body.trips.map((t: Json) => t.id)).toContain(trip.id);
    expect((await call("userA", "GET", `/api/trips/${trip.id}`)).status).toBe(200);

    // Replayed token: refused, nothing changes.
    const replay = await call("userA", "POST", ACCEPT, { token });
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe(INVITE_USED);
    expect(await memberships(travelAgentId)).toHaveLength(1);
  });

  it("refuses the wrong account, a free email in the body, unknown, expired and replayed tokens", async () => {
    const invite = await f.pendingInvite(emailOf("userA"));
    const unaccepted = async () => (await f.db.travelAgentInvite.findUniqueOrThrow({ where: { id: invite.id } })).acceptedAt;

    const wrongUser = await call("userB", "POST", ACCEPT, { token: invite.token });
    expect(wrongUser.status).toBe(403);
    expect(wrongUser.body.error).toBe(INVITE_EMAIL_MISMATCH);
    expect(wrongUser.body.error).not.toContain(invite.token);
    expect((await call("guest", "POST", ACCEPT, { token: invite.token })).status).toBe(401);
    expect((await call("adminA", "POST", ACCEPT, { token: invite.token })).status).toBe(403);
    expect((await call("userA", "POST", ACCEPT, { token: invite.token, email: emailOf("userA") })).status).toBe(422);
    expect((await call("userA", "POST", ACCEPT, {})).status).toBe(422);
    expect((await call("userA", "POST", ACCEPT, { token: "kurang" })).status).toBe(422);
    expect((await call("userA", "POST", ACCEPT, { token: randomBytes(32).toString("base64url") })).status).toBe(400);
    expect(await unaccepted()).toBeNull();
    expect(await memberships(invite.travelAgentId)).toEqual([]);

    const expired = await f.pendingInvite(emailOf("userA"));
    await f.db.travelAgentInvite.update({ where: { id: expired.id }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    const late = await call("userA", "POST", ACCEPT, { token: expired.token });
    expect(late.status).toBe(410);
    expect(await memberships(expired.travelAgentId)).toEqual([]);

    expect((await call("userA", "POST", ACCEPT, { token: invite.token })).status).toBe(200);
    expect((await call("userA", "POST", ACCEPT, { token: invite.token })).status).toBe(409);
    expect((await memberships(invite.travelAgentId)).map((m) => m.userId)).toEqual([f.ids.userA]);
    expect(await f.db.travelAgentUser.count({ where: { userId: f.ids.userB } })).toBe(0);
  });

  it("two parallel accepts of one invitation create exactly one membership (deterministic lock order)", async () => {
    const invite = await f.pendingInvite(emailOf("userA"));
    // Compile the route first so both racers reach the lock well inside lock_timeout.
    expect((await call("userA", "POST", ACCEPT, { token: randomBytes(32).toString("base64url") })).status).toBe(400);

    const observer = await f.connection();
    const holder = await holdUserLock(f.ids.userA);
    let racers: Promise<number>[];
    try {
      racers = [0, 1].map(() => f.json("userA", "POST", ACCEPT, { token: invite.token }).then((r) => r.status));
      await waitForLockQueue(observer, holder.pid, 2);
      expect(await isStillPending(Promise.all(racers), 100)).toBe(true);
    } finally {
      await holder.release();
    }
    expect((await Promise.all(racers)).sort()).toEqual([200, 409]);
    expect(await memberships(invite.travelAgentId)).toHaveLength(1);
    expect(await f.db.auditLog.count({ where: { action: "TRAVEL_AGENT_INVITE_ACCEPTED", entityId: invite.id } })).toBe(1);
  });

  it("an email change racing an accept waits on the User lock, so the claim is checked against the address it commits with", async () => {
    const invite = await f.pendingInvite(emailOf("userA"));
    const currentPassword = f.credentials("userA").password;
    // Compile PATCH /api/auth/me first so it reaches the lock well inside lock_timeout.
    expect((await call("userA", "PATCH", "/api/auth/me", { name: "Pengguna Audit A" })).status).toBe(200);

    const observer = await f.connection();
    let patch: Promise<number> | undefined;
    await acceptTravelAgentInvite(f.ids.userA, invite.token, {
      async afterLock(tx) {
        const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
        patch = f.json("userA", "PATCH", "/api/auth/me", { email: "usera-balapan@example.test", currentPassword })
          .then((r) => r.status);
        // The email change is blocked by this accept (User lock) until it commits.
        await waitForBlockedBy(observer, { holderPid: pid, timeoutMs: 8_000 });
        expect(await isStillPending(patch, 100)).toBe(true);
      },
    });
    expect(await patch).toBe(200);
    // Serialized: the claim committed for the invited address, then the change
    // to a new address cleared the proof it gave.
    const user = await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } });
    expect(user.email).toBe("usera-balapan@example.test");
    expect(user.emailVerifiedAt).toBeNull();
    const [membership] = await memberships(invite.travelAgentId);
    expect(membership.verifiedAt).toBeNull();
    expect((await f.db.travelAgentInvite.findUniqueOrThrow({ where: { id: invite.id } })).acceptedById).toBe(f.ids.userA);
  });

  it("a suspended or removed agent link, a suspended organization or a suspended agent refuses the claim", async () => {
    const cases: Array<[string, (invite: { travelAgentId: string }) => Promise<unknown>]> = [
      ["link SUSPENDED", (i) => f.db.travelAgentOrganization.updateMany({ where: { travelAgentId: i.travelAgentId }, data: { status: "SUSPENDED" } })],
      ["link REMOVED", (i) => f.db.travelAgentOrganization.updateMany({ where: { travelAgentId: i.travelAgentId }, data: { status: "REMOVED" } })],
      ["agent SUSPENDED", (i) => f.db.travelAgent.update({ where: { id: i.travelAgentId }, data: { status: "SUSPENDED" } })],
      ["organization SUSPENDED", () => f.db.organization.update({ where: { id: f.ids.orgA }, data: { status: "SUSPENDED" } })],
    ];
    for (const [label, suspend] of cases) {
      const invite = await f.pendingInvite(emailOf("userA"));
      await suspend(invite);
      const res = await call("userA", "POST", ACCEPT, { token: invite.token });
      expect([label, res.status, res.body.error]).toEqual([label, 403, INVITE_INACTIVE]);
      expect(await memberships(invite.travelAgentId)).toEqual([]);
      expect((await f.db.travelAgentInvite.findUniqueOrThrow({ where: { id: invite.id } })).acceptedAt).toBeNull();
    }
    expect((await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } })).emailVerifiedAt).toBeNull();
  });
});

describe("trip access needs a verified membership (web and mobile API)", () => {
  it("an unverified member reads none of the agent's trips; the same member verified does", async () => {
    const { agent, membership } = await legacyMembership("userB");
    const trip = await agentTrip(agent.id, "Rombongan Rahasia A03");
    const campaign = { organizationId: f.ids.orgA };

    const hidden = async () => {
      const list = await call("userB", "GET", "/api/trips");
      expect(list.status).toBe(200);
      expect(list.body.trips.map((t: Json) => t.id)).not.toContain(trip.id);
      expect((await call("userB", "GET", `/api/trips/${trip.id}`)).status).toBe(403);
      const overview = await call("userB", "GET", "/api/mobile/overview");
      expect(overview.body).toMatchObject({ isTravelAgent: false, tourismSummary: { activeTrips: 0 } });
      expect((await call("userB", "GET", "/api/user/dashboard")).body.isTravelAgent).toBe(false);
      expect((await call("userB", "GET", "/api/wallet")).body.isTravelAgent).toBe(false);
      const web = await page("userB", "/dashboard/user/trash-bag");
      expect(web.status).toBe(200);
      expect(web.html).not.toContain("Rombongan Rahasia A03");
      expect(await tripNotificationRecipients({ userId: null, travelAgentId: agent.id, campaign })).toEqual([]);
    };

    // Legacy membership (pre-A03 auto-link), email unverified.
    await hidden();
    let impact = await travelAgentAccessImpact();
    expect(impact.rows).toEqual([expect.objectContaining({
      membershipId: membership.id, userId: f.ids.userB, travelAgentId: agent.id, reason: "MEMBERSHIP_UNVERIFIED",
      tripsLosingAccess: 1, invitedOrganizations: [{ organizationId: f.ids.orgA, organizationName: "Organisasi Audit A" }],
    })]);
    expect(JSON.stringify(impact)).not.toContain(emailOf("userB"));

    // A verified membership is not enough while the account email is unverified.
    await f.db.travelAgentUser.update({ where: { id: membership.id }, data: { verifiedAt: new Date() } });
    await hidden();
    impact = await travelAgentAccessImpact();
    expect(impact.rows.map((r) => [r.membershipId, r.reason])).toEqual([[membership.id, "EMAIL_UNVERIFIED"]]);

    // Positive control: both verified, everything shows the trip.
    await f.db.user.update({ where: { id: f.ids.userB }, data: { emailVerifiedAt: new Date() } });
    const list = await call("userB", "GET", "/api/trips");
    expect(list.body.trips.map((t: Json) => t.id)).toContain(trip.id);
    expect((await call("userB", "GET", `/api/trips/${trip.id}`)).status).toBe(200);
    expect((await call("userB", "GET", "/api/mobile/overview")).body).toMatchObject({ isTravelAgent: true, tourismSummary: { activeTrips: 1 } });
    expect((await call("userB", "GET", "/api/wallet")).body.isTravelAgent).toBe(true);
    expect((await page("userB", "/dashboard/user/trash-bag")).html).toContain("Rombongan Rahasia A03");
    expect(await tripNotificationRecipients({ userId: null, travelAgentId: agent.id, campaign })).toEqual([f.ids.userB]);
    expect((await travelAgentAccessImpact()).rows).toEqual([]);
  });

  it("a legacy member regains access only through a re-sent invitation accepted from the invited mailbox", async () => {
    const { agent, membership } = await legacyMembership("userB", emailOf("userB"));
    const trip = await agentTrip(agent.id, "Rombongan Lama");
    expect((await call("userB", "GET", "/api/trips")).body.trips).toEqual([]);

    const resent = await call("adminA", "POST", `/api/travel-agents/${agent.id}/invitations`, {});
    expect(resent.status).toBe(202);
    expect(resent.body.invite).toMatchObject({ email: emailOf("userB"), acceptedAt: null });
    expect(JSON.stringify(resent.body)).not.toMatch(/tokenHash/);
    const [mail] = await mailsTo(emailOf("userB"), INVITE_SUBJECT);
    const first = tokenIn(mail, "/accept-invitation");

    // A second resend rotates the token: the first link stops working.
    expect((await call("adminA", "POST", `/api/travel-agents/${agent.id}/invitations`, {})).status).toBe(202);
    const second = tokenIn((await mailsTo(emailOf("userB"), INVITE_SUBJECT, 2))[1], "/accept-invitation");
    expect(second).not.toBe(first);
    expect((await call("userB", "POST", ACCEPT, { token: first })).status).toBe(400);
    // Another organization's admin cannot resend it.
    expect((await call("adminB", "POST", `/api/travel-agents/${agent.id}/invitations`, {})).status).toBe(404);

    expect((await call("userB", "POST", ACCEPT, { token: second })).status).toBe(200);
    const after = await f.db.travelAgentUser.findUniqueOrThrow({ where: { id: membership.id } });
    expect(after.verifiedAt).toBeInstanceOf(Date);
    expect((await call("userB", "GET", "/api/trips")).body.trips.map((t: Json) => t.id)).toEqual([trip.id]);
  });
});

describe("re-inviting an existing agent", () => {
  it("keeps an INVITED agent's verified members' access, and returns a suspended agent to PENDING until accepted", async () => {
    const { agent } = await legacyMembership("userB", emailOf("userB"));
    await f.db.travelAgentUser.updateMany({ where: { travelAgentId: agent.id }, data: { verifiedAt: new Date() } });
    await f.db.user.update({ where: { id: f.ids.userB }, data: { emailVerifiedAt: new Date() } });
    const trip = await agentTrip(agent.id, "Rombongan Tetap");
    const visible = async () => (await call("userB", "GET", "/api/trips")).body.trips.map((t: Json) => t.id).includes(trip.id);
    expect(await visible()).toBe(true);

    const again = await call("adminA", "POST", "/api/travel-agents", { name: agent.name, email: emailOf("userB") });
    expect(again.status).toBe(201);
    expect(again.body.organizationStatus).toBe("INVITED");
    expect(await visible()).toBe(true);

    expect((await call("adminA", "PATCH", `/api/travel-agents/${agent.id}`, { organizationStatus: "SUSPENDED" })).status).toBe(200);
    expect(await visible()).toBe(false);
    const reinvite = await call("adminA", "POST", "/api/travel-agents", { name: agent.name, email: emailOf("userB") });
    expect(reinvite.body.organizationStatus).toBe("PENDING");
    expect(await visible()).toBe(false);

    const token = tokenIn((await mailsTo(emailOf("userB"), INVITE_SUBJECT, 2))[1], "/accept-invitation");
    expect((await call("userB", "POST", ACCEPT, { token })).status).toBe(200);
    expect((await f.db.travelAgentOrganization.findFirstOrThrow({ where: { travelAgentId: agent.id } })).status).toBe("INVITED");
    expect(await visible()).toBe(true);
  });
});

describe("email changes and email verification", () => {
  it("an email change between issue and accept refuses the claim", async () => {
    const invite = await f.pendingInvite(emailOf("userA"));
    const changed = await call("userA", "PATCH", "/api/auth/me", {
      email: "usera-baru@example.test", currentPassword: f.credentials("userA").password,
    });
    expect(changed.status).toBe(200);

    const res = await call("userA", "POST", ACCEPT, { token: invite.token });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe(INVITE_EMAIL_MISMATCH);
    expect(await memberships(invite.travelAgentId)).toEqual([]);
    expect((await f.db.travelAgentInvite.findUniqueOrThrow({ where: { id: invite.id } })).acceptedAt).toBeNull();
  });

  it("an email change clears the verified email and membership until the account verifies again", async () => {
    const invite = await f.pendingInvite(emailOf("userA"));
    expect((await call("userA", "POST", ACCEPT, { token: invite.token })).status).toBe(200);
    const trip = await agentTrip(invite.travelAgentId, "Rombongan Sebelum Ganti Email");
    expect((await call("userA", "GET", "/api/trips")).body.trips.map((t: Json) => t.id)).toContain(trip.id);

    const newEmail = "usera-pindah@example.test";
    const changed = await call("userA", "PATCH", "/api/auth/me", { email: newEmail, currentPassword: f.credentials("userA").password });
    expect(changed.status).toBe(200);
    const user = await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } });
    expect(user.emailVerifiedAt).toBeNull();
    expect((await memberships(invite.travelAgentId))[0].verifiedAt).toBeNull();
    expect((await call("userA", "GET", "/api/trips")).body.trips.map((t: Json) => t.id)).not.toContain(trip.id);
    expect((await call("userA", "GET", `/api/trips/${trip.id}`)).status).toBe(403);

    // A verification mail goes to the new address only.
    const [mail] = await mailsTo(newEmail, VERIFY_SUBJECT);
    expect((await f.capturedTransport("mail")).filter((m) => m.kind === "mail" && m.to === emailOf("userA") && VERIFY_SUBJECT.test(m.subject))).toEqual([]);
    const token = tokenIn(mail, "/verify-email");
    expect((await call("userA", "POST", VERIFY, { token })).status).toBe(200);
    expect((await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } })).emailVerifiedAt).toBeInstanceOf(Date);
    // A verified new address does not bring the membership back: that needs a fresh invitation.
    expect((await call("userA", "GET", "/api/trips")).body.trips.map((t: Json) => t.id)).not.toContain(trip.id);
  });

  it("registration mails a verification link; only that account can use it, once, before it expires or the email changes", async () => {
    const address = "nova@example.test";
    const nova = await register(address, "Nova");
    expect(nova.body).toMatchObject({ user: { emailVerified: false }, emailVerificationQueued: true });
    const [mail] = await mailsTo(address, VERIFY_SUBJECT);
    const token = tokenIn(mail, "/verify-email");
    const row = await f.db.emailVerificationToken.findUniqueOrThrow({ where: { tokenHash: hashEmailVerificationToken(token) } });
    expect(row).toMatchObject({ userId: nova.id, purpose: "VERIFY_EMAIL", emailLookup: emailLookupHash(address), consumedAt: null });
    expect(await f.db.emailOutbox.findMany({ where: { userId: nova.id }, select: { kind: true, status: true } }))
      .toEqual([{ kind: "EMAIL_VERIFICATION", status: "SENT" }]);

    expect((await call("userB", "POST", VERIFY, { token })).status).toBe(400);
    expect((await callWith(nova.session, "POST", VERIFY, { token, email: address })).status).toBe(422);
    expect((await callWith(nova.session, "GET", "/api/auth/me")).body.user.emailVerified).toBe(false);
    expect((await callWith(nova.session, "POST", VERIFY, { token })).status).toBe(200);
    expect((await callWith(nova.session, "GET", "/api/auth/me")).body.user.emailVerified).toBe(true);
    expect((await callWith(nova.session, "POST", VERIFY, { token })).status).toBe(409);

    // Expired: a resent link for userA, aged past its expiry.
    const resend = await call("userA", "POST", RESEND);
    expect(resend.status).toBe(202);
    const expiredToken = tokenIn((await mailsTo(emailOf("userA"), VERIFY_SUBJECT))[0], "/verify-email");
    await f.db.emailVerificationToken.update({
      where: { tokenHash: hashEmailVerificationToken(expiredToken) }, data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect((await call("userA", "POST", VERIFY, { token: expiredToken })).status).toBe(410);

    // Issued before an email change: refused afterwards.
    expect((await call("userA", "POST", RESEND)).status).toBe(202);
    const beforeChange = tokenIn((await mailsTo(emailOf("userA"), VERIFY_SUBJECT, 2))[1], "/verify-email");
    expect((await call("userA", "PATCH", "/api/auth/me", { email: "usera-lain@example.test", currentPassword: f.credentials("userA").password })).status).toBe(200);
    expect((await call("userA", "POST", VERIFY, { token: beforeChange })).status).not.toBe(200);
    expect((await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } })).emailVerifiedAt).toBeNull();
  });
});

describe("durable mail outbox", () => {
  it("a failed delivery is retried by the runner with a new token; the raw token is never stored", async () => {
    const agent = await f.db.travelAgent.create({ data: { name: "Agen Outbox", email: emailOf("userA") } });
    await f.db.travelAgentOrganization.create({ data: { travelAgentId: agent.id, organizationId: f.ids.orgA, status: "PENDING" } });
    const issued = await f.db.$transaction((tx) => issueTravelAgentInvite(tx, {
      travelAgentId: agent.id, organizationId: f.ids.orgA, email: emailOf("userA"), invitedById: f.ids.adminA,
    }));

    const failed = await deliverEmailOutbox(issued.outboxId, { hooks: { beforeSend: async () => { throw new InjectedFault("SMTP_DOWN"); } } });
    expect(failed).toMatchObject({ outcome: "RETRY", code: "InjectedFault" });
    const row = await f.db.emailOutbox.findUniqueOrThrow({ where: { id: issued.outboxId } });
    expect(row).toMatchObject({ status: "PENDING", attempts: 1, lastError: "InjectedFault", leaseUntil: null });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(await f.capturedTransport("mail")).toEqual([]);
    const undeliveredHash = (await f.db.travelAgentInvite.findUniqueOrThrow({ where: { id: issued.inviteId } })).tokenHash;
    expect(undeliveredHash).toMatch(/^[0-9a-f]{64}$/);

    // Not due during the backoff; due afterwards.
    expect((await processDueEmailOutbox()).map((r) => r.id)).not.toContain(issued.outboxId);
    const pass = await processDueEmailOutbox({ now: new Date(Date.now() + 5 * 60_000) });
    expect(pass).toEqual([{ id: issued.outboxId, kind: "TRAVEL_AGENT_INVITE", outcome: "SENT" }]);
    const token = tokenIn((await mailsTo(emailOf("userA"), INVITE_SUBJECT))[0], "/accept-invitation");
    const minted = await f.db.travelAgentInvite.findUniqueOrThrow({ where: { id: issued.inviteId } });
    expect(minted.tokenHash).toBe(hashInviteToken(token));
    expect(minted.tokenHash).not.toBe(undeliveredHash);
    expect(await f.db.emailOutbox.findUniqueOrThrow({ where: { id: issued.outboxId } }))
      .toMatchObject({ status: "SENT", attempts: 2, lastError: null });

    expect(await persistedText()).not.toContain(token);
    expect((await call("userA", "POST", ACCEPT, { token })).status).toBe(200);
    expect(await persistedText()).not.toContain(token);
    // A delivered row is never sent again.
    expect(await deliverEmailOutbox(issued.outboxId)).toMatchObject({ outcome: "NOT_DUE" });
  });

  it("a queued verification is cancelled, not sent, when the address changed before delivery", async () => {
    const user = await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userA } });
    const outboxId = await f.db.$transaction((tx) => enqueueEmailVerification(tx, f.ids.userA, user.emailLookup));
    await f.db.user.update({ where: { id: f.ids.userA }, data: { email: "usera-sebelum-kirim@example.test" } });
    expect(await deliverEmailOutbox(outboxId)).toMatchObject({ outcome: "CANCELLED", code: "EMAIL_CHANGED" });
    expect(await f.capturedTransport("mail")).toEqual([]);
    expect(await f.db.emailVerificationToken.count({ where: { userId: f.ids.userA } })).toBe(0);
  });

  it("the runner script delivers what is due, reports ids only, and refuses bad arguments", async () => {
    const user = await f.db.user.findUniqueOrThrow({ where: { id: f.ids.userB } });
    // Queued, but the after-response attempt never ran (e.g. the server restarted).
    const outboxId = await f.db.$transaction((tx) => enqueueEmailVerification(tx, f.ids.userB, user.emailLookup));
    const root = path.resolve(__dirname, "../..");
    const run = (args: string[]) => spawnSync(path.join(root, "node_modules/.bin/tsx"), ["scripts/process-email-outbox.ts", ...args],
      { cwd: root, env: process.env, encoding: "utf8", timeout: 90_000 });

    const pass = run([]);
    expect(pass.status).toBe(0);
    const output = JSON.parse(pass.stdout) as Json;
    expect(output).toMatchObject({ results: [{ id: outboxId, kind: "EMAIL_VERIFICATION", outcome: "SENT" }], failing: 0, deadLetters: 0 });
    const [mail] = await mailsTo(emailOf("userB"), VERIFY_SUBJECT);
    const token = tokenIn(mail, "/verify-email");
    expect(`${pass.stdout}${pass.stderr}`).not.toContain(token);
    expect(pass.stdout).not.toContain(emailOf("userB"));
    expect((await call("userB", "POST", VERIFY, { token })).status).toBe(200);

    expect(run(["--email", emailOf("userB")]).status).toBe(2);
  });
});

describe("token hygiene", () => {
  it("tokens never reach server logs, audit rows, query strings or Referer; token pages are noindex", async () => {
    const logFile = nextLogPath();
    const offset = statSync(logFile).size;
    const tokens = new Set<string>();

    const invited = await call("adminA", "POST", "/api/travel-agents", { name: "Agen Higiene", email: emailOf("userA") });
    expect(invited.status).toBe(201);
    const inviteToken = tokenIn((await mailsTo(emailOf("userA"), INVITE_SUBJECT))[0], "/accept-invitation");
    tokens.add(inviteToken);
    expect((await call("userB", "POST", ACCEPT, { token: inviteToken })).status).toBe(403);
    expect((await call("userA", "POST", ACCEPT, { token: inviteToken })).status).toBe(200);
    expect((await call("userA", "POST", ACCEPT, { token: inviteToken })).status).toBe(409);

    const nova = await register("higiene@example.test", "Higiene");
    const verifyToken = tokenIn((await mailsTo("higiene@example.test", VERIFY_SUBJECT))[0], "/verify-email");
    tokens.add(verifyToken);
    expect((await callWith(nova.session, "POST", VERIFY, { token: verifyToken })).status).toBe(200);
    expect((await callWith(nova.session, "POST", VERIFY, { token: verifyToken })).status).toBe(409);
    const fixtureInvite = await f.pendingInvite(emailOf("userB"));
    tokens.add(fixtureInvite.token);
    expect((await call("userA", "POST", ACCEPT, { token: fixtureInvite.token })).status).toBe(403);

    for (const [route, kind] of [["/accept-invitation", "accept-invitation"], ["/verify-email", "verify-email"]] as const) {
      const res = await page("guest", route);
      expect(res.status).toBe(200);
      expect(res.response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(res.response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(res.response.headers.get("cache-control")).toBe("no-store");
      expect(res.html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
      expect(res.html).toMatch(/<meta name="referrer" content="no-referrer"/);
      // The capture script runs with the page's CSP nonce and strips the fragment.
      const nonce = /'nonce-([^']+)'/.exec(res.response.headers.get("content-security-policy") ?? "")?.[1];
      expect(nonce).toBeTruthy();
      expect(res.html).toContain(`<script nonce="${nonce}">`);
      expect(res.html).toContain(`reloop:link-token:${kind}`);
      expect(res.html).toContain("replaceState");
      // No third-party resource on the page at all.
      const external = [...res.html.matchAll(/\b(?:src|href)="(https?:)?\/\/([^/"]+)/g)]
        .map((m) => m[2]).filter((host) => host !== new URL(process.env.AUDIT_BASE_URL!).host);
      expect(external).toEqual([]);
    }

    const audit = JSON.stringify(await f.db.auditLog.findMany());
    expect(audit).toContain("TRAVEL_AGENT_INVITE_ACCEPTED");
    expect(audit).toContain("EMAIL_VERIFIED");
    await sleep(500); // let the runner flush the Next log
    const serverLog = readFileSync(logFile).subarray(offset).toString("utf8");
    expect(serverLog.length).toBeGreaterThan(0);
    const persisted = await persistedText();
    for (const token of tokens) {
      expect(serverLog).not.toContain(token);
      expect(audit).not.toContain(token);
      expect(persisted).not.toContain(token);
    }
  });
});
