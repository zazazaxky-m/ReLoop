import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The editorial theme (docs/superpowers/specs/2026-10-27-app-editorial-theme-design.md)
// colors the app through its tokens. Tailwind palette families the theme does not
// warm, and hard-coded hex utilities, would bring back the old greens and grays.
// Legacy surfaces keep their old look and are left out.

const ROOT = path.resolve(__dirname, "../..");
const EXCLUDED = [
  "components/landing/",
  "app/print/",
  "app/kiosk/",
  "app/machine/",
  "components/machine/MachineDisplay.tsx",
  "components/trip/PrintControls.tsx",
];
const RAW = [
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:emerald|teal|green|lime|gray|zinc|neutral|stone|sky|cyan|indigo|violet|purple|pink|rose|orange|yellow)-\d{2,3}\b/,
  /\b(?:bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/,
];

function tsxFiles(dir: string): string[] {
  return readdirSync(path.join(ROOT, dir), { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => path.posix.join(dir, file.split(path.sep).join("/")));
}

describe("raw palette guard", () => {
  it("leaves no untokened palette colors in the app", () => {
    const files = [...tsxFiles("app"), ...tsxFiles("components")].filter(
      (file) => !EXCLUDED.some((excluded) => file.startsWith(excluded)),
    );
    expect(files.length).toBeGreaterThan(50);

    const hits: string[] = [];
    for (const file of files) {
      readFileSync(path.join(ROOT, file), "utf8")
        .split("\n")
        .forEach((line, i) => {
          for (const pattern of RAW) {
            const match = line.match(pattern);
            if (match) hits.push(`${file}:${i + 1} ${match[0]}`);
          }
        });
    }
    expect(hits).toEqual([]);
  });
});
