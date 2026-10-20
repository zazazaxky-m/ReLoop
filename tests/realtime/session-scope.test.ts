import type { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { f } from "../support/audit-fixture";

const alert = (organizationId: string, eventType = "FRAUD_DETECTED") => ({
  topic: "security-alert" as const, organizationId, machineCode: f.ids.machineCode, eventType,
});
const machineState = () => ({
  topic: "machine-state" as const, machineCode: f.ids.machineCode, eventType: "REMOTE_COMMAND_COMPLETED",
});
const REVALIDATE_MS = 30_000;

describe("realtime session scope (R04)", () => {
  it("drops restricted delivery after expiry and across organizations",async()=>{
    const gateway=await f.gateway();
    const a=await gateway.connect("adminA",{ttlSeconds:1});
    const b=await gateway.connect("adminB");
    await gateway.advanceClock(2_000);
    await gateway.publish({topic:"security-alert",organizationId:f.ids.orgA,
      machineCode:f.ids.machineCode,eventType:"FRAUD"});
    expect(await a.receivedCount()).toBe(0);
    expect(await b.receivedCount()).toBe(0);
  });

  describe("expiry and revocation", () => {
    it("closes the socket at the exact session expiry; a new login reconnects normally", async () => {
      const gateway = await f.gateway();
      const admin = await gateway.connect("adminA", { ttlSeconds: 5 });

      await gateway.advanceClock(admin.expiresAt! * 1000 - gateway.now() - 250);
      await gateway.publish(alert(f.ids.orgA));
      expect(await admin.receivedCount()).toBe(1);
      expect(await admin.closed(100)).toBe(false);

      await gateway.advanceClock(500);
      expect(await admin.closed()).toBe(true);
      expect(admin.closeCode()).toBe(4401);
      await gateway.publish(alert(f.ids.orgA));
      expect(await admin.receivedCount()).toBe(1);

      const relogin = await gateway.connect("adminA");
      await gateway.publish(alert(f.ids.orgA));
      expect(await relogin.receivedCount()).toBe(1);
    });

    it.each([
      ["a suspended account", { status: "SUSPENDED" }, true],
      ["a tokenVersion change", { tokenVersion: { increment: 1 } }, true],
      ["a role downgrade", { role: "USER" }, false],
    ] as const)("stops restricted delivery within 30 s of %s", async (_case, change, closes) => {
      const gateway = await f.gateway();
      const admin = await gateway.connect("adminA");
      await gateway.publish(alert(f.ids.orgA));
      expect(await admin.receivedCount()).toBe(1);

      await f.db.user.update({ where: { id: f.ids.adminA }, data: change as Prisma.UserUpdateInput });
      await gateway.advanceClock(REVALIDATE_MS);

      // Revoked identities are closed; a downgrade only loses the capability.
      expect(await admin.closed(closes ? 1_000 : 200)).toBe(closes);
      if (closes) expect(admin.closeCode()).toBe(4403);
      await gateway.publish(alert(f.ids.orgA));
      expect(await admin.receivedCount()).toBe(1);
      if (!closes) {
        await gateway.publish(machineState());
        expect(await admin.receivedCount()).toBe(2);
      }
    });

    it("follows an organization move on the next revalidation", async () => {
      const gateway = await f.gateway();
      const admin = await gateway.connect("adminA");

      await f.db.user.update({ where: { id: f.ids.adminA }, data: { organizationId: f.ids.orgB } });
      await gateway.advanceClock(REVALIDATE_MS);
      await gateway.publish(alert(f.ids.orgA));
      await gateway.publish(alert(f.ids.orgB));

      expect((await admin.events()).map((event) => event.organizationId)).toEqual([f.ids.orgB]);
    });

    it("revalidates a privileged socket every 30 s and never an anonymous one", async () => {
      const gateway = await f.gateway();
      await gateway.connect("adminA");
      await gateway.connect("guest");
      const atConnect = gateway.verifierCalls();

      await gateway.advanceClock(REVALIDATE_MS - 1_000);
      expect(gateway.verifierCalls()).toBe(atConnect);
      await gateway.advanceClock(1_000);
      expect(gateway.verifierCalls()).toBe(atConnect + 1);
      await gateway.advanceClock(REVALIDATE_MS);
      expect(gateway.verifierCalls()).toBe(atConnect + 2);
    });
  });

  describe("organization scope and public schema", () => {
    it("keeps each admin to their organization while SUPERADMIN receives every alert", async () => {
      const gateway = await f.gateway();
      const adminA = await gateway.connect("adminA");
      const adminB = await gateway.connect("adminB");
      const superadmin = await gateway.connect("superadmin");
      const user = await gateway.connect("userA");

      await gateway.publish(alert(f.ids.orgA));
      await gateway.publish(alert(f.ids.orgB, "VANDALISM_DETECTED"));

      expect((await adminA.events()).map((event) => event.organizationId)).toEqual([f.ids.orgA]);
      expect((await adminB.events()).map((event) => event.organizationId)).toEqual([f.ids.orgB]);
      expect((await superadmin.events()).map((event) => event.organizationId)).toEqual([f.ids.orgA, f.ids.orgB]);
      expect(await user.receivedCount()).toBe(0);
    });

    it("rejects a security-alert without an organization instead of broadcasting it globally", async () => {
      const gateway = await f.gateway();
      const superadmin = await gateway.connect("superadmin");
      const { organizationId: _omitted, ...withoutOrg } = alert(f.ids.orgA);

      for (const event of [withoutOrg, { ...withoutOrg, organizationId: "" }, { ...withoutOrg, organizationId: null }]) {
        expect(await gateway.publishStatus(event)).toEqual({ status: 422, delivered: null });
      }
      expect(await gateway.publishStatus({ ...machineState(), topic: "billing" })).toEqual({ status: 422, delivered: null });
      expect(await superadmin.receivedCount()).toBe(0);
    });

    it("gives a guest only the public-safe machine schema", async () => {
      const gateway = await f.gateway();
      const guest = await gateway.connect("guest");
      const admin = await gateway.connect("adminA");

      await gateway.publish({
        ...machineState(),
        occurredAt: "2026-10-14T03:00:00.000Z",
        eventId: "cmd-1",
        organizationId: f.ids.orgA,
        userId: f.ids.userA,
        email: "usera@reloop-audit.test",
        phone: "08123456789",
        ownerId: f.ids.userA,
        amount: 25_000,
        refundAmount: 25_000,
        payload: { bankAccount: "1234567890" },
      });
      await gateway.publish(alert(f.ids.orgA));

      const expected = {
        topic: "machine-state", machineCode: f.ids.machineCode,
        eventType: "REMOTE_COMMAND_COMPLETED", occurredAt: "2026-10-14T03:00:00.000Z",
      };
      expect(await guest.events()).toEqual([expected]);
      // Public topics are the same whitelisted payload for every socket.
      expect((await admin.events())[0]).toEqual(expected);
    });
  });

  describe("verifier outages and anonymous sockets", () => {
    it("withholds restricted delivery while the verifier is unavailable and resumes once it validates again", async () => {
      const gateway = await f.gateway();
      const admin = await gateway.connect("adminA");

      gateway.setVerifierAvailable(false);
      await gateway.advanceClock(REVALIDATE_MS);
      expect(await admin.closed(200)).toBe(false);
      await gateway.publish(alert(f.ids.orgA));
      await gateway.publish(machineState());
      expect((await admin.events()).map((event) => event.topic)).toEqual(["machine-state"]);

      // Connecting during the outage grants no private role either.
      const late = await gateway.connect("adminB");
      await gateway.publish(alert(f.ids.orgB));
      expect(await late.receivedCount()).toBe(0);

      gateway.setVerifierAvailable(true);
      await gateway.publish(alert(f.ids.orgA));
      await gateway.publish(alert(f.ids.orgB));
      expect((await admin.events()).map((event) => event.topic)).toEqual(["machine-state", "security-alert"]);
      expect((await late.events()).map((event) => event.organizationId)).toEqual([f.ids.orgB]);
    });

    it("never promotes an anonymous socket from client frames", async () => {
      const gateway = await f.gateway();
      const guest = await gateway.connect("guest");
      const calls = gateway.verifierCalls();

      await guest.send(JSON.stringify({ type: "auth", token: await f.sessionCookie("superadmin") }));
      await guest.send(JSON.stringify({ role: "SUPERADMIN", organizationId: f.ids.orgA }));
      await gateway.advanceClock(REVALIDATE_MS);
      await gateway.publish(alert(f.ids.orgA));

      expect(await guest.receivedCount()).toBe(0);
      expect(gateway.verifierCalls()).toBe(calls);
    });
  });

  describe("lifecycle", () => {
    it("clears per-socket timers on disconnect and every timer on shutdown", async () => {
      const gateway = await f.gateway();
      const admin = await gateway.connect("adminA");
      const superadmin = await gateway.connect("superadmin");
      await gateway.connect("guest");

      const armed = await gateway.pendingTimers();
      admin.disconnect();
      await admin.closed();
      const afterDisconnect = await gateway.pendingTimers();
      expect(afterDisconnect).toBeLessThan(armed);

      expect(await gateway.shutdown()).toEqual({ pendingTimers: 0 });
      expect(await superadmin.closed()).toBe(true);
    });

    it("gives a reconnect fresh metadata instead of the old socket's", async () => {
      const gateway = await f.gateway();
      const first = await gateway.connect("adminA");
      await gateway.publish(alert(f.ids.orgA));
      expect(await first.receivedCount()).toBe(1);

      // Same cookie, live role changed without a tokenVersion bump.
      await f.db.user.update({ where: { id: f.ids.adminA }, data: { role: "USER" } });
      first.disconnect();
      const calls = gateway.verifierCalls();
      const second = await first.reconnect();
      expect(gateway.verifierCalls()).toBe(calls + 1);

      await gateway.publish(alert(f.ids.orgA));
      expect(await second.receivedCount()).toBe(0);
    });
  });
});
