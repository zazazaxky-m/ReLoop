import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const redis = vi.hoisted(() => ({ available: true, entries: new Map<string, number>() }));
vi.mock("ioredis", () => ({ default: class Redis {
  on() { return this; }
  async connect() { if (!redis.available) throw new Error("offline"); }
  disconnect() {}
  async set(key: string, value: string, expiryMode: string, expiry: number, condition: string) {
    if (!redis.available) throw new Error("offline");
    if (value !== "1" || expiryMode !== "EXAT" || condition !== "NX") throw new Error("non-atomic contract");
    if ((redis.entries.get(key) ?? 0) > Date.now() / 1000) return null;
    redis.entries.set(key, expiry); return "OK";
  }
} }));
beforeEach(() => { vi.resetModules(); redis.available = true; redis.entries.clear(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe("MFA single-use store", () => {
  it("consumes once in development and denies expired challenges", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REDIS_URL", "");
    const { consumeMfaChallenge } = await import("./mfa");
    const expires = Math.floor(Date.now() / 1000) + 30;
    expect(await consumeMfaChallenge("one", expires)).toBe(true);
    expect(await consumeMfaChallenge("one", expires)).toBe(false);
    expect(await consumeMfaChallenge("expired", Math.floor(Date.now() / 1000))).toBe(false);
  });
  it("fails closed in production without Redis", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("REDIS_URL", "");
    const { consumeMfaChallenge } = await import("./mfa");
    await expect(consumeMfaChallenge("one", Math.floor(Date.now() / 1000) + 30)).rejects.toThrow();
  });
  it("uses atomic expiry and preserves replay protection after a temporary outage", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("REDIS_URL", "redis://test");
    const { consumeMfaChallenge } = await import("./mfa");
    const expires = Math.floor(Date.now() / 1000) + 30;
    redis.available = false;
    await expect(consumeMfaChallenge("one", expires)).rejects.toThrow();
    redis.available = true;
    expect(await consumeMfaChallenge("one", expires)).toBe(true);
    redis.available = false;
    await expect(consumeMfaChallenge("two", expires)).rejects.toThrow();
    redis.available = true;
    expect(await consumeMfaChallenge("one", expires)).toBe(false);
    expect(await consumeMfaChallenge("two", expires)).toBe(true);
    expect(await consumeMfaChallenge("expired", Math.floor(Date.now() / 1000))).toBe(false);
  });
});
