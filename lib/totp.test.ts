import { describe, expect, it } from "vitest";
import {
  generateTotpCode,
  generateTotpSecret,
  verifyTotpCode,
} from "@/lib/totp";

describe("lib/totp", () => {
  it("generates and verifies a TOTP code", () => {
    const secret = generateTotpSecret();
    const code = generateTotpCode(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it("rejects invalid codes", () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, "000000")).toBe(false);
    expect(verifyTotpCode(secret, "abc")).toBe(false);
  });
});
