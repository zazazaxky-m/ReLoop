import { describe, expect, it, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/public/hero-image/route";
import { readFile } from "fs/promises";

vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

describe("GET /api/public/hero-image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

  it("rejects empty path", async () => {
    const res = await GET(
      new Request("http://localhost/api/public/hero-image"),
    );
    expect(res.status).toBe(400);
  });

  it("rejects unsupported extension even with hero prefix", async () => {
    const res = await GET(
      new Request("http://localhost/api/public/hero-image?path=hero-banner.gif"),
    );
    expect(res.status).toBe(400);
  });

  it("allows images/hero/ paths", async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from([0xff, 0xd8, 0xff]));
    const res = await GET(
      new Request(
        "http://localhost/api/public/hero-image?path=images/hero/slide.jpg",
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("allows hero_ underscore prefix", async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from("png"));
    const res = await GET(
      new Request(
        "http://localhost/api/public/hero-image?path=hero_banner.png",
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
  });

  it("allows hero-prefixed webp paths", async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from("webp"));
    const res = await GET(
      new Request(
        "http://localhost/api/public/hero-image?path=hero-ai-community.webp",
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
  });

  it("normalizes leading slashes and backslashes", async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from("ok"));
    const res = await GET(
      new Request(
        "http://localhost/api/public/hero-image?path=\\\\hero-slide.jpeg",
      ),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
  });

  it("returns 404 when file is missing", async () => {
    vi.mocked(readFile).mockRejectedValue(new Error("ENOENT"));
    const res = await GET(
      new Request(
        "http://localhost/api/public/hero-image?path=hero-missing.webp",
      ),
    );
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe("Gambar tidak ditemukan");
  });
});
