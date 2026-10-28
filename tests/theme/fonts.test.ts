import { describe, expect, it, vi } from "vitest";
import { readBlock, readRepoFile } from "./css-tokens";

vi.mock("next/font/local", () => ({ default: () => ({ variable: "v" }) }));

const { viewport } = await import("@/app/layout");
const css = readRepoFile("app/globals.css");

describe("editorial type, texture and theme color", () => {
  it("colors the browser chrome forest ink", () => {
    expect(viewport.themeColor).toBe("#082f22");
    const manifest = JSON.parse(readRepoFile("public/manifest.webmanifest"));
    expect(manifest.theme_color).toBe("#082f22");
    expect(manifest.background_color).toBe("#f0eee5");
  });

  it("sets DM Sans as the app face and Anton as the display face", () => {
    const theme = readBlock(css, "@theme");
    expect(theme["font-sans"].startsWith("var(--font-dm-sans)")).toBe(true);
    expect(theme["font-display"]).toContain("var(--font-anton)");
  });

  it("lays the landing paper texture behind light pages only", () => {
    expect(css).toContain("/landing/paper-v2.webp");
    expect(css).toMatch(/\.dark\s+body::before\s*\{[^}]*display:\s*none/);
  });
});
