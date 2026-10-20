import { describe, expect, it } from "vitest";
import { parseRunnerArgs } from "./process-erasure-jobs";

describe("process-erasure-jobs arguments", () => {
  it("runs one pass by default and accepts a bounded limit", () => {
    expect(parseRunnerArgs([])).toEqual({ kind: "pass", limit: 50 });
    expect(parseRunnerArgs(["--limit", "20"])).toEqual({ kind: "pass", limit: 20 });
  });

  it("runs a single request or an operator verification", () => {
    expect(parseRunnerArgs(["--request", "req_1"])).toEqual({ kind: "request", requestId: "req_1" });
    expect(parseRunnerArgs(["--operator-verify", "req_1", "--reference", "TIKET-42"]))
      .toEqual({ kind: "operator-verify", requestId: "req_1", reference: "TIKET-42" });
  });

  it("refuses ambiguous or malformed arguments instead of guessing", () => {
    for (const argv of [
      ["--limit", "0"], ["--limit", "1.5"], ["--limit"], ["--force"], ["--request", "a b"],
      ["--operator-verify", "req_1"], ["--reference", "TIKET-42"], ["--request", "r", "--limit", "5"],
      ["--operator-verify", "req_1", "--reference", "T", "--request", "r"], ["--limit", "5", "--limit", "6"],
    ]) {
      expect(() => parseRunnerArgs(argv)).toThrow();
    }
  });
});
