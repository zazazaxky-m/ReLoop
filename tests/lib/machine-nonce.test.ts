import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { consumeMachineNonce } from "@/lib/machine-nonce";

const originalEnv = { ...process.env };

function resetNonceStore() {
  delete (globalThis as typeof globalThis & { __reloopNonceStore?: unknown })
    .__reloopNonceStore;
}

vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      private store = new Map<string, string>();
      private handlers: Record<string, Array<(err: Error) => void>> = {};

      constructor(url: string) {
        if (url.includes('import-error')) {
          throw new Error('import failed');
        }
        if (url.includes('error')) {
          setTimeout(() => {
            if (this.handlers['error']) {
              this.handlers['error'].forEach(fn => fn(new Error('connection failed')));
            }
          }, 10);
        }
      }

      on(event: string, fn: (err: Error) => void) {
        if (!this.handlers[event]) this.handlers[event] = [];
        this.handlers[event].push(fn);
      }

      async set(key: string, value: string, _px: string, _ttl: number, _nx: string) {
        if (key.includes('throw')) throw new Error('set failed');
        if (this.store.has(key)) return null;
        this.store.set(key, value);
        return 'OK';
      }
    }
  };
});

describe("machine nonce store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
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

  it("expires stale memory nonces via cleanup interval", async () => {
    vi.useFakeTimers();
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    delete process.env.REDIS_URL;
    resetNonceStore();

    expect(await consumeMachineNonce("m1", "n-expire")).toBe(true);
    expect(await consumeMachineNonce("m1", "n-expire")).toBe(false);

    await vi.advanceTimersByTimeAsync(400_000);
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

  it("uses redis when REDIS_URL is present", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    process.env.REDIS_URL = "redis://localhost:6379";
    resetNonceStore();

    expect(await consumeMachineNonce("m1", "n_redis")).toBe(true);
    expect(await consumeMachineNonce("m1", "n_redis")).toBe(false);
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
