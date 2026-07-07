import { afterEach, describe, expect, it } from "vitest";
import { consumeMachineNonce } from "@/lib/machine-nonce";

const originalEnv = { ...process.env };

function resetNonceStore() {
  delete (globalThis as typeof globalThis & { __reloopNonceStore?: unknown })
    .__reloopNonceStore;
}

describe("machine nonce store", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
    resetNonceStore();
  });

  it("uses memory replay protection outside production", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "test";
    delete process.env.REDIS_URL;
    resetNonceStore();

    expect(await consumeMachineNonce("m1", "n1")).toBe(true);
    expect(await consumeMachineNonce("m1", "n1")).toBe(false);
  });

  it("fails closed in production when REDIS_URL is missing", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.REDIS_URL;
    resetNonceStore();

    await expect(consumeMachineNonce("m1", "n1")).rejects.toThrow(
      "REDIS_URL is required",
    );
  });
});
