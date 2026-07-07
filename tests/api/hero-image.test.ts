import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/public/hero-image/route";

describe("GET /api/public/hero-image", () => {
  it("rejects paths outside hero allowlist", async () => {
    const res = await GET(
      new Request("http://localhost/api/public/hero-image?path=reloop-logo.svg"),
    );
    expect(res.status).toBe(400);
  });

  it("rejects traversal attempts", async () => {
    const res = await GET(
      new Request("http://localhost/api/public/hero-image?path=../package.json"),
    );
    expect(res.status).toBe(400);
  });

  it("allows hero-prefixed webp paths", async () => {
    const res = await GET(
      new Request(
        "http://localhost/api/public/hero-image?path=hero-ai-community.webp",
      ),
    );
    expect([200, 404]).toContain(res.status);
  });
});
