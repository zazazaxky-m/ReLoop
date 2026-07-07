import { describe, expect, it, vi, afterEach } from "vitest";
import { getClientIp } from "./client-ip";

describe("getClientIp", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const req = (headers: Record<string, string>) =>
    new Request("http://localhost/api/auth/login", { headers });

  it("prefers x-real-ip when TRUST_PROXY is enabled", () => {
    vi.stubEnv("TRUST_PROXY", "true");
    vi.stubEnv("NODE_ENV", "development");
    const ip = getClientIp(
      req({
        "x-real-ip": "203.0.113.5",
        "x-forwarded-for": "198.51.100.1, 10.0.0.1",
      }),
    );
    expect(ip).toBe("203.0.113.5");
  });

  it("uses leftmost forwarded-for in production when real-ip is absent", () => {
    vi.stubEnv("NODE_ENV", "production");
    const ip = getClientIp(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }));
    expect(ip).toBe("203.0.113.5");
  });

  it("returns unknown when no headers are present", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(getClientIp(req({}))).toBe("unknown");
  });
});
