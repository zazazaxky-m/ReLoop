// Regression tests for scripts/check-dependency-advisories.mjs (SEC-07).
//
// Run with: node --test tests/dependency-gate.test.mjs
// This is a plain node:test file. The Vitest unit config only includes
// **/*.test.ts, so `npm test` never loads it; security-scan.yml runs it.
import { spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = "scripts/check-dependency-advisories.mjs";
const NOW = "2026-10-13";
const scratch = mkdtempSync(path.join(tmpdir(), "reloop-dep-gate-"));
after(() => rmSync(scratch, { recursive: true, force: true }));

let counter = 0;
function writeJson(name, value) {
  const file = path.join(scratch, `${counter++}-${name}.json`);
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

function gate(auditPath, triagePath, extra = []) {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, auditPath, triagePath, "--now", NOW, ...extra],
    { cwd: root, encoding: "utf8" },
  );
  return { ...result, output: `${result.stdout}\n${result.stderr}` };
}

function advisory({ name, ghsa, severity = "high", title = "Synthetic advisory" }) {
  return {
    source: 9100000 + counter,
    name,
    dependency: name,
    title,
    url: `https://github.com/advisories/${ghsa}`,
    severity,
    cwe: ["CWE-400"],
    cvss: { score: 7.5, vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H" },
    range: "<9.9.9",
  };
}

function audit(...entries) {
  const vulnerabilities = {};
  for (const entry of entries) {
    vulnerabilities[entry.name] = {
      name: entry.name,
      severity: entry.severity ?? "high",
      isDirect: false,
      via: entry.via ?? [advisory(entry)],
      effects: [],
      range: "<9.9.9",
      nodes: [`node_modules/${entry.name}`],
      fixAvailable: true,
    };
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: {} };
}

function row(overrides = {}) {
  return {
    package: "dev-tool",
    installed: "1.0.0",
    advisory: "GHSA-fake-high-0002",
    scope: "dev",
    runtimeReachable: false,
    fixedVersion: "2.0.0",
    decision: "exception",
    owner: "platform-security",
    expiresAt: "2026-12-01",
    mitigation: "Only used by the local test runner; never started in CI or production images.",
    evidence: "npm ls shows the package only under vitest; absent from npm audit --omit=dev.",
    ...overrides,
  };
}

const devHigh = { name: "dev-tool", ghsa: "GHSA-fake-high-0002" };

describe("dependency advisory gate: contract from the task brief", () => {
  it("fails for an untriaged runtime critical and passes an empty audit", () => {
    // scripts/check-dependency-advisories.mjs must fail for an untriaged runtime critical.
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "tests/fixtures/audit-runtime-critical.json",
        "tests/fixtures/triage-empty.json",
      ],
      { cwd: root },
    );
    assert.equal(result.status, 1);
    // The positive assertion keeps a missing script (which also exits 1) from
    // looking like a working gate.
    const safe = spawnSync(
      process.execPath,
      [SCRIPT, "tests/fixtures/audit-empty.json", "tests/fixtures/triage-empty.json"],
      { cwd: root },
    );
    assert.equal(safe.status, 0);
  });

  it("names the package and advisory when it blocks", () => {
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "tests/fixtures/audit-runtime-critical.json",
        "tests/fixtures/triage-empty.json",
      ],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    const output = `${result.stdout}${result.stderr}`;
    assert.match(output, /fixture-runtime-lib/);
    assert.match(output, /GHSA-fake-crit-0001/i);
    assert.match(output, /untriaged/i);
  });
});

describe("dependency advisory gate: severity and triage matching", () => {
  it("blocks an untriaged high advisory even when it is dev-only", () => {
    const result = gate(writeJson("audit", audit(devHigh)), writeJson("triage", { rows: [] }));
    assert.equal(result.status, 1, result.output);
  });

  it("does not gate moderate or low advisories", () => {
    const report = audit(
      { name: "mod-lib", ghsa: "GHSA-fake-mod0-0003", severity: "moderate" },
      { name: "low-lib", ghsa: "GHSA-fake-low0-0004", severity: "low" },
    );
    const result = gate(writeJson("audit", report), writeJson("triage", { rows: [] }));
    assert.equal(result.status, 0, result.output);
  });

  it("gates the advisory severity, not the severity inherited by a dependent", () => {
    const report = audit({
      name: "parent-lib",
      severity: "high",
      via: [advisory({ name: "parent-lib", ghsa: "GHSA-fake-mod0-0005", severity: "moderate" })],
    });
    const result = gate(writeJson("audit", report), writeJson("triage", { rows: [] }));
    assert.equal(result.status, 0, result.output);
  });

  it("accepts a triage file that is a bare array of rows", () => {
    const result = gate(
      writeJson("audit", audit(devHigh)),
      writeJson("triage", [row({ expiresAt: "2026-11-30" })]),
    );
    assert.equal(result.status, 0, result.output);
  });

  it("matches rows by the advisory id from the URL case-insensitively", () => {
    const result = gate(
      writeJson("audit", audit(devHigh)),
      writeJson("triage", { rows: [row({ advisory: "ghsa-fake-high-0002" })] }),
    );
    assert.equal(result.status, 0, result.output);
  });

  it("fails closed on a high entry that cites no advisory and no known package", () => {
    const report = audit({ name: "mystery-lib", severity: "high", via: ["vanished-package"] });
    const result = gate(writeJson("audit", report), writeJson("triage", { rows: [] }));
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /mystery-lib/);
  });

  it("does not treat Object prototype names as reported packages", () => {
    const report = audit({ name: "proto-lib", severity: "high", via: ["toString"] });
    const result = gate(writeJson("audit", report), writeJson("triage", { rows: [] }));
    assert.equal(result.status, 1, result.output);
  });

  it("does not double count a high entry that only cites another reported package", () => {
    const report = audit(
      { name: "root-lib", ghsa: "GHSA-fake-high-0006" },
      { name: "wrapper-lib", severity: "high", via: ["root-lib"] },
    );
    const triage = {
      rows: [
        row({ package: "root-lib", advisory: "GHSA-fake-high-0006", expiresAt: "2026-11-30" }),
      ],
    };
    const result = gate(writeJson("audit", report), writeJson("triage", triage));
    assert.equal(result.status, 0, result.output);
  });
});

describe("dependency advisory gate: decisions", () => {
  it("passes a dev exception that has an owner, mitigation and unexpired date", () => {
    const result = gate(
      writeJson("audit", audit(devHigh)),
      writeJson("triage", { rows: [row()] }),
    );
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /dev-tool/);
    assert.match(result.output, /2026-12-01/);
  });

  it("blocks an exception whose date has passed", () => {
    const result = gate(
      writeJson("audit", audit(devHigh)),
      writeJson("triage", { rows: [row({ expiresAt: "2026-10-12" })] }),
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /expired/i);
  });

  it("allows an exception on the day it expires", () => {
    const result = gate(
      writeJson("audit", audit(devHigh)),
      writeJson("triage", { rows: [row({ expiresAt: NOW })] }),
    );
    assert.equal(result.status, 0, result.output);
  });

  it("blocks an exception with no expiry or an unparseable expiry", () => {
    for (const expiresAt of [undefined, null, "", "soon", "2026-13-45", "2026-02-30"]) {
      const result = gate(
        writeJson("audit", audit(devHigh)),
        writeJson("triage", { rows: [row({ expiresAt })] }),
      );
      assert.equal(result.status, 1, `expiresAt=${String(expiresAt)}\n${result.output}`);
    }
  });

  it("blocks an exception that expires more than 90 days out", () => {
    const result = gate(
      writeJson("audit", audit(devHigh)),
      writeJson("triage", { rows: [row({ expiresAt: "2027-06-01" })] }),
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /90/);
  });

  it("blocks an exception with no owner or no mitigation", () => {
    for (const patch of [
      { owner: "" },
      { owner: undefined },
      { mitigation: "" },
      { mitigation: undefined },
      { mitigation: "   " },
    ]) {
      const result = gate(
        writeJson("audit", audit(devHigh)),
        writeJson("triage", { rows: [row(patch)] }),
      );
      assert.equal(result.status, 1, `${JSON.stringify(patch)}\n${result.output}`);
    }
  });

  it("blocks a row that claims the advisory is patched while the audit still reports it", () => {
    const result = gate(
      writeJson("audit", audit(devHigh)),
      writeJson("triage", { rows: [row({ decision: "patched" })] }),
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /still reports/i);
  });

  it("blocks a reachable advisory that is not fixed, even with an exception", () => {
    for (const scope of ["production", "build", "dev"]) {
      const result = gate(
        writeJson("audit", audit(devHigh)),
        writeJson("triage", { rows: [row({ scope, runtimeReachable: true })] }),
      );
      assert.equal(result.status, 1, `scope=${scope}\n${result.output}`);
    }
  });

  it("blocks unresolved reachability for production scope", () => {
    const result = gate(
      writeJson("audit", audit(devHigh)),
      writeJson("triage", { rows: [row({ scope: "production", runtimeReachable: "unresolved" })] }),
    );
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /unresolved/i);
  });

  it("allows production exception only when reachability is proven false", () => {
    const result = gate(
      writeJson("audit", audit(devHigh)),
      writeJson("triage", { rows: [row({ scope: "production", runtimeReachable: false })] }),
    );
    assert.equal(result.status, 0, result.output);
  });

  it("still requires mitigation and expiry for dev scope with unresolved reachability", () => {
    const ok = gate(
      writeJson("audit", audit(devHigh)),
      writeJson("triage", { rows: [row({ runtimeReachable: "unresolved" })] }),
    );
    assert.equal(ok.status, 0, ok.output);
    const bad = gate(
      writeJson("audit", audit(devHigh)),
      writeJson("triage", { rows: [row({ runtimeReachable: "unresolved", expiresAt: "" })] }),
    );
    assert.equal(bad.status, 1, bad.output);
  });

  it("blocks a dev or build label on an advisory that the runtime audit also reports", () => {
    const report = writeJson("audit", audit(devHigh));
    const runtime = writeJson("runtime", audit(devHigh));
    const result = gate(report, writeJson("triage", { rows: [row({ scope: "dev" })] }), [
      "--runtime",
      runtime,
    ]);
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /production/i);
  });

  it("accepts a dev label when the runtime audit does not report the advisory", () => {
    const report = writeJson("audit", audit(devHigh));
    const runtime = writeJson("runtime", audit());
    const result = gate(report, writeJson("triage", { rows: [row({ scope: "dev" })] }), [
      "--runtime",
      runtime,
    ]);
    assert.equal(result.status, 0, result.output);
  });

  it("keeps patched rows as history and warns about exceptions that are no longer needed", () => {
    const patched = gate(
      writeJson("audit", audit()),
      writeJson("triage", {
        rows: [row({ decision: "patched", runtimeReachable: false, scope: "production" })],
      }),
    );
    assert.equal(patched.status, 0, patched.output);
    assert.doesNotMatch(patched.output, /WARN/);

    const stale = gate(writeJson("audit", audit()), writeJson("triage", { rows: [row()] }));
    assert.equal(stale.status, 0, stale.output);
    assert.match(stale.output, /WARN.*no longer needed/);
  });
});

describe("dependency advisory gate: bad input fails closed", () => {
  it("exits 2 when arguments are missing", () => {
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 2);
  });

  it("exits 2 when the audit reports an error instead of results", () => {
    const failed = writeJson("audit", {
      message: "request to https://registry.npmjs.org failed",
      error: { code: "ENOAUDIT", summary: "audit endpoint returned an error" },
    });
    const result = gate(failed, writeJson("triage", { rows: [] }));
    assert.equal(result.status, 2, result.output);
  });

  it("exits 2 when an otherwise well-formed report carries an error", () => {
    const report = { ...audit(), error: { code: "ENOAUDIT", summary: "registry unreachable" } };
    const result = gate(writeJson("audit", report), writeJson("triage", { rows: [] }));
    assert.equal(result.status, 2, result.output);
    assert.match(result.output, /ENOAUDIT|registry unreachable|error/i);
  });

  it("exits 2 for an unsupported audit report version, bad JSON or a missing file", () => {
    const triage = writeJson("triage", { rows: [] });
    assert.equal(
      gate(writeJson("audit", { auditReportVersion: 1, vulnerabilities: {} }), triage).status,
      2,
    );
    assert.equal(gate(writeJson("audit", "{not json"), triage).status, 2);
    assert.equal(gate(path.join(scratch, "does-not-exist.json"), triage).status, 2);
  });

  it("exits 2 for a malformed triage file or malformed rows", () => {
    const report = writeJson("audit", audit(devHigh));
    assert.equal(gate(report, writeJson("triage", "{oops")).status, 2);
    assert.equal(gate(report, writeJson("triage", { nope: [] })).status, 2);
    assert.equal(gate(report, writeJson("triage", { rows: [row({ scope: "everywhere" })] })).status, 2);
    assert.equal(
      gate(report, writeJson("triage", { rows: [row({ runtimeReachable: "maybe" })] })).status,
      2,
    );
    assert.equal(gate(report, writeJson("triage", { rows: [row({ package: "" })] })).status, 2);
    assert.equal(gate(report, writeJson("triage", { rows: [row({ decision: "ignore" })] })).status, 2);
  });

  it("exits 2 when two rows claim the same package and advisory", () => {
    const report = writeJson("audit", audit(devHigh));
    const result = gate(report, writeJson("triage", { rows: [row(), row()] }));
    assert.equal(result.status, 2, result.output);
  });
});

describe("committed triage file", () => {
  const triagePath = path.join(root, "docs/security/dependency-triage.json");
  const docPath = path.join(root, "docs/security/dependency-triage.md");

  it("lists every row in the human-readable triage document", () => {
    const rows = JSON.parse(readFileSync(triagePath, "utf8")).rows;
    const doc = readFileSync(docPath, "utf8");
    assert.ok(rows.length > 0, "triage must record the audited advisories");
    for (const entry of rows) {
      assert.ok(
        doc.includes(entry.advisory),
        `docs/security/dependency-triage.md is missing ${entry.advisory}`,
      );
    }
  });

  it("keeps every high or critical decision complete", () => {
    const rows = JSON.parse(readFileSync(triagePath, "utf8")).rows;
    for (const entry of rows) {
      for (const key of ["package", "installed", "advisory", "scope", "decision", "owner"]) {
        assert.ok(String(entry[key] ?? "").trim(), `${entry.package} ${entry.advisory}: ${key}`);
      }
      if (entry.decision === "exception") {
        assert.ok(entry.expiresAt, `${entry.package}: exception needs expiresAt`);
        assert.ok(entry.mitigation, `${entry.package}: exception needs mitigation`);
      }
    }
  });
});
