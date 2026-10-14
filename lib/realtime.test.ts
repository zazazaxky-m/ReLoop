import { describe, expect, it, vi, afterEach } from "vitest";
import { publishRealtime } from "./realtime";

describe("lib/realtime", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("publishes message when secret is configured", async () => {
    vi.stubEnv("REALTIME_INTERNAL_SECRET", "secret-123");
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true } as Response));
    global.fetch = fetchSpy;

    await publishRealtime({
      topic: "machine-event",
      machineCode: "M001",
      eventType: "TEST",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/publish");
    expect((opts as any).method).toBe("POST");
    expect((opts as any).headers.Authorization).toBe("Bearer secret-123");
  });

  it("swallows fetch errors", async () => {
    vi.stubEnv("REALTIME_INTERNAL_SECRET", "secret-123");
    global.fetch = vi.fn(() => Promise.reject(new Error("network")));
    await expect(
      publishRealtime({
        topic: "security-alert",
        organizationId: "org-1",
        machineCode: "M002",
        eventType: "ALERT",
      }),
    ).resolves.toBeUndefined();
  });

  it("returns early when secret is empty in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REALTIME_INTERNAL_SECRET", "");
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true } as Response));
    global.fetch = fetchSpy;

    await publishRealtime({
      topic: "machine-state",
      machineCode: "M003",
      eventType: "STATE",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
