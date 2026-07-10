import { describe, expect, it } from "vitest";
import { resolvePartnershipTransition, isPartnershipActive, type PartnershipAction } from "@/lib/partnership";

describe("partnership transitions", () => {
  it("allows admin to accept REQUESTED", () => {
    const res = resolvePartnershipTransition("accept", {
      status: "REQUESTED",
      role: "ADMIN",
      isCollector: false,
      isOrgAdmin: true,
    });
    expect(res).toEqual({ ok: true, to: "PENDING_SUPERADMIN_APPROVAL" });
  });

  it("blocks admin from accepting INVITED", () => {
    const res = resolvePartnershipTransition("accept", {
      status: "INVITED",
      role: "ADMIN",
      isCollector: false,
      isOrgAdmin: true,
    });
    expect(res.ok).toBe(false);
  });

  it("allows collector to accept INVITED", () => {
    const res = resolvePartnershipTransition("accept", {
      status: "INVITED",
      role: "PENGEPUL",
      isCollector: true,
      isOrgAdmin: false,
    });
    expect(res).toEqual({ ok: true, to: "PENDING_SUPERADMIN_APPROVAL" });
  });

  it("fails if action is unknown", () => {
    const res = resolvePartnershipTransition("unknown_action" as PartnershipAction, {
      status: "ACTIVE",
      role: "ADMIN",
      isCollector: false,
      isOrgAdmin: true,
    });
    expect(res).toEqual({ ok: false, error: "Aksi tidak dikenal" });
  });

  it("allows superadmin to approve PENDING_SUPERADMIN_APPROVAL", () => {
    const res = resolvePartnershipTransition("approve", {
      status: "PENDING_SUPERADMIN_APPROVAL",
      role: "SUPERADMIN",
      isCollector: false,
      isOrgAdmin: false,
    });
    expect(res).toEqual({ ok: true, to: "ACTIVE" });
  });

  it("blocks admin who is not org admin", () => {
    const res = resolvePartnershipTransition("suspend", {
      status: "ACTIVE",
      role: "ADMIN",
      isCollector: false,
      isOrgAdmin: false,
    });
    expect(res.ok).toBe(false);
  });

  it("blocks collector who is not the partner", () => {
    const res = resolvePartnershipTransition("accept", {
      status: "INVITED",
      role: "PENGEPUL",
      isCollector: false,
      isOrgAdmin: false,
    });
    expect(res.ok).toBe(false);
  });

  it("isPartnershipActive", () => {
    expect(isPartnershipActive("ACTIVE")).toBe(true);
    expect(isPartnershipActive("SUSPENDED")).toBe(false);
  });
});
