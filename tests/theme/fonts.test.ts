import { describe, expect, it, vi } from "vitest";
import { readBlock, readRepoFile } from "./css-tokens";

const localFont = vi.hoisted(() => vi.fn((_options: { preload?: boolean }) => ({ variable: "v" })));
vi.mock("next/font/local", () => ({ default: localFont }));

const { viewport } = await import("@/app/layout");
const css = readRepoFile("app/globals.css");
const landingCss = readRepoFile("components/landing/editorial/landing.css");

/** family|weight → src url of every @font-face in `source`. */
function faces(source: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, body] of source.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const family = body.match(/font-family:\s*"([^"]+)"/)?.[1];
    const weight = body.match(/font-weight:\s*(\d+)/)?.[1] ?? "400";
    const url = body.match(/url\("([^"]+)"\)/)?.[1];
    if (family && url) map.set(`${family}|${weight}`, url);
  }
  return map;
}

describe("editorial type, texture and theme color", () => {
  it("colors the browser chrome forest ink", () => {
    expect(viewport.themeColor).toBe("#082f22");
    const manifest = JSON.parse(readRepoFile("public/manifest.webmanifest"));
    expect(manifest.theme_color).toBe("#082f22");
    expect(manifest.background_color).toBe("#f0eee5");
  });

  it("sets DM Sans as the app face and Anton as the display face, with metric-matched fallbacks", () => {
    const theme = readBlock(css, "@theme");
    expect(theme["font-sans"].startsWith('"DM Sans", "DM Sans Fallback"')).toBe(true);
    expect(theme["font-display"].startsWith('"Anton", "Anton Fallback"')).toBe(true);
    for (const fallback of ["DM Sans Fallback", "Anton Fallback"]) {
      expect(css).toMatch(new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*"${fallback}";[^}]*size-adjust:`));
    }
  });

  // One download per file: the app reuses the landing's own font URLs, so a
  // visitor going from the landing to /login already has the faces cached.
  it("declares the editorial faces at the landing's own URLs", () => {
    const landing = faces(landingCss);
    const app = faces(css);
    for (const key of ["DM Sans|400", "DM Sans|700", "Anton|400"]) {
      expect(landing.get(key), key).toBeDefined();
      expect(app.get(key), key).toBe(landing.get(key));
    }
  });

  it("preloads no font from the root layout, so the landing gets no extra downloads", () => {
    expect(localFont).toHaveBeenCalled();
    for (const [options] of localFont.mock.calls) expect(options.preload).toBe(false);
  });

  // next/font served its copies as immutable; the shared files are not
  // content-hashed, so they get a week instead of revalidating on every load.
  it("caches the shared font files for a week", async () => {
    const { default: nextConfig } = await import("@/next.config");
    const rules = (await nextConfig.headers?.()) ?? [];
    const fonts = rules.find((rule) => rule.source === "/landing/fonts/:file*");
    expect(fonts?.headers).toContainEqual({ key: "Cache-Control", value: "public, max-age=604800" });
  });

  it("lays the landing paper texture behind light pages only", () => {
    expect(css).toContain("/landing/paper-v2.webp");
    expect(css).toMatch(/\.dark\s+body::before\s*\{[^}]*display:\s*none/);
  });
});
