import { describe, expect, it, beforeEach, afterEach } from "vitest";
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

describe("JWT Secrets and Signing", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws in production if AUTH_JWT_SECRET is missing or default", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.AUTH_JWT_SECRET = "dev-insecure-secret-change-me";
    
    const { signSession } = await import("@/lib/auth");
    await expect(signSession({
      sub: "1", email: "a@a.com", name: "A", role: "USER", organizationId: null, tokenVersion: 1
    })).rejects.toThrow("AUTH_JWT_SECRET must be set in production");
  });

  it("uses provided AUTH_JWT_SECRET to sign and verify", async () => {
    process.env.AUTH_JWT_SECRET = "my-super-secret-key-that-is-long-enough";
    const { signSession, verifySessionToken } = await import("@/lib/auth");
    
    const token = await signSession({
      sub: "1", email: "a@a.com", name: "A", role: "USER", organizationId: null, tokenVersion: 1
    });
    const payload = await verifySessionToken(token);
    expect(payload?.sub).toBe("1");
  });
});
