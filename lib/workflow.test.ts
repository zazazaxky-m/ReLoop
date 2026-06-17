import { describe, expect, it } from "vitest";
import {
  resolvePartnershipTransition,
  type PartnershipContext,
} from "@/lib/partnership";
import { resolvePickupTransition, type PickupContext } from "@/lib/pickup";

const collectorCtx = (status: PartnershipContext["status"]): PartnershipContext => ({
  status,
  role: "PENGEPUL",
  isCollector: true,
  isOrgAdmin: false,
});
const adminCtx = (status: PartnershipContext["status"]): PartnershipContext => ({
  status,
  role: "ADMIN",
  isCollector: false,
  isOrgAdmin: true,
});
const superCtx = (status: PartnershipContext["status"]): PartnershipContext => ({
  status,
  role: "SUPERADMIN",
  isCollector: false,
  isOrgAdmin: false,
});

describe("partnership lifecycle", () => {
  it("collector accepts an invite -> pending superadmin approval", () => {
    const r = resolvePartnershipTransition("accept", collectorCtx("INVITED"));
    expect(r.ok).toBe(true);
    expect(r.to).toBe("PENDING_SUPERADMIN_APPROVAL");
  });

  it("admin accepts a collector request -> pending superadmin approval", () => {
    const r = resolvePartnershipTransition("accept", adminCtx("REQUESTED"));
    expect(r.to).toBe("PENDING_SUPERADMIN_APPROVAL");
  });

  it("only superadmin can approve to ACTIVE", () => {
    expect(resolvePartnershipTransition("approve", superCtx("PENDING_SUPERADMIN_APPROVAL")).to).toBe(
      "ACTIVE",
    );
    expect(resolvePartnershipTransition("approve", adminCtx("PENDING_SUPERADMIN_APPROVAL")).ok).toBe(
      false,
    );
    expect(
      resolvePartnershipTransition("approve", collectorCtx("PENDING_SUPERADMIN_APPROVAL")).ok,
    ).toBe(false);
  });

  it("collector cannot self-approve from invited", () => {
    expect(resolvePartnershipTransition("approve", collectorCtx("INVITED")).ok).toBe(false);
  });

  it("admin suspends and reactivates an active partnership", () => {
    expect(resolvePartnershipTransition("suspend", adminCtx("ACTIVE")).to).toBe("SUSPENDED");
    expect(resolvePartnershipTransition("reactivate", adminCtx("SUSPENDED")).to).toBe("ACTIVE");
  });

  it("non-owner admin cannot suspend", () => {
    const r = resolvePartnershipTransition("suspend", {
      status: "ACTIVE",
      role: "ADMIN",
      isCollector: false,
      isOrgAdmin: false,
    });
    expect(r.ok).toBe(false);
  });
});

const pAdmin = (status: PickupContext["status"]): PickupContext => ({
  status,
  role: "ADMIN",
  isAssignedCollector: false,
  isOrgAdmin: true,
});
const pCollector = (status: PickupContext["status"]): PickupContext => ({
  status,
  role: "PENGEPUL",
  isAssignedCollector: true,
  isOrgAdmin: false,
});

describe("pickup lifecycle", () => {
  it("admin assigns a requested pickup", () => {
    expect(resolvePickupTransition("assign", pAdmin("REQUESTED")).to).toBe("ASSIGNED");
  });

  it("collector cannot assign", () => {
    expect(resolvePickupTransition("assign", pCollector("REQUESTED")).ok).toBe(false);
  });

  it("walks the full collector field flow", () => {
    expect(resolvePickupTransition("start", pCollector("ASSIGNED")).to).toBe("ON_THE_WAY");
    expect(resolvePickupTransition("arrive", pCollector("ON_THE_WAY")).to).toBe("ARRIVED");
    expect(resolvePickupTransition("collect", pCollector("ARRIVED")).to).toBe("COLLECTED");
    expect(resolvePickupTransition("complete", pCollector("COLLECTED")).to).toBe("COMPLETED");
  });

  it("unassigned collector cannot drive status", () => {
    const r = resolvePickupTransition("start", {
      status: "ASSIGNED",
      role: "PENGEPUL",
      isAssignedCollector: false,
      isOrgAdmin: false,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects illegal transitions", () => {
    expect(resolvePickupTransition("complete", pCollector("ASSIGNED")).ok).toBe(false);
    expect(resolvePickupTransition("arrive", pCollector("REQUESTED")).ok).toBe(false);
  });

  it("admin can cancel before collection only", () => {
    expect(resolvePickupTransition("cancel", pAdmin("ASSIGNED")).to).toBe("CANCELLED");
    expect(resolvePickupTransition("cancel", pAdmin("COLLECTED")).ok).toBe(false);
  });
});
