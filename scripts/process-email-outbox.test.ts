import { describe, expect, it } from "vitest";
import { parseOutboxArgs } from "./process-email-outbox";

describe("parseOutboxArgs", () => {
  it("defaults to one pass of at most 50 rows", () => {
    expect(parseOutboxArgs([])).toEqual({ kind: "pass", limit: 50 });
    expect(parseOutboxArgs(["--limit", "20"])).toEqual({ kind: "pass", limit: 20 });
    expect(parseOutboxArgs(["--id", "cm123abc"])).toEqual({ kind: "one", id: "cm123abc" });
  });

  it("refuses anything unexpected", () => {
    for (const argv of [["--limit"], ["--limit", "0"], ["--limit", "1001"], ["--limit", "2.5"], ["--id", "a b"],
      ["--id", "x", "--limit", "5"], ["--limit", "5", "--limit", "6"], ["--email", "a@b.test"], ["extra"]]) {
      expect(() => parseOutboxArgs(argv)).toThrow();
    }
  });
});
