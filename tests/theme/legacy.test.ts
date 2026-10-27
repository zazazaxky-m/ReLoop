import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import KioskLayout from "@/app/kiosk/[code]/layout";
import MachineDisplayLayout from "@/app/machine/[code]/display/layout";
import PrintLayout from "@/app/print/layout";
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

  it.each([
    ["kiosk", KioskLayout],
    ["machine display", MachineDisplayLayout],
    ["print", PrintLayout],
  ] as [string, ComponentType<{ children: ReactNode }>][])("wraps the %s route", (_name, Layout) => {
    const html = renderToStaticMarkup(createElement(Layout, null, createElement("p", null, "x")));
    expect(html).toBe('<div class="legacy-theme"><p>x</p></div>');
  });
});
