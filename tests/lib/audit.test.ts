import { describe, expect, it } from "vitest";
import { redactAuditMetadata } from "@/lib/audit";

describe("redactAuditMetadata", () => {
  it("redacts sensitive keys at top level", () => {
    const result = redactAuditMetadata({
      token: "secret-token",
      machineCode: "RVM-001",
    });
    expect(result?.token).toBe("[REDACTED]");
    expect(result?.machineCode).toBe("RVM-001");
  });

  it("redacts nested sensitive keys", () => {
    const result = redactAuditMetadata({
      payload: { accountIdentifier: "08123456789", amount: 10000 },
    });
    expect(result?.payload).toEqual({
      accountIdentifier: "[REDACTED]",
      amount: 10000,
    });
  });
});
