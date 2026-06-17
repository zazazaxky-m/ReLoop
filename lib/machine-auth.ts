import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Max allowed clock skew (seconds) between machine and server for a signed request. */
export const MACHINE_SIG_MAX_SKEW_SECONDS = 300;

/** Generates a high-entropy per-machine ingest secret. */
export function generateIngestSecret(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Canonical signing string = `${timestamp}.${nonce}.${rawBody}`, HMAC-SHA256 with
 * the machine's secret. The secret never travels on the wire — only the signature.
 */
export function signMachinePayload(
  secret: string,
  timestamp: string,
  nonce: string,
  rawBody: string,
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${nonce}.${rawBody}`)
    .digest("hex");
}

export interface VerifyResult {
  ok: boolean;
  reason?: string;
}

/** Verifies a machine request signature with timing-safe compare + replay window. */
export function verifyMachineSignature(params: {
  secret: string | null | undefined;
  timestamp: string | null | undefined;
  nonce: string | null | undefined;
  rawBody: string;
  signature: string | null | undefined;
  nowSeconds?: number;
}): VerifyResult {
  const { secret, timestamp, nonce, rawBody, signature } = params;
  if (!secret) return { ok: false, reason: "NO_SECRET" };
  if (!timestamp || !nonce || !signature) return { ok: false, reason: "MISSING_HEADERS" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "BAD_TIMESTAMP" };
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > MACHINE_SIG_MAX_SKEW_SECONDS) {
    return { ok: false, reason: "STALE_TIMESTAMP" };
  }

  const expected = signMachinePayload(secret, timestamp, nonce, rawBody);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return { ok: false, reason: "BAD_SIGNATURE" };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "BAD_SIGNATURE" };
}
