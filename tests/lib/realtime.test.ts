import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { publishRealtime } from "@/lib/realtime";

describe("realtime", () => {
  const originalEnv = { ...process.env };
  const globalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = globalFetch;
  });

  it("does nothing if secret is missing in production", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "production";
    delete process.env.REALTIME_INTERNAL_SECRET;
    
    global.fetch = vi.fn();
    
    await publishRealtime({
      topic: "machine-event",
      machineCode: "M1",
      eventType: "test"
    });
    
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("publishes to default URL in dev", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    delete process.env.REALTIME_INTERNAL_SECRET;
    delete process.env.REALTIME_PUBLISH_URL;
    
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    
    await publishRealtime({
      topic: "machine-event",
      machineCode: "M1",
      eventType: "test"
    });
    
    expect(global.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:3001/publish",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer reloop-dev-realtime-secret"
        })
      })
    );
  });

  it("swallows fetch errors gracefully", async () => {
    (process.env as Record<string, string | undefined>).NODE_ENV = "development";
    
    global.fetch = vi.fn().mockRejectedValue(new Error("Network Error"));
    
    await expect(
      publishRealtime({
        topic: "machine-event",
        machineCode: "M1",
        eventType: "test"
      })
    ).resolves.not.toThrow();
  });
});
