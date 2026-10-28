import { describe, expect, it } from "vitest";
import { contrast, readBlock, readRepoFile } from "./css-tokens";

// Palette contract for docs/superpowers/specs/2026-10-27-app-editorial-theme-design.md:
// editorial anchors from the landing, and WCAG AA for every pair the UI uses.

const css = readRepoFile("app/globals.css");
const light = readBlock(css, "@theme");
const dark = { ...light, ...readBlock(css, ".dark") };

const color = (theme: Record<string, string>, name: string) => {
  const value = theme[`color-${name}`];
  if (!value) throw new Error(`missing --color-${name}`);
  return value;
};

describe("editorial palette", () => {
  it("keeps a light island light in dark mode", () => {
    expect(readBlock(css, ".dark .light-island")).toEqual({
      "color-background": light["color-background"],
      "color-foreground": light["color-foreground"],
      "color-muted": light["color-muted"],
    });
  });

  it("pins the editorial anchors", () => {
    expect(light["color-background"]).toBe("#f0eee5");
    expect(light["color-foreground"]).toBe("#082f22");
    expect(light["color-lime"]).toBe("#d2f437");
    expect(light["color-ink"]).toBe("#082f22");
  });

  const pairs: [string, string, string, number][] = [
    ["light", "foreground", "background", 7],
    ["light", "foreground", "surface", 7],
    ["light", "foreground", "surface-soft", 7],
    ["light", "muted", "background", 4.5],
    ["light", "muted", "surface-soft", 4.5],
    ["light", "muted-soft", "surface", 4.5],
    ["light", "muted-soft", "background", 4.5],
    ["light", "input-border", "surface", 3],
    ["light", "brand-400", "background", 3],
    ["light", "on-ink", "ink", 4.5],
    ["light", "on-ink", "ink-hover", 4.5],
    ["light", "ink", "lime", 4.5],
    ["light", "sidebar-fg", "sidebar", 4.5],
    ["light", "sidebar-muted", "sidebar", 4.5],
    ["light", "sidebar-label", "sidebar", 4.5],
    ["light", "brand-600", "background", 4.5],
    ["light", "brand-700", "background", 4.5],
    ["light", "brand-700", "brand-50", 4.5],
    ["light", "red-700", "red-50", 4.5],
    ["light", "amber-700", "amber-50", 4.5],
    ["light", "blue-700", "blue-50", 4.5],
    ["light", "slate-600", "slate-100", 4.5],
    ["light", "slate-500", "surface", 4.5],
    ["light", "status-error", "background", 4.5],
    ["light", "status-online", "background", 3],
    ["light", "status-full", "background", 3],
    ["light", "status-maintenance", "background", 3],
    ["light", "status-offline", "background", 3],
    ["dark", "foreground", "background", 7],
    ["dark", "foreground", "surface-soft", 7],
    ["dark", "muted", "background", 4.5],
    ["dark", "muted", "surface-soft", 4.5],
    ["dark", "muted-soft", "surface", 4.5],
    ["dark", "input-border", "surface", 3],
    ["dark", "brand-400", "surface", 4.5],
    ["dark", "brand-300", "surface", 4.5],
    ["dark", "sidebar-muted", "sidebar", 4.5],
    ["dark", "sidebar-label", "sidebar", 4.5],
    ["dark", "red-400", "surface", 4.5],
    ["dark", "amber-400", "surface", 4.5],
    ["dark", "blue-400", "surface", 4.5],
    ["dark", "slate-400", "surface", 4.5],
    ["dark", "status-error", "surface", 4.5],
    ["dark", "status-online", "surface", 4.5],
    ["dark", "status-online", "brand-50", 4.5],
    // Pages color text with brand-600/700/800 in light mode only; dark mode must
    // keep that text readable on every dark surface.
    ["dark", "brand-600", "surface", 4.5],
    ["dark", "brand-600", "background", 4.5],
    ["dark", "brand-700", "surface", 4.5],
    ["dark", "brand-700", "surface-soft", 4.5],
    ["dark", "brand-700", "brand-50", 4.5],
    ["dark", "brand-800", "surface", 4.5],
    ["dark", "brand-800", "brand-50", 4.5],
  ];

  it.each(pairs)("%s: %s on %s is at least %s:1", (scheme, fg, bg, min) => {
    const theme = scheme === "light" ? light : dark;
    expect(contrast(color(theme, fg), color(theme, bg))).toBeGreaterThanOrEqual(min);
  });

  it("writes every token as #rrggbb", () => {
    for (const block of [readBlock(css, "@theme"), readBlock(css, ".dark")]) {
      for (const [key, value] of Object.entries(block)) {
        if (key.startsWith("color-")) expect(value, key).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  // OSM tiles stay light in dark mode, so pins (and the legend that keys them)
  // keep the light-mode status colors; dark-mode hues fall to about 2:1 on land.
  it("keeps map pins in the light status colors over the light tiles", () => {
    const scoped = readBlock(css, ".dark .leaflet-marker-pane, .dark .map-status-light");
    const osmLand = "#f2efe9";
    for (const status of ["online", "full", "maintenance", "error", "offline"]) {
      const key = `color-status-${status}`;
      expect(scoped[key], key).toBe(light[key]);
      expect(contrast(light[key], osmLand), key).toBeGreaterThanOrEqual(3);
    }
    expect(scoped["color-surface"]).toBe(light["color-surface"]);
  });

  it("map markers use status tokens", () => {
    const markers = readRepoFile("components/map/map-markers.css");
    for (const status of ["online", "full", "maintenance", "error", "offline"]) {
      expect(markers).toMatch(new RegExp(`\\.rl-status--${status}\\s*\\{\\s*color:\\s*var\\(--color-status-${status}\\)`));
    }
    expect(markers).not.toContain("#0d9488");
    expect(markers).toMatch(/\.rl-campaign-pin\s*\{[^}]*background:\s*var\(--color-ink\)[^}]*color:\s*var\(--color-lime\)/);
    // Leaflet paints popups white; they follow the theme so popup text stays readable in dark mode.
    expect(markers).toMatch(/\.leaflet-popup-content-wrapper[^{]*\{[^}]*background:\s*var\(--color-surface\)/);
    expect(readRepoFile("components/map/MapLegend.tsx")).not.toContain("bg-[#");
  });
});
