import { describe, expect, it } from "vitest";
import { linkTokenCaptureScript, safeNextPath } from "./link-token";

describe("link-token", () => {
  it("returns only allowlisted internal paths after sign-in", () => {
    expect(safeNextPath("/accept-invitation")).toBe("/accept-invitation");
    expect(safeNextPath("/verify-email")).toBe("/verify-email");
    for (const value of ["https://evil.example/accept-invitation", "//evil.example", "/dashboard", "/accept-invitation?x=1", null, 1]) {
      expect(safeNextPath(value)).toBeNull();
    }
  });

  it("moves a fragment token into this tab and strips the fragment before the app runs", () => {
    const script = linkTokenCaptureScript("accept-invitation");
    const token = "A".repeat(43);
    const replaced: string[] = [];
    const storage = new Map<string, string>();
    const window = {
      location: { hash: `#token=${token}`, pathname: "/accept-invitation", search: "" },
      history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) },
      sessionStorage: { setItem: (k: string, v: string) => storage.set(k, v) },
    } as Record<string, unknown>;
    new Function("window", script)(window);
    expect(replaced).toEqual(["/accept-invitation"]);
    expect(storage.get("reloop:link-token:accept-invitation")).toBe(token);
    expect(window.__reloopLinkToken).toBe(token);
  });

  it("strips a fragment that carries no valid token without storing anything", () => {
    const replaced: string[] = [];
    const storage = new Map<string, string>();
    const window = {
      location: { hash: "#token=<script>", pathname: "/verify-email", search: "" },
      history: { state: null, replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) },
      sessionStorage: { setItem: (k: string, v: string) => storage.set(k, v) },
    } as Record<string, unknown>;
    new Function("window", linkTokenCaptureScript("verify-email"))(window);
    expect(replaced).toEqual(["/verify-email"]);
    expect(storage.size).toBe(0);
  });
});
