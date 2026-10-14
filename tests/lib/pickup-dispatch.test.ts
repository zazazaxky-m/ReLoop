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
    expect(["assign", "cancel", "fail"].every((a) => requiresExpectedVersion(a as never))).toBe(true);
    expect(["start", "arrive", "collect", "complete"].some((a) => requiresExpectedVersion(a as never))).toBe(false);
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
