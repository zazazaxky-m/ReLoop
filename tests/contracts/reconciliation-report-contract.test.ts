import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reconciliationReportContractV1 } from "../support/contracts";

const fixturePath = path.resolve(__dirname, "../fixtures/contracts/reconciliation-report.v1.json");

describe("reconciliation-report v1 contract fixture", () => {
  const document = JSON.parse(readFileSync(fixturePath, "utf8"));

  it("is versioned and matches the backend response schema", () => {
    const contract = reconciliationReportContractV1.parse(document);
    expect(contract.version).toBe(1);
    expect(path.basename(fixturePath)).toBe(`${contract.contract}.v${contract.version}.json`);
  });

  it("rejects a document whose shape drifted without a version bump", () => {
    const drifted = structuredClone(document);
    drifted.response.report.availableLiability = "60000";
    expect(reconciliationReportContractV1.safeParse(drifted).success).toBe(false);
    expect(reconciliationReportContractV1.safeParse({ ...document, version: 2 }).success).toBe(false);
  });

  it("rejects figures that break the report invariants", () => {
    const report = () => structuredClone(document);
    const fractional = report();
    fractional.response.report.paidTotal = 40_000.5;
    const obligation = report();
    obligation.response.report.totalObligation = 60_000;
    const alias = report();
    alias.response.report.totalOutstanding = 115_000; // the pre-M05 gross figure
    const healthy = report();
    healthy.response.report.hasDiscrepancy = false;
    const allocation = report();
    allocation.response.report.organizations[0].outstanding = 115_000;
    for (const broken of [fractional, obligation, alias, healthy, allocation]) {
      expect(reconciliationReportContractV1.safeParse(broken).success).toBe(false);
    }
  });
});
