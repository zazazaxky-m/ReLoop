import { describe, expect, it } from "vitest";
import {
  generateIngestSecret,
  signMachinePayload,
  verifyMachineSignature,
  verifyMachineRequest,
} from "@/lib/machine-auth";
import { consumeMachineNonce } from "./machine-nonce";

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

  it("uses Date.now when nowSeconds is omitted", () => {
    const liveTs = String(Math.floor(Date.now() / 1000));
    const liveNonce = "live-nonce";
    const sig = signMachinePayload(secret, liveTs, liveNonce, body);
    const r = verifyMachineSignature({
      secret,
      timestamp: liveTs,
      nonce: liveNonce,
      rawBody: body,
      signature: sig,
    });
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
    expect(verifyMachineSignature({ secret, timestamp: ts, nonce: null, rawBody: body, signature: "x", nowSeconds: now }).reason).toBe("MISSING_HEADERS");
    expect(verifyMachineSignature({ secret, timestamp: ts, nonce, rawBody: body, signature: null, nowSeconds: now }).reason).toBe("MISSING_HEADERS");
  });

  it("rejects non-numeric timestamps and mismatched signature length", () => {
    expect(
      verifyMachineSignature({
        secret,
        timestamp: "not-a-number",
        nonce,
        rawBody: body,
        signature: "x",
        nowSeconds: now,
      }).reason,
    ).toBe("BAD_TIMESTAMP");

    const sig = signMachinePayload(secret, ts, nonce, body);
    expect(
      verifyMachineSignature({
        secret,
        timestamp: ts,
        nonce,
        rawBody: body,
        signature: sig.slice(0, 8),
        nowSeconds: now,
      }).reason,
    ).toBe("BAD_SIGNATURE");
  });

  it("verifyMachineRequest returns signature failure before nonce check", async () => {
    const result = await verifyMachineRequest({
      machineId: "mach_3",
      secret: null,
      timestamp: ts,
      nonce,
      rawBody: body,
      signature: "x",
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: "NO_SECRET" });
  });

  it("rejects replayed nonces", async () => {
    expect(await consumeMachineNonce("mach_1", "nonce-replay-test")).toBe(true);
    expect(await consumeMachineNonce("mach_1", "nonce-replay-test")).toBe(false);
  });

  it("verifyMachineRequest rejects replayed signed requests", async () => {
    const sig = signMachinePayload(secret, ts, "nonce-verify", body);
    const params = {
      machineId: "mach_2",
      secret,
      timestamp: ts,
      nonce: "nonce-verify",
      rawBody: body,
      signature: sig,
      nowSeconds: now,
    };
    expect((await verifyMachineRequest(params)).ok).toBe(true);
    const replay = await verifyMachineRequest(params);
    expect(replay.ok).toBe(false);
    expect(replay.reason).toBe("REPLAY_NONCE");
  });

  it("generates distinct high-entropy secrets", () => {
    const a = generateIngestSecret();
    const b = generateIngestSecret();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
});
