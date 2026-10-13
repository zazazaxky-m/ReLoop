import { describe, expect, it } from "vitest";
import { accountEmailSchema, isReservedEmail } from "./account-email";

describe("account email", () => {
  it("reserves the erased-account domain, including the erased-<id> placeholder", () => {
    for (const email of ["erased-ckabc123@invalid.reloop", "X@INVALID.RELOOP", " a@sub.invalid.reloop ", "a@invalid.reloop"]) {
      expect(isReservedEmail(email)).toBe(true);
      expect(accountEmailSchema().safeParse(email.trim()).success).toBe(false);
    }
  });

  it("accepts ordinary addresses, including look-alike domains", () => {
    for (const email of ["user@example.com", "a@invalid.reloop.example.com", "a@notinvalid.reloop.id", "a@reloop.id"]) {
      expect(isReservedEmail(email)).toBe(false);
      expect(accountEmailSchema().safeParse(email).success).toBe(true);
    }
  });
});
