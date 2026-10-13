export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  unavailable?: boolean;
}

interface RateLimitStore {
  check(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function denyResult(windowMs: number): RateLimitResult {
  return { allowed: false, remaining: 0, resetAt: Date.now() + windowMs, unavailable: true };
}

/**
 * Process-local store. Correct for a single instance, but each replica in a
 * multi-instance deployment has its own counters — use REDIS_URL in production.
 */
class MemoryRateLimitStore implements RateLimitStore {
  private map = new Map<string, { count: number; resetAt: number }>();

  constructor() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.map) {
        if (entry.resetAt <= now) this.map.delete(key);
      }
    }, 60_000).unref?.();
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.map.get(key);
    if (!entry || entry.resetAt <= now) {
      const resetAt = now + windowMs;
      this.map.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: limit - 1, resetAt };
    }
    entry.count++;
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      resetAt: entry.resetAt,
    };
  }
}

class MissingRedisRateLimitStore implements RateLimitStore {
  async check(_key: string, _limit: number, windowMs: number): Promise<RateLimitResult> {
    console.error("[rate-limit] REDIS_URL missing in production; denying request");
    return denyResult(windowMs);
  }
}

/**
 * Shared counters across every app instance via Redis INCR/PEXPIRE.
 * In production, Redis failures fail closed instead of falling back to memory.
 */
class RedisRateLimitStore implements RateLimitStore {
  private client: unknown = null;
  private connecting: Promise<unknown> | null = null;
  private readonly devFallback = new MemoryRateLimitStore();

  constructor(private readonly url: string) {}

  private async getClient(): Promise<any | null> {
    if (this.client) return this.client;
    if (!this.connecting) this.connecting = this.connect();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private async connect(): Promise<any | null> {
    try {
      const moduleName = "ioredis";
      const mod: any = await import(moduleName);
      // Dynamic import of ioredis always yields `{ default: Redis }` under ESM.
      const RedisCtor = mod.default;
      const client = new RedisCtor(this.url, { maxRetriesPerRequest: 1, lazyConnect: false });
      client.on("error", (err: unknown) => {
        console.error("[rate-limit] Redis error:", err);
        // ioredis reconnects automatically; keep the client available for recovery.
      });
      this.client = client;
      return client;
    } catch (err) {
      console.error("[rate-limit] Failed to connect to Redis:", err);
      return null;
    }
  }

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const client = await this.getClient();
    if (!client) {
      if (isProduction()) {
        console.error("[rate-limit] Redis unavailable in production; denying request");
        return denyResult(windowMs);
      }
      return this.devFallback.check(key, limit, windowMs);
    }

    try {
      const count = await client.incr(key);
      if (count === 1) {
        await client.pexpire(key, windowMs);
      }
      const ttl = await client.pttl(key);
      const resetAt = Date.now() + (ttl > 0 ? ttl : windowMs);
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        resetAt,
      };
    } catch (err) {
      console.error("[rate-limit] Redis check failed:", err);
      if (isProduction()) return denyResult(windowMs);
      return this.devFallback.check(key, limit, windowMs);
    }
  }
}

function createStore(): RateLimitStore {
  const redisUrl = process.env.REDIS_URL?.trim();
  if (isProduction() && !redisUrl) {
    return new MissingRedisRateLimitStore();
  }
  if (redisUrl) return new RedisRateLimitStore(redisUrl);
  return new MemoryRateLimitStore();
}

const store: RateLimitStore = createStore();

export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  return store.check(key, limit, windowMs);
}
