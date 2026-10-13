import type Redis from "ioredis";

export class MfaChallengeStoreUnavailable extends Error {
  constructor() {
    super("Layanan masuk sementara tidak tersedia. Silakan coba lagi.");
  }
}

const consumed = new Map<string, number>();
let client: Redis | undefined;
let connecting: Promise<Redis> | undefined;

async function redisClient(url: string): Promise<Redis> {
  if (client) return client;
  if (!connecting) {
    connecting = (async () => {
      const { default: RedisClient } = await import("ioredis");
      const candidate = new RedisClient(url, {
        lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1000, commandTimeout: 1000,
        enableOfflineQueue: false, retryStrategy: () => null,
      });
      // Command/connect errors are handled below; never latch an outage forever.
      candidate.on("error", () => {});
      try {
        await candidate.connect();
        client = candidate;
        return candidate;
      } catch (error) {
        candidate.disconnect();
        throw error;
      }
    })();
  }
  try {
    return await connecting;
  } finally {
    connecting = undefined;
  }
}

/** expiresAt is the verified JWT exp, in Unix seconds. SET NX is atomic across replicas. */
export async function consumeMfaChallenge(challengeId: string, expiresAt: number): Promise<boolean> {
  const now = Date.now() / 1000;
  if (!challengeId || !Number.isSafeInteger(expiresAt) || expiresAt <= now) return false;
  const url = process.env.REDIS_URL?.trim();
  if (!url) {
    if (process.env.NODE_ENV === "production") throw new MfaChallengeStoreUnavailable();
    for (const [id, expiry] of consumed) if (expiry <= now) consumed.delete(id);
    if (consumed.has(challengeId)) return false;
    consumed.set(challengeId, expiresAt);
    return true;
  }
  let current: Redis | undefined;
  try {
    current = await redisClient(url);
    return await current.set(`mfa-consumed:${challengeId}`, "1", "EXAT", expiresAt, "NX") === "OK";
  } catch {
    if (current && client === current) {
      client = undefined;
      current.disconnect();
    }
    throw new MfaChallengeStoreUnavailable();
  }
}
