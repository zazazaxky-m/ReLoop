import { afterEach, describe, expect, it, vi } from "vitest";
import { realtimeWsUrl } from "./realtime-url";

describe("realtimeWsUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the configured URL when provided", () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_WS_URL", "wss://rt.example.com/ws");
    expect(realtimeWsUrl({ protocol: "https:", host: "app.example.com" })).toBe(
      "wss://rt.example.com/ws",
    );
  });

  it("falls back to the same-origin /ws proxy in production", () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_WS_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(realtimeWsUrl({ protocol: "https:", host: "reloop.id" })).toBe("wss://reloop.id/ws");
    expect(realtimeWsUrl({ protocol: "http:", host: "10.0.0.5:8080" })).toBe("ws://10.0.0.5:8080/ws");
  });

  it("falls back to the local realtime server in development", () => {
    vi.stubEnv("NEXT_PUBLIC_REALTIME_WS_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(realtimeWsUrl({ protocol: "http:", host: "localhost:3000" })).toBe("ws://localhost:3001/ws");
  });
});
