import { MACHINE_NONCE_TTL_MS } from "./machine-auth-constants";

/**
 * Machine request nonces (SEC-09). A nonce is remembered for
 * MACHINE_NONCE_TTL_MS (2 * skew + 60 s) from its first use, longer than any
 * signature that carries it can be valid (lib/machine-auth-constants.ts).
 *
 * Production keeps nonces in Redis (shared by every app instance; SET NX is
 * atomic, so a nonce is fresh exactly once across instances) and fails closed:
 * without REDIS_URL the store refuses to start, and while Redis is unreachable
 * every request is treated as a replay. Outside production a Redis failure
 * falls back to a process-local store.
 */
const isProduction = () => process.env.NODE_ENV === "production";

export interface MachineNonceStore {
  /** True when the nonce is fresh (and is now consumed); false on replay or when it cannot be checked safely. */
  consume(machineId: string, nonce: string): Promise<boolean>;
  /** Releases the Redis connection (tests and shutdown). */
  close(): Promise<void>;
}

interface KeyStore {
  consumeKey(key: string): Promise<boolean>;
}

function nonceKey(machineId: string, nonce: string): string {
  return `machine-nonce:${machineId}:${nonce}`;
}

class MemoryNonceStore implements KeyStore {
  private seen = new Map<string, number>();

  constructor() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, expiresAt] of this.seen) {
        if (expiresAt <= now) this.seen.delete(key);
      }
    }, 60_000).unref?.();
  }

  async consumeKey(key: string): Promise<boolean> {
    const now = Date.now();
    const existing = this.seen.get(key);
    if (existing && existing > now) return false;
    this.seen.set(key, now + MACHINE_NONCE_TTL_MS);
    return true;
  }
}

/**
 * Redis-backed store. A connection error marks Redis unavailable until ioredis
 * reports `ready` again (it reconnects by itself), so a transient outage fails
 * closed in production without disabling replay protection for good.
 */
class RedisNonceStore implements KeyStore {
  private client: any = null;
  private connecting: Promise<any> | null = null;
  private unavailable = false;
  private broken = false;
  private readonly fallback = new MemoryNonceStore();

  constructor(private readonly url: string) {}

  private async getClient(): Promise<any | null> {
    if (this.broken) return null;
    if (this.client) return this.client;
    if (!this.connecting) this.connecting = this.connect();
    return this.connecting;
  }

  private async connect(): Promise<any | null> {
    try {
      const moduleName = "ioredis";
      const mod: any = await import(moduleName);
      // Dynamic import of ioredis always yields `{ default: Redis }` under ESM.
      const RedisCtor = mod.default;
      const client = new RedisCtor(this.url, { maxRetriesPerRequest: 1, lazyConnect: false });
      client.on("error", (err: unknown) => {
        console.error("[machine-nonce] Redis error:", err);
        this.unavailable = true;
      });
      client.on("ready", () => {
        this.unavailable = false;
      });
      this.client = client;
      return client;
    } catch (err) {
      console.warn("[machine-nonce] REDIS_URL is set but ioredis is unavailable.", err);
      this.broken = true;
      return null;
    }
  }

  private refuse(key: string): Promise<boolean> {
    return isProduction() ? Promise.resolve(false) : this.fallback.consumeKey(key);
  }

  async consumeKey(key: string): Promise<boolean> {
    const client = await this.getClient();
    if (!client || this.unavailable) return this.refuse(key);
    try {
      const result = await client.set(key, "1", "PX", MACHINE_NONCE_TTL_MS, "NX");
      return result === "OK";
    } catch (err) {
      console.error("[machine-nonce] Redis consume failed:", err);
      return this.refuse(key);
    }
  }

  async close(): Promise<void> {
    const client = this.client ?? (this.connecting ? await this.connecting : null);
    this.client = null;
    this.connecting = null;
    this.broken = true;
    client?.disconnect?.();
  }
}

function wrap(store: KeyStore & { close?: () => Promise<void> }): MachineNonceStore {
  return {
    consume: (machineId, nonce) => store.consumeKey(nonceKey(machineId, nonce)),
    close: async () => {
      await store.close?.();
    },
  };
}

/**
 * One app instance's view of the shared Redis nonce space. Every instance
 * builds its own; they agree through Redis (SET NX), never through memory.
 */
export function createRedisNonceStore(url: string): MachineNonceStore {
  return wrap(new RedisNonceStore(url));
}

const globalForNonce = globalThis as typeof globalThis & {
  __reloopNonceStore?: MachineNonceStore;
};

function getNonceStore(): MachineNonceStore {
  if (!globalForNonce.__reloopNonceStore) {
    if (isProduction() && !process.env.REDIS_URL) {
      throw new Error("REDIS_URL is required for production machine replay protection");
    }
    globalForNonce.__reloopNonceStore = !process.env.REDIS_URL
      ? wrap(new MemoryNonceStore())
      : createRedisNonceStore(process.env.REDIS_URL);
  }
  return globalForNonce.__reloopNonceStore;
}

/** Returns true when the nonce is fresh; false on replay within the TTL window. */
export async function consumeMachineNonce(
  machineId: string,
  nonce: string,
): Promise<boolean> {
  return getNonceStore().consume(machineId, nonce);
}
