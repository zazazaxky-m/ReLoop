import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSecurityHeaders } from "./security-headers";

function csp(options: Parameters<typeof buildSecurityHeaders>[0]) {
  return buildSecurityHeaders(options).find((h) => h.key === "Content-Security-Policy")?.value ?? "";
}

function directive(policy: string, name: string) {
  return policy.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";
}

describe("buildSecurityHeaders CSP", () => {
  it("keeps production style-src free of 'unsafe-inline'", () => {
    const styleSrc = directive(csp({ nonce: "abc" }), "style-src");
    expect(styleSrc).toContain("'nonce-abc'");
    expect(styleSrc).not.toContain("'unsafe-inline'");
  });

  it("allows only React's hidden streaming segment style attribute", () => {
    // React streaming emits <svg style="display:none" id="S:n"> placeholders;
    // a nonce cannot cover attributes, so allow exactly that value by hash.
    const hash = createHash("sha256").update("display:none").digest("base64");
    const styleSrc = directive(csp({ nonce: "abc" }), "style-src");
    expect(styleSrc).toContain("'unsafe-hashes'");
    expect(styleSrc).toContain(`'sha256-${hash}'`);
  });
});
