import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// GHSA-mrhx-c7xc-m3w5: zod (fixed in 4.6.6) rejects an oversized array before
// walking its elements only when the schema declares an upper bound. Without
// one, a large array of bad elements builds one issue per element. Every
// z.array() in server code therefore needs .max() or .length() on the same
// line. Schemas that never see request input are listed here with the reason.
const NOT_REQUEST_INPUT: Record<string, string> = {
  "lib/session-policy.ts": "parses the session policy snapshot the server itself stored",
};

const root = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(rel);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [rel] : [];
  });
}

describe("request array bounds (static source check)", () => {
  it("bounds every z.array() in app/ and lib/", () => {
    const unbounded = ["app", "lib"]
      .flatMap(sourceFiles)
      .filter((file) => !(file in NOT_REQUEST_INPUT))
      .flatMap((file) =>
        readFileSync(path.join(root, file), "utf8")
          .split("\n")
          .map((line, i) => ({ line, at: `${file}:${i + 1}` }))
          .filter(({ line }) => line.includes("z.array(") && !/\.(max|length)\(/.test(line))
          .map(({ at, line }) => `${at}: ${line.trim()}`),
      );
    expect(unbounded).toEqual([]);
  });

  it("still finds the schema it exempts, so the exemption cannot go stale", () => {
    for (const file of Object.keys(NOT_REQUEST_INPUT)) {
      expect(readFileSync(path.join(root, file), "utf8")).toContain("z.array(");
    }
  });
});
