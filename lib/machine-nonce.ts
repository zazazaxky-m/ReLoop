/** Keep in sync with MACHINE_SIG_MAX_SKEW_SECONDS in machine-auth.ts. */
const MACHINE_SIG_MAX_SKEW_SECONDS = 300;

/** Nonces live at least as long as the HMAC replay window. */
const NONCE_TTL_MS = (MACHINE_SIG_MAX_SKEW_SECONDS + 60) * 1000;
const isProduction = () => process.env.NODE_ENV === "production";

interface NonceStore {
  consume(key: string): Promise<boolean>;
}

class MemoryNonceStore implements NonceStore {
  private seen = new Map<string, number>();

  constructor() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, expiresAt] of this.seen) {
        if (expiresAt <= now) this.seen.delete(key);
      }
    }, 60_000).unref?.();
  }

  async consume(key: string): Promise<boolean> {
    const now = Date.now();
    const existing = this.seen.get(key);
    if (existing && existing > now) return false;
    this.seen.set(key, now + NONCE_TTL_MS);
    return true;
  }
}

class RedisNonceStore implements NonceStore {
  private client: unknown = null;
  private unavailable = false;
  private connecting: Promise<unknown> | null = null;
  private readonly fallback = new MemoryNonceStore();

  constructor(private readonly url: string) {}

  private async getClient(): Promise<any | null> {
    if (this.unavailable) return null;
    if (this.client) return this.client;
    if (!this.connecting) this.connecting = this.connect();
    return this.connecting;
  }

  private async connect(): Promise<any | null> {
    try {
      const moduleName = "ioredis";
      const mod: any = await import(moduleName);
      const RedisCtor = mod?.default ?? mod;
      const client = new RedisCtor(this.url, { maxRetriesPerRequest: 1, lazyConnect: false });
      client.on("error", (err: unknown) => {
        console.error("[machine-nonce] Redis error:", err);
        this.unavailable = true;
        this.client = null;
      });
      this.client = client;
      return client;
    } catch (err) {
      console.warn(
        "[machine-nonce] REDIS_URL is set but ioredis is unavailable.",
        err,
      );
      this.unavailable = true;
      return null;
    }
  }

  async consume(key: string): Promise<boolean> {
    const client = await this.getClient();
    if (!client) return isProduction() ? false : this.fallback.consume(key);
    try {
      const result = await client.set(key, "1", "PX", NONCE_TTL_MS, "NX");
      return result === "OK";
    } catch (err) {
      console.error("[machine-nonce] Redis consume failed:", err);
      return isProduction() ? false : this.fallback.consume(key);
    }
  }
}

function nonceKey(machineId: string, nonce: string): string {
  return `machine-nonce:${machineId}:${nonce}`;
}

const globalForNonce = globalThis as typeof globalThis & {
  __reloopNonceStore?: NonceStore;
};

function getNonceStore(): NonceStore {
  if (!globalForNonce.__reloopNonceStore) {
    if (isProduction() && !process.env.REDIS_URL) {
      throw new Error("REDIS_URL is required for production machine replay protection");
    }
    globalForNonce.__reloopNonceStore = !process.env.REDIS_URL
      ? new MemoryNonceStore()
      : new RedisNonceStore(process.env.REDIS_URL);
  }
  return globalForNonce.__reloopNonceStore;
}

/** Returns true when the nonce is fresh; false on replay within the TTL window. */
export async function consumeMachineNonce(
  machineId: string,
  nonce: string,
): Promise<boolean> {
  return getNonceStore().consume(nonceKey(machineId, nonce));
}
