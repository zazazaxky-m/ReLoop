import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("rate-limit production guard", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = originalEnv;
  });

  it("denies when REDIS_URL is missing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    Reflect.deleteProperty(process.env, "REDIS_URL");

    const mod = await import("@/lib/rate-limit");
    const result = await mod.checkRateLimit("test-key", 5, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("allows memory store in development without REDIS_URL", async () => {
    vi.stubEnv("NODE_ENV", "development");
    Reflect.deleteProperty(process.env, "REDIS_URL");

    const mod = await import("@/lib/rate-limit");
    const result = await mod.checkRateLimit("test-key", 5, 60_000);
    expect(result.allowed).toBe(true);
  });
});

describe("rate-limit Redis fail-closed in production", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, NODE_ENV: "production", REDIS_URL: "redis://localhost:6379" };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    process.env = originalEnv;
  });

  it("denies requests when Redis connection fails", async () => {
    vi.doMock("ioredis", () => ({
      default: class Redis {
        constructor() {
          throw new Error("connection refused");
        }
      },
    }));

    const mod = await import("@/lib/rate-limit");
    const result = await mod.checkRateLimit("scan:u1", 20, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});
