import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");

export function readRepoFile(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/**
 * The `--*` declarations of the first top-level block whose selector text is
 * exactly `selector` ("@theme", ".dark", ".legacy-theme", ...). Keys drop the
 * leading `--`. Comments are ignored; nested blocks are not expected.
 */
export function readBlock(css: string, selector: string): Record<string, string> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let depth = 0;
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      if (depth === 0 && source.slice(start, i).trim() === selector) {
        const end = source.indexOf("}", i);
        const tokens: Record<string, string> = {};
        for (const m of source.slice(i + 1, end).matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
          tokens[m[1]] = m[2].trim();
        }
        return tokens;
      }
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) start = i + 1;
    } else if (ch === ";" && depth === 0) {
      start = i + 1;
    }
  }
  throw new Error(`no top-level block for selector ${selector}`);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two #rrggbb colors. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
