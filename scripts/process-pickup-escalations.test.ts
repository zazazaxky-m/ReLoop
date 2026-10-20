import { describe, expect, it } from "vitest";
import { parseEscalationArgs } from "./process-pickup-escalations";

describe("parseEscalationArgs", () => {
  it("defaults to one pass of at most 200 tasks", () => {
    expect(parseEscalationArgs([])).toEqual({ limit: 200 });
    expect(parseEscalationArgs(["--limit", "50"])).toEqual({ limit: 50 });
  });

  it("refuses anything unexpected", () => {
    for (const argv of [["--limit"], ["--limit", "0"], ["--limit", "1001"], ["--limit", "2.5"], ["--id", "x"],
      ["--limit", "5", "--limit", "6"], ["extra"]]) {
      expect(() => parseEscalationArgs(argv)).toThrow();
    }
  });
});
