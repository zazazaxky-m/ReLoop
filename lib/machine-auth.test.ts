import { describe, expect, it } from "vitest";
import {
  generateIngestSecret,
  signMachinePayload,
  verifyMachineSignature,
} from "@/lib/machine-auth";

describe("machine HMAC handshake", () => {
  const secret = "test-secret";
  const body = '{"machineCode":"RLP-001","localEventId":"e1"}';
  const now = 1_000_000;
  const ts = String(now);
  const nonce = "abc123";

  it("verifies a correctly signed request", () => {
    const sig = signMachinePayload(secret, ts, nonce, body);
    const r = verifyMachineSignature({ secret, timestamp: ts, nonce, rawBody: body, signature: sig, nowSeconds: now });
    expect(r.ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = signMachinePayload(secret, ts, nonce, body);
    const r = verifyMachineSignature({
      secret,
      timestamp: ts,
      nonce,
      rawBody: body + "x",
      signature: sig,
      nowSeconds: now,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("BAD_SIGNATURE");
  });

  it("rejects a wrong secret", () => {
    const sig = signMachinePayload("other", ts, nonce, body);
    const r = verifyMachineSignature({ secret, timestamp: ts, nonce, rawBody: body, signature: sig, nowSeconds: now });
    expect(r.ok).toBe(false);
  });

  it("rejects stale timestamps (replay window)", () => {
    const sig = signMachinePayload(secret, ts, nonce, body);
    const r = verifyMachineSignature({
      secret,
      timestamp: ts,
      nonce,
      rawBody: body,
      signature: sig,
      nowSeconds: now + 10_000,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("STALE_TIMESTAMP");
  });

  it("rejects missing headers / no secret", () => {
    expect(verifyMachineSignature({ secret: null, timestamp: ts, nonce, rawBody: body, signature: "x" }).ok).toBe(false);
    expect(verifyMachineSignature({ secret, timestamp: null, nonce, rawBody: body, signature: "x", nowSeconds: now }).ok).toBe(false);
  });

  it("generates distinct high-entropy secrets", () => {
    const a = generateIngestSecret();
    const b = generateIngestSecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
});
