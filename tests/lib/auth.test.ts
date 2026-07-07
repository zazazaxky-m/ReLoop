import { describe, expect, it } from "vitest";
import { sessionMaxAgeSeconds } from "@/lib/auth";

describe("sessionMaxAgeSeconds", () => {
  it("uses 24 hours for privileged roles", () => {
    expect(sessionMaxAgeSeconds("ADMIN")).toBe(60 * 60 * 24);
    expect(sessionMaxAgeSeconds("SUPERADMIN")).toBe(60 * 60 * 24);
  });

  it("uses 7 days for standard roles", () => {
    expect(sessionMaxAgeSeconds("USER")).toBe(60 * 60 * 24 * 7);
    expect(sessionMaxAgeSeconds("PENGEPUL")).toBe(60 * 60 * 24 * 7);
  });
});
