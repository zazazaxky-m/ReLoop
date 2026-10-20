import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const redis = vi.hoisted(() => ({
  available: true, entries: new Map<string, number>(), failure: new Error("offline"), commandError: null as Error | null,
}));
vi.mock("ioredis", () => ({ default: class Redis {
  on() { return this; }
  async connect() { if (!redis.available) throw redis.failure; }
  disconnect() {}
  async set(key: string, value: string, expiryMode: string, expiry: number, condition: string) {
    if (!redis.available) throw redis.failure;
    if (redis.commandError) throw redis.commandError;
    if (value !== "1" || expiryMode !== "EXAT" || condition !== "NX") throw new Error("non-atomic contract");
    if ((redis.entries.get(key) ?? 0) > Date.now() / 1000) return null;
    redis.entries.set(key, expiry); return "OK";
  }
} }));
beforeEach(() => {
  vi.resetModules(); redis.available = true; redis.entries.clear(); redis.failure = new Error("offline"); redis.commandError = null;
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); });
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
    vi.spyOn(console, "error").mockImplementation(() => {});
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
  describe("Redis failure diagnostics", () => {
    const redisUrl = "redis://user:s3cret@test:6379";
    const challengeId = "challenge-jti-123";
    const entries = (calls: unknown[][]) => inspect(calls, { depth: 6 });

    async function load() {
      vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("REDIS_URL", redisUrl);
      return import("./mfa-challenge-store");
    }

    it("logs a connect failure and keeps the original error as the cause", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const { consumeMfaChallenge, MfaChallengeStoreUnavailable } = await load();
      redis.available = false;
      redis.failure = new Error(`connect ECONNREFUSED ${redisUrl}`);
      const error = await consumeMfaChallenge(challengeId, Math.floor(Date.now() / 1000) + 30).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MfaChallengeStoreUnavailable);
      expect((error as Error).message).toBe("Layanan masuk sementara tidak tersedia. Silakan coba lagi.");
      expect((error as Error).cause).toBe(redis.failure);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0][0]).toMatch(/^\[mfa-challenge\] /);
      expect(entries(logged.mock.calls)).toContain("ECONNREFUSED");
    });

    it("logs a command failure and keeps the original error as the cause", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const { consumeMfaChallenge, MfaChallengeStoreUnavailable } = await load();
      redis.commandError = Object.assign(new Error("NOAUTH Authentication required."), { name: "ReplyError" });
      const error = await consumeMfaChallenge(challengeId, Math.floor(Date.now() / 1000) + 30).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(MfaChallengeStoreUnavailable);
      expect((error as Error).cause).toBe(redis.commandError);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(logged.mock.calls[0][0]).toMatch(/^\[mfa-challenge\] /);
      expect(entries(logged.mock.calls)).toContain("NOAUTH");
    });

    it("never logs the challenge id, the Redis URL or its credentials", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const { consumeMfaChallenge } = await load();
      redis.available = false;
      redis.failure = new Error(`connect ECONNREFUSED ${redisUrl}`);
      await expect(consumeMfaChallenge(challengeId, Math.floor(Date.now() / 1000) + 30)).rejects.toThrow();
      expect(logged).toHaveBeenCalled();
      const output = entries(logged.mock.calls);
      for (const secret of [challengeId, redisUrl, "s3cret", "user:"]) expect(output).not.toContain(secret);
    });
  });
});
