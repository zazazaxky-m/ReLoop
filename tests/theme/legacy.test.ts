import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import KioskLayout, { viewport as kioskViewport } from "@/app/kiosk/[code]/layout";
import MachineDisplayLayout, { viewport as displayViewport } from "@/app/machine/[code]/display/layout";
import PrintLayout, { viewport as printViewport } from "@/app/print/layout";
import { readBlock, readRepoFile } from "./css-tokens";

// Kiosk, machine display and trip print are out of scope for the editorial
// theme and must look unchanged: `.legacy-theme` re-declares the values these
// tokens had on main before the theme work (app/globals.css at 7b0361f).

const OLD_LIGHT: Record<string, string> = {
  "color-background": "#f3f7f5",
  "color-surface": "#ffffff",
  "color-surface-soft": "#f8faf9",
  "color-foreground": "#14211a",
  "color-muted": "#5f6f66",
  "color-muted-soft": "#667468",
  "color-border": "#dce6df",
  "color-brand-50": "#ecfdf5",
  "color-brand-100": "#dcfce7",
  "color-brand-200": "#bbf7d0",
  "color-brand-300": "#86efac",
  "color-brand-400": "#4ade80",
  "color-brand-500": "#16a34a",
  "color-brand-600": "#15803d",
  "color-brand-700": "#14532d",
  "color-brand-800": "#134e2a",
  "color-brand-900": "#0f3d21",
  "color-brand-950": "#082818",
  "color-mint": "#dcfce7",
  "color-mint-soft": "#ecfdf5",
  "color-accent": "#65a30d",
  "color-status-online": "#16a34a",
  "color-status-full": "#d97706",
  "color-status-maintenance": "#2563eb",
  "color-status-error": "#dc2626",
  "color-status-offline": "#64748b",
};

const OLD_DARK: Record<string, string> = {
  "color-background": "#0b0f0d",
  "color-surface": "#101613",
  "color-surface-soft": "#161e1a",
  "color-foreground": "#e4e9e6",
  "color-muted": "#9aa9a0",
  "color-muted-soft": "#7e8e85",
  "color-border": "#1d2722",
  "color-brand-950": "#061d10",
  "color-mint": "#0f3d21",
  "color-mint-soft": "#082818",
  "color-brand-50": "#0a2e18",
  "color-brand-100": "#0f3d21",
  "color-brand-200": "#14532d",
};

// The app face, browser chrome color, text selection and scrollbar thumb on main
// at 7b0361f; the new theme sets them on :root, html and the universal selector.
const OLD_FONT_SANS =
  'var(--font-jakarta), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';
const OLD_THEME_COLOR = "#16a34a";

const globals = readRepoFile("app/globals.css");
const legacyCss = readRepoFile("app/legacy-theme.css");
const tailwindDefaults = readBlock(readRepoFile("node_modules/tailwindcss/theme.css"), "@theme default");
const newLight = readBlock(globals, "@theme");
const newDark = readBlock(globals, ".dark");
const legacyLight = readBlock(legacyCss, ".legacy-theme");
const legacyDark = readBlock(legacyCss, ".dark .legacy-theme");
const WARMED = /^color-(red|amber|blue|slate)-\d+$/;

describe("legacy theme scope", () => {
  it("restores every app token the new theme sets", () => {
    const keys = Object.keys(newLight).filter((key) => key in OLD_LIGHT);
    expect(keys.length).toBe(Object.keys(OLD_LIGHT).length);
    for (const key of keys) expect(legacyLight[key], key).toBe(OLD_LIGHT[key]);
  });

  it("restores Tailwind defaults for the warmed scales", () => {
    const keys = Object.keys(newLight).filter((key) => WARMED.test(key));
    expect(keys.length).toBe(44);
    for (const key of keys) expect(legacyLight[key], key).toBe(tailwindDefaults[key]);
  });

  it("restores the old dark values", () => {
    for (const key of Object.keys(newDark)) {
      const old = OLD_DARK[key] ?? OLD_LIGHT[key] ?? (WARMED.test(key) ? tailwindDefaults[key] : undefined);
      if (old === undefined) continue;
      expect(legacyDark[key], key).toBe(old);
    }
  });

  it("restores the old app face, so font-sans inside resolves to Jakarta", () => {
    expect(legacyLight["font-sans"]?.replace(/\s+/g, " ")).toBe(OLD_FONT_SANS);
    expect(legacyCss).toMatch(/\n\.legacy-theme\s*\{[^}]*\bfont-family:\s*var\(--font-sans\);/);
  });

  it("restores the old text selection colors", () => {
    expect(legacyCss).toMatch(
      /\n\.legacy-theme ::selection,\s*\.legacy-theme::selection\s*\{\s*background:\s*var\(--color-brand-200\);\s*color:\s*var\(--color-brand-900\);\s*\}/,
    );
  });

  // The page scrollbar belongs to html, outside the surface, hence the :has().
  it("restores the old scrollbar thumb, on the page and inside the surface", () => {
    expect(legacyCss).toMatch(
      /@media \(pointer: fine\)\s*\{\s*html:has\(\.legacy-theme\)::-webkit-scrollbar-thumb,\s*\.legacy-theme ::-webkit-scrollbar-thumb\s*\{\s*background:\s*#bdcbc2;\s*\}\s*\}/,
    );
    expect(legacyCss).toMatch(
      /\nhtml\.dark:has\(\.legacy-theme\)::-webkit-scrollbar-thumb,\s*\.dark \.legacy-theme ::-webkit-scrollbar-thumb\s*\{\s*background:\s*#2b3a32;\s*\}/,
    );
  });

  it.each([
    ["kiosk", kioskViewport],
    ["machine display", displayViewport],
    ["print", printViewport],
  ])("colors the browser chrome the old green on the %s route", (_name, viewport) => {
    expect(viewport.themeColor).toBe(OLD_THEME_COLOR);
  });

  it("gives the page body behind a legacy surface the old background, without paper grain", () => {
    expect(readBlock(legacyCss, "body:has(.legacy-theme)")).toEqual({});
    expect(legacyCss).toMatch(/\nbody:has\(\.legacy-theme\)\s*\{\s*background-color:\s*#f3f7f5;\s*\}/);
    expect(legacyCss).toMatch(/\n\.dark body:has\(\.legacy-theme\)\s*\{\s*background-color:\s*#0b0f0d;\s*\}/);
    expect(legacyCss).toMatch(/\nbody:has\(\.legacy-theme\)::before\s*\{\s*display:\s*none;\s*\}/);
  });

  // The trip print page whitens html, body and .print-root for print; the wrapper
  // between them must not paint its screen background onto the sheet.
  it("steps out of the way when printing", () => {
    expect(legacyCss).toMatch(
      /@media print\s*\{\s*\.legacy-theme\s*\{\s*min-height:\s*auto;\s*background:\s*none;\s*\}\s*\}/,
    );
  });

  it.each([
    ["kiosk", KioskLayout],
    ["machine display", MachineDisplayLayout],
    ["print", PrintLayout],
  ] as [string, ComponentType<{ children: ReactNode }>][])("wraps the %s route", (_name, Layout) => {
    const html = renderToStaticMarkup(createElement(Layout, null, createElement("p", null, "x")));
    expect(html).toBe('<div class="legacy-theme"><p>x</p></div>');
  });
});
