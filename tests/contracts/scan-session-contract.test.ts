import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanSessionContractV1 } from "../support/contracts";

const fixturePath = path.resolve(__dirname, "../fixtures/contracts/scan-session.v1.json");

describe("scan-session v1 contract fixture", () => {
  const document = JSON.parse(readFileSync(fixturePath, "utf8"));

  it("is versioned and matches the backend response schema", () => {
    const contract = scanSessionContractV1.parse(document);
    expect(contract.version).toBe(1);
    expect(path.basename(fixturePath)).toBe(`${contract.contract}.v${contract.version}.json`);
  });

  it("rejects a document whose shape drifted without a version bump", () => {
    const drifted = structuredClone(document);
    drifted.response.session.status = 42;
    expect(scanSessionContractV1.safeParse(drifted).success).toBe(false);
    expect(scanSessionContractV1.safeParse({ ...document, version: 2 }).success).toBe(false);
  });
});
