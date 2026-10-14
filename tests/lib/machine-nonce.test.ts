import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { MACHINE_NONCE_TTL_MS } from "@/lib/machine-auth-constants";
import { consumeMachineNonce, createRedisNonceStore } from "@/lib/machine-nonce";

const originalEnv = { ...process.env };

function resetNonceStore() {
  delete (globalThis as typeof globalThis & { __reloopNonceStore?: unknown })
    .__reloopNonceStore;
}

const redisCalls = vi.hoisted(() => ({ set: [] as unknown[][], disconnects: 0 }));

vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      private store = new Map<string, string>();
      private handlers: Record<string, Array<(err?: Error) => void>> = {};

      constructor(url: string) {
        if (url.includes('import-error')) {
          throw new Error('import failed');
        }
        if (url.includes('error') || url.includes('flap')) {
          setTimeout(() => {
            if (this.handlers['error']) {
              this.handlers['error'].forEach(fn => fn(new Error('connection failed')));
            }
          }, 10);
        }
        if (url.includes('flap')) {
          // ioredis reconnects on its own and emits "ready" again.
          setTimeout(() => {
            (this.handlers['ready'] ?? []).forEach(fn => fn());
          }, 30);
        }
      }

      on(event: string, fn: (err?: Error) => void) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(fn);
      }

      async set(key: string, value: string, px: string, ttl: number, nx: string) {
        redisCalls.set.push([key, value, px, ttl, nx]);
        if (key.includes('throw')) throw new Error('set failed');
        if (this.store.has(key)) return null;
        this.store.set(key, value);
        return 'OK';
      }

      disconnect() {
        redisCalls.disconnects += 1;
      }
    }
  };
});

describe("machine nonce store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisCalls.set.length = 0;
    redisCalls.disconnects = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env = { ...originalEnv };
    resetNonceStore();
  });

  it("uses memory replay protection outside production", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    delete process.env.REDIS_URL;
    resetNonceStore();

    expect(await consumeMachineNonce("m1", "n1")).toBe(true);
    expect(await consumeMachineNonce("m1", "n1")).toBe(false);
  });

  it("keeps a memory nonce for 2 * skew + 60 s, then expires it via the cleanup interval", async () => {
    vi.useFakeTimers();
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    delete process.env.REDIS_URL;
    resetNonceStore();

    expect(await consumeMachineNonce("m1", "n-expire")).toBe(true);
    expect(await consumeMachineNonce("m1", "n-expire")).toBe(false);

    // SEC-09: still a replay after the old 360 s TTL and at the end of the
    // 600 s signature window.
    await vi.advanceTimersByTimeAsync(361_000);
    expect(await consumeMachineNonce("m1", "n-expire")).toBe(false);
    await vi.advanceTimersByTimeAsync(600_000 - 361_000);
    expect(await consumeMachineNonce("m1", "n-expire")).toBe(false);

    await vi.advanceTimersByTimeAsync(MACHINE_NONCE_TTL_MS - 600_000 + 1);
    expect(await consumeMachineNonce("m1", "n-expire")).toBe(true);
    vi.useRealTimers();
  });

  it("fails closed in production when REDIS_URL is missing", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.REDIS_URL;
    resetNonceStore();

    await expect(consumeMachineNonce("m1", "n1")).rejects.toThrow(
      "REDIS_URL is required",
    );
  });

  it("uses redis when REDIS_URL is present, with an atomic SET NX and the 2 * skew + 60 s TTL", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.REDIS_URL = "redis://localhost:6379";
    resetNonceStore();

    expect(await consumeMachineNonce("m1", "n_redis")).toBe(true);
    expect(await consumeMachineNonce("m1", "n_redis")).toBe(false);
    expect(redisCalls.set).toEqual([
      ["machine-nonce:m1:n_redis", "1", "PX", 660_000, "NX"],
      ["machine-nonce:m1:n_redis", "1", "PX", 660_000, "NX"],
    ]);
  });

  it("recovers once Redis reconnects in production, and fails closed while it is down", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.REDIS_URL = "redis://flap:6379";
    resetNonceStore();

    expect(await consumeMachineNonce("m1", "n_before")).toBe(true);
    await new Promise(r => setTimeout(r, 15)); // "error": connection lost
    expect(await consumeMachineNonce("m1", "n_down")).toBe(false);
    await new Promise(r => setTimeout(r, 30)); // "ready": reconnected
    expect(await consumeMachineNonce("m1", "n_after")).toBe(true);
    expect(await consumeMachineNonce("m1", "n_after")).toBe(false);
  });

  it("builds independent Redis stores for one Redis URL (one per app instance)", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    const a = createRedisNonceStore("redis://localhost:6379");
    const b = createRedisNonceStore("redis://localhost:6379");
    expect(await a.consume("m1", "n_store")).toBe(true);
    expect(await a.consume("m1", "n_store")).toBe(false);
    // The mock has no shared server: b only proves it is its own client.
    expect(await b.consume("m1", "n_store")).toBe(true);
    await a.close();
    await b.close();
    expect(redisCalls.disconnects).toBe(2);
    expect(redisCalls.set.every((call) => call[3] === MACHINE_NONCE_TTL_MS)).toBe(true);
  });

  it("falls back to memory store if not in production and redis connection fails", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.REDIS_URL = "redis://error:6379";
    resetNonceStore();

    // Trigger error handler
    await consumeMachineNonce("m1", "n_dev"); 
    
    // Wait for the simulated async error to fire
    await new Promise(r => setTimeout(r, 20));
    
    expect(await consumeMachineNonce("m1", "n_dev_fallback")).toBe(true);
    expect(await consumeMachineNonce("m1", "n_dev_fallback")).toBe(false);
  });

  it("fails closed in production if redis connection fails", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.REDIS_URL = "redis://error:6379";
    resetNonceStore();

    // Wait for the simulated async error to fire
    await consumeMachineNonce("m1", "n_prod").catch(() => {}); 
    await new Promise(r => setTimeout(r, 20));

    expect(await consumeMachineNonce("m1", "n_prod2")).toBe(false);
  });

  it("fails closed in production if redis set throws", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.REDIS_URL = "redis://localhost:6379";
    resetNonceStore();

    expect(await consumeMachineNonce("m1", "throw_nonce")).toBe(false);
  });

  it("falls back to memory if redis set throws in development", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.REDIS_URL = "redis://localhost:6379";
    resetNonceStore();

    expect(await consumeMachineNonce("m1", "throw_nonce")).toBe(true);
    expect(await consumeMachineNonce("m1", "throw_nonce")).toBe(false); // memory store deduplicates
  });

  it("handles ioredis import/instantiation errors gracefully", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    process.env.REDIS_URL = "redis://import-error:6379";
    resetNonceStore();

    expect(await consumeMachineNonce("m1", "n_import")).toBe(true);
  });

});
