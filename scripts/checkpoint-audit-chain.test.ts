import { describe, expect, it } from "vitest";
import { parseCheckpointArgs } from "./checkpoint-audit-chain";

const DIGEST = "a".repeat(64);

describe("checkpoint-audit-chain arguments", () => {
  it("is a dry run by default", () => {
    expect(parseCheckpointArgs([])).toEqual({ kind: "dry-run" });
  });

  it("applies only with a reviewed digest", () => {
    expect(parseCheckpointArgs(["--apply", "--expected-digest", DIGEST])).toEqual({ kind: "apply", expectedDigest: DIGEST });
    expect(parseCheckpointArgs(["--expected-digest", DIGEST, "--apply"])).toEqual({ kind: "apply", expectedDigest: DIGEST });
  });

  it("refuses ambiguous or malformed arguments instead of guessing", () => {
    for (const argv of [
      ["--apply"], ["--expected-digest", DIGEST], ["--apply", "--expected-digest"], ["--apply", "--expected-digest", "abc"],
      ["--apply", "--expected-digest", DIGEST.toUpperCase()], ["--apply", "--apply", "--expected-digest", DIGEST],
      ["--apply", "--expected-digest", DIGEST, "--expected-digest", DIGEST], ["--force"], ["--apply", "--expected-digest", DIGEST, "x"],
    ]) {
      expect(() => parseCheckpointArgs(argv), argv.join(" ")).toThrow();
    }
  });
});
