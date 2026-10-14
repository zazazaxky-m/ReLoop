import { describe, expect, it } from "vitest";
import { f } from "../support/audit-fixture";

describe("realtime gateway harness", () => {
  it("delivers a private security alert to an authorized admin socket and never to a guest", async () => {
    const gateway = await f.gateway();
    const admin = await gateway.connect("adminA");
    const user = await gateway.connect("userA");
    const guest = await gateway.connect("guest");

    await gateway.publish({
      topic: "security-alert", organizationId: f.ids.orgA, machineCode: f.ids.machineCode, eventType: "FRAUD",
    });

    expect(await admin.receivedCount()).toBe(1);
    expect(await user.receivedCount()).toBe(0);
    expect(await guest.receivedCount()).toBe(0);
  });

  it("judges session expiry on the injected clock after the sockets connected", async () => {
    const gateway = await f.gateway();
    const current = await gateway.connect("superadmin", { ttlSeconds: 120 });
    const expiring = await gateway.connect("adminA", { ttlSeconds: 60 });

    // Both sockets were valid at connect; only the clock moves.
    await gateway.advanceClock(90_000);
    await gateway.publish({
      topic: "security-alert", organizationId: f.ids.orgA, machineCode: f.ids.machineCode, eventType: "VANDALISM",
    });

    expect(await current.receivedCount()).toBe(1);
    expect(await expiring.receivedCount()).toBe(0);
  });
});
