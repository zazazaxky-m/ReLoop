import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("rate-limit", () => {
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
    let result = await mod.checkRateLimit("test-key", 2, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(1);
    
    result = await mod.checkRateLimit("test-key", 2, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);

    result = await mod.checkRateLimit("test-key", 2, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("cleans expired memory rate-limit entries on interval", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "development");
    Reflect.deleteProperty(process.env, "REDIS_URL");

    const mod = await import("@/lib/rate-limit");
    const first = await mod.checkRateLimit("cleanup-key", 1, 1_000);
    expect(first.allowed).toBe(true);

    await vi.advanceTimersByTimeAsync(61_000);
    const second = await mod.checkRateLimit("cleanup-key", 1, 1_000);
    expect(second.allowed).toBe(true);
    expect(second.remaining).toBe(0);
    vi.useRealTimers();
  });

  it("Redis fail-closed in production when connection fails", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.REDIS_URL = "redis://localhost:6379";

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

  it("Redis uses memory fallback in development when connection fails", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.REDIS_URL = "redis://localhost:6379";

    vi.doMock("ioredis", () => ({
      default: class Redis {
        constructor() {
          throw new Error("connection refused");
        }
      },
    }));

    const mod = await import("@/lib/rate-limit");
    const result = await mod.checkRateLimit("scan:u1", 20, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(19);
  });

  it("Redis check works", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.REDIS_URL = "redis://localhost:6379";

    const incrMock = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    const pexpireMock = vi.fn().mockResolvedValue(1);
    const pttlMock = vi.fn().mockResolvedValue(59000);

    vi.doMock("ioredis", () => ({
      default: class Redis {
        on = vi.fn();
        incr = incrMock;
        pexpire = pexpireMock;
        pttl = pttlMock;
      },
    }));

    const mod = await import("@/lib/rate-limit");
    const result = await mod.checkRateLimit("scan:u1", 1, 60_000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
    expect(pexpireMock).toHaveBeenCalledWith("scan:u1", 60_000);

    const result2 = await mod.checkRateLimit("scan:u1", 1, 60_000);
    expect(result2.allowed).toBe(false);
  });

  it("Redis check uses windowMs if ttl is negative", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.REDIS_URL = "redis://localhost:6379";

    const incrMock = vi.fn().mockResolvedValue(1);
    const pexpireMock = vi.fn().mockResolvedValue(1);
    const pttlMock = vi.fn().mockResolvedValue(-1);

    vi.doMock("ioredis", () => ({
      default: class Redis {
        on = vi.fn();
        incr = incrMock;
        pexpire = pexpireMock;
        pttl = pttlMock;
      },
    }));

    const mod = await import("@/lib/rate-limit");
    const result = await mod.checkRateLimit("scan:u2", 1, 60_000);
    expect(result.allowed).toBe(true);
    // Date.now() is variable, but resetAt should be roughly Date.now() + 60_000
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });

  it("Redis check fail-closed in production if check throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.REDIS_URL = "redis://localhost:6379";

    vi.doMock("ioredis", () => ({
      default: class Redis {
        on = vi.fn();
        incr = vi.fn().mockRejectedValue(new Error("Network Error"));
      },
    }));

    const mod = await import("@/lib/rate-limit");
    const result = await mod.checkRateLimit("scan:u1", 1, 60_000);
    expect(result.allowed).toBe(false);
  });

  it("Redis check falls back to memory in development if check throws", async () => {
    vi.stubEnv("NODE_ENV", "development");
    process.env.REDIS_URL = "redis://localhost:6379";

    vi.doMock("ioredis", () => ({
      default: class Redis {
        on = vi.fn();
        incr = vi.fn().mockRejectedValue(new Error("Network Error"));
      },
    }));

    const mod = await import("@/lib/rate-limit");
    const result = await mod.checkRateLimit("scan:u1", 1, 60_000);
    expect(result.allowed).toBe(true);
  });

  it("Redis client on error sets unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.REDIS_URL = "redis://localhost:6379";

    let errorHandler: any;
    vi.doMock("ioredis", () => ({
      default: class Redis {
        on(evt: string, cb: any) {
          if (evt === 'error') errorHandler = cb;
        }
        incr = vi.fn();
      },
    }));

    const mod = await import("@/lib/rate-limit");
    
    // first trigger connect
    const connectPromise = mod.checkRateLimit("scan:u1", 1, 60_000);
    // wait a tick so ioredis mock is instantiated
    await new Promise(r => setTimeout(r, 0));
    // simulate error
    if (errorHandler) errorHandler(new Error('fail'));
    
    await connectPromise.catch(() => {});
    
    // next call should use fallback or fail closed because client is null
    const result = await mod.checkRateLimit("scan:u1", 1, 60_000);
    expect(result.allowed).toBe(false); // fail closed in prod
  });
});
