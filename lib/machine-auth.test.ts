import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  generateIngestSecret,
  signMachinePayload,
  verifyMachineSignature,
  verifyMachineRequest,
} from "@/lib/machine-auth";
import { consumeMachineNonce } from "./machine-nonce";
import { MACHINE_NONCE_TTL_MS, MACHINE_SIG_MAX_SKEW_SECONDS } from "./machine-auth-constants";

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

/**
 * SEC-09: a signature is accepted while |server clock - timestamp| <= skew, so
 * one signed request is valid for 2 * skew seconds of server time (a machine
 * clock up to `skew` ahead or behind). The nonce must be remembered for that
 * whole window; it lives 2 * skew + 60 s from its first use.
 */
describe("machine replay window (SEC-09)", () => {
  const secret = "window-secret";
  const body = '{"machineCode":"RLP-001","events":[]}';
  const t = 2_000_000_000; // server clock (seconds) at the first use

  afterEach(() => {
    vi.useRealTimers();
  });

  function signedAt(timestamp: number) {
    const nonce = randomUUID();
    const ts = String(timestamp);
    return {
      machineId: `mach-window-${randomUUID()}`,
      secret,
      timestamp: ts,
      nonce,
      rawBody: body,
      signature: signMachinePayload(secret, ts, nonce, body),
    };
  }

  function at(seconds: number) {
    vi.setSystemTime(new Date(seconds * 1000));
  }

  it("shares one skew constant and derives the nonce TTL as 2 * skew + 60 s", () => {
    expect(MACHINE_SIG_MAX_SKEW_SECONDS).toBe(300);
    expect(MACHINE_NONCE_TTL_MS).toBe(660_000);
    expect(MACHINE_NONCE_TTL_MS).toBe((2 * MACHINE_SIG_MAX_SKEW_SECONDS + 60) * 1000);
  });

  it("accepts a timestamp exactly 300 s ahead of or behind the server clock and rejects 301 s (fake clock)", () => {
    vi.useFakeTimers();
    at(t);
    const check = (timestamp: number) => {
      const request = signedAt(timestamp);
      return verifyMachineSignature(request);
    };
    expect(check(t + 300)).toEqual({ ok: true });
    expect(check(t - 300)).toEqual({ ok: true });
    expect(check(t + 301)).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
    expect(check(t - 301)).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
  });

  it("rejects a replay of a request signed 300 s ahead at t+361 and every later second until its signature expires", async () => {
    vi.useFakeTimers();
    at(t);
    const request = signedAt(t + 300);
    expect(await verifyMachineRequest(request)).toEqual({ ok: true });

    // t+361 is past the old 360 s nonce TTL while the signature is still valid.
    for (const offset of [1, 299, 360, 361, 362, 500, 599, 600]) {
      at(t + offset);
      expect(verifyMachineSignature(request), `signature at t+${offset}`).toEqual({ ok: true });
      expect(await verifyMachineRequest(request), `replay at t+${offset}`).toEqual({ ok: false, reason: "REPLAY_NONCE" });
    }
    // From t+601 the signature itself is stale: the nonce is no longer the only defence.
    at(t + 601);
    expect(await verifyMachineRequest(request)).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
  });

  it("rejects a replay of a request signed 300 s behind until its signature expires", async () => {
    vi.useFakeTimers();
    at(t);
    const request = signedAt(t - 300);
    expect(await verifyMachineRequest(request)).toEqual({ ok: true });
    at(t + 1);
    expect(await verifyMachineRequest(request)).toEqual({ ok: false, reason: "STALE_TIMESTAMP" });
  });
});
