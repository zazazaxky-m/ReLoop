import type Redis from "ioredis";

export class MfaChallengeStoreUnavailable extends Error {
  constructor(options?: { cause?: unknown }) {
    super("Layanan masuk sementara tidak tersedia. Silakan coba lagi.", options);
  }
}

/**
 * Operator-facing summary of a Redis failure. Deliberately not the raw error object: connection
 * errors can carry the Redis URL (credentials included), so only name/code/message are logged,
 * with any occurrence of the URL redacted. The full error stays available as the thrown `cause`.
 */
function describeRedisFailure(error: unknown, url: string): string {
  const err = error as { name?: unknown; code?: unknown; message?: unknown } | null | undefined;
  const name = typeof err?.name === "string" ? err.name : "Error";
  const code = typeof err?.code === "string" ? ` (${err.code})` : "";
  const message = typeof err?.message === "string" ? err.message : String(error);
  return `${name}${code}: ${message.split(url).join("[redacted]")}`;
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
  } catch (error) {
    // Covers connect and command failures alike. Never log the challenge id, tokens or the URL.
    console.error("[mfa-challenge] Redis consume failed:", describeRedisFailure(error, url));
    if (current && client === current) {
      client = undefined;
      current.disconnect();
    }
    throw new MfaChallengeStoreUnavailable({ cause: error });
  }
}
