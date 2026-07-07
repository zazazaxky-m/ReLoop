import { describe, expect, it } from "vitest";
import { passwordSchema, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";

describe("passwordSchema", () => {
  it(`requires at least ${PASSWORD_MIN_LENGTH} characters`, () => {
    expect(passwordSchema.safeParse("short").success).toBe(false);
    expect(passwordSchema.safeParse("a".repeat(PASSWORD_MIN_LENGTH)).success).toBe(
      true,
    );
  });
});
