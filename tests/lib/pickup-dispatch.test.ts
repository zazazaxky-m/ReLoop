import { describe, expect, it } from "vitest";
import {
  DEADLINE_INVALID,
  PickupDispatchError,
  parseExpectedStartAt,
  requiresExpectedVersion,
  versionConflict,
  versionRequired,
} from "@/lib/pickup-dispatch";

describe("lib/pickup-dispatch input contract (B05)", () => {
  it("requires the operator's version for every decision that sets or closes ownership", () => {
    for (const role of ["PENGEPUL", "ADMIN", "SUPERADMIN"] as const) {
      expect(["assign", "cancel", "fail"].every((a) => requiresExpectedVersion(a as never, role))).toBe(true);
    }
  });

  it("keeps the version-less upgrade window for old collector apps only (PENGEPUL)", () => {
    const forward = ["start", "arrive", "collect", "complete"] as const;
    expect(forward.some((a) => requiresExpectedVersion(a, "PENGEPUL"))).toBe(false);
    expect(forward.every((a) => requiresExpectedVersion(a, "SUPERADMIN"))).toBe(true);
    expect(forward.every((a) => requiresExpectedVersion(a, "ADMIN"))).toBe(true);
  });

  it("uses the brief's Indonesian 409 and machine-readable codes", () => {
    expect(versionConflict()).toMatchObject({ status: 409, message: "Tugas telah diperbarui; muat ulang", code: "PICKUP_VERSION_CONFLICT" });
    expect(versionRequired()).toBeInstanceOf(PickupDispatchError);
    expect(versionRequired()).toMatchObject({ status: 409, code: "PICKUP_VERSION_REQUIRED" });
    expect(versionRequired().message).toMatch(/Muat ulang halaman atau perbarui aplikasi/);
  });

  it("accepts only a future operator deadline and invents none", () => {
    const now = new Date("2026-10-14T10:00:00Z");
    expect(parseExpectedStartAt(undefined, now)).toBeNull();
    expect(parseExpectedStartAt(null, now)).toBeNull();
    expect(parseExpectedStartAt("", now)).toBeNull();
    expect(parseExpectedStartAt("2026-10-14T18:00:00+07:00", now)).toEqual(new Date("2026-10-14T11:00:00Z"));
    for (const bad of ["2026-10-14T10:00:00Z", "2026-10-14T09:00:00Z", "2027-10-16T10:00:00Z", "besok", "2026-10-14 12:00"]) {
      expect(() => parseExpectedStartAt(bad, now)).toThrow(DEADLINE_INVALID);
    }
  });
});
